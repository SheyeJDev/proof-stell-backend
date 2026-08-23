import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  WalletProvider,
  WalletConnectionStatus,
  WalletConnectedEvent,
  WalletDisconnectedEvent,
  WalletTransactionSentEvent,
  WalletTransactionRejectedEvent,
  WalletNetworkSwitchedEvent,
  WalletConnectionErrorEvent,
  WalletErrorEvent,
  WalletEvent,
  Signature,
  TransactionRequest,
} from './interfaces/wallet.interface';
import { CacheKeys } from '../cache/decorators/cache.decorator';
import {
  WalletProviderNotFoundException,
  WalletNotConnectedException,
  UserRejectedTransactionException,
  NetworkMismatchException,
  TransactionFailedException,
} from './exceptions/wallet.exception';
import { WalletEvents } from './enums/wallet-events.enum';
import { ArgentXProvider } from './providers/argentx.provider';
import { BraavosProvider } from './providers/braavos.provider';
import { CacheService } from '../cache/cache.service';

interface UserWalletState {
  activeProviderName: string | null;
  connectionStatus: WalletConnectionStatus;
  /** Monotonically increasing nonce used to prevent replayed operations */
  operationNonce: number;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private providers: Map<string, WalletProvider> = new Map();
  /** Per-user wallet state keyed by userId */
  private userState: Map<string, UserWalletState> = new Map();

  constructor(
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
    private readonly cacheService: CacheService,
    argentXProvider: ArgentXProvider,
    braavosProvider: BraavosProvider,
  ) {
    if (argentXProvider.isAvailable()) {
      this.providers.set(argentXProvider.name, argentXProvider);
    }
    if (braavosProvider.isAvailable()) {
      this.providers.set(braavosProvider.name, braavosProvider);
    }
    this.logger.log(
      `Initialized WalletService with ${this.providers.size} enabled providers.`,
    );
  }

  private getProvider(providerName: string): WalletProvider {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new WalletProviderNotFoundException(providerName);
    }
    return provider;
  }

  private getUserState(userId: string): UserWalletState {
    if (!this.userState.has(userId)) {
      this.userState.set(userId, {
        activeProviderName: null,
        connectionStatus: { isConnected: false },
        operationNonce: 0,
      });
    }
    return this.userState.get(userId);
  }

  /**
   * Connect a wallet for a user.
   *
   * State is only updated on success. If provider.connect() fails, the
   * user state remains in its previous (disconnected) position so we
   * never leave a half-connected record.
   */
  async connect(
    userId: string,
    providerName: string,
  ): Promise<WalletConnectionStatus> {
    const provider = this.getProvider(providerName);
    // Snapshot previous state so we can roll back on failure
    const prevState = this.getUserState(userId);
    const prevProviderName = prevState.activeProviderName;
    const prevStatus = { ...prevState.connectionStatus };

    try {
      this.logger.log(`User ${userId}: connecting to ${providerName}...`);
      const status = await provider.connect();
      // Only commit state after successful connect
      prevState.activeProviderName = providerName;
      prevState.connectionStatus = status;
      prevState.operationNonce++;
      this.emitEvent<WalletConnectedEvent>(WalletEvents.CONNECTED, {
        providerName,
        address: status.address,
        chainId: status.chainId,
      });
      return status;
    } catch (error) {
      // Roll back to the previous state so we don't leave a half-connected record
      prevState.activeProviderName = prevProviderName;
      prevState.connectionStatus = prevStatus;
      this.logger.error(
        `User ${userId}: failed to connect to ${providerName}: ${error.message}`,
      );
      this.emitEvent<WalletConnectionErrorEvent>(
        WalletEvents.CONNECTION_ERROR,
        {
          providerName,
          error: { code: error.name, message: error.message },
        },
      );
      throw error;
    }
  }

  /**
   * Disconnect a user's wallet.
   *
   * Provider disconnect is attempted first. On success, state is reset.
   * On failure, the error is emitted but the provider-side session is
   * considered unrecoverable — we reset local state to avoid a stale
   * in-memory record that would keep returning `isConnected: true` for
   * a provider that no longer has a valid session.
   */
  async disconnect(userId: string): Promise<void> {
    const state = this.getUserState(userId);
    if (!state.activeProviderName) {
      this.logger.warn(`User ${userId}: no active wallet to disconnect.`);
      return;
    }
    const providerName = state.activeProviderName;
    const provider = this.getProvider(providerName);
    const address = state.connectionStatus.address;
    const chainId = state.connectionStatus.chainId;

    try {
      await provider.disconnect();
      this.emitEvent<WalletDisconnectedEvent>(WalletEvents.DISCONNECTED, {
        providerName,
        address,
        chainId,
      });
    } catch (error) {
      this.logger.error(
        `User ${userId}: provider disconnect failed: ${error.message}`,
      );
      this.emitEvent<WalletErrorEvent>(WalletEvents.ERROR, {
        providerName,
        error: { code: error.name, message: error.message },
      });
      // Fall through — still reset local state below
    }

    // Always reset local state, even if provider.disconnect() threw.
    // Leaving a stale state means subsequent operations would attempt
    // to use a provider session that may no longer exist.
    state.activeProviderName = null;
    state.connectionStatus = { isConnected: false };
  }

  getConnectionStatus(userId: string): WalletConnectionStatus {
    return this.getUserState(userId).connectionStatus;
  }

  async getAccounts(userId: string): Promise<string[]> {
    const state = this.getUserState(userId);
    if (!state.activeProviderName) {
      throw new WalletNotConnectedException();
    }
    const provider = this.getProvider(state.activeProviderName);
    try {
      return await provider.getAccounts();
    } catch (error) {
      this.emitEvent<WalletErrorEvent>(WalletEvents.ERROR, {
        providerName: state.activeProviderName,
        error: { code: error.name, message: error.message },
      });
      throw error;
    }
  }

  async getChainId(userId: string): Promise<string> {
    const state = this.getUserState(userId);
    if (!state.activeProviderName) {
      throw new WalletNotConnectedException();
    }
    const provider = this.getProvider(state.activeProviderName);
    try {
      return await provider.getChainId();
    } catch (error) {
      this.emitEvent<WalletErrorEvent>(WalletEvents.ERROR, {
        providerName: state.activeProviderName,
        error: { code: error.name, message: error.message },
      });
      throw error;
    }
  }

  async signMessage(
    userId: string,
    message: string,
    address: string,
  ): Promise<Signature> {
    const state = this.getUserState(userId);
    if (!state.activeProviderName) {
      throw new WalletNotConnectedException();
    }
    const provider = this.getProvider(state.activeProviderName);
    try {
      return await provider.signMessage(message, address);
    } catch (error) {
      this.emitEvent<WalletErrorEvent>(WalletEvents.ERROR, {
        providerName: state.activeProviderName,
        address,
        error: { code: error.name, message: error.message },
      });
      throw error;
    }
  }

  private getStableRequestId(transaction: TransactionRequest): string {
    if (transaction.requestId) {
      return transaction.requestId;
    }
    const normalized: Record<string, any> = {};
    Object.keys(transaction)
      .filter((key) => key !== 'requestId')
      .sort()
      .forEach((key) => {
        normalized[key] = (transaction as any)[key];
      });
    const payload = JSON.stringify(normalized);
    return createHash('sha256').update(payload).digest('hex');
  }

  async sendTransaction(
    userId: string,
    transaction: TransactionRequest,
    address: string,
    retries = 3,
  ): Promise<{ hash: string }> {
    const requestId = this.getStableRequestId(transaction);
    const cacheKey = CacheKeys.build(CacheKeys.WALLET_TRANSACTION, {
      userId,
      requestId,
    });
    const lockKey = `wallet:transaction:${userId}:${requestId}`;

    const existing = await this.cacheService.get<{
      hash: string;
      status?: string;
    }>(cacheKey);
    if (existing?.hash) {
      return existing;
    }

    if (existing?.status === 'pending') {
      const pendingResult = await this.cacheService.waitForValue<{
        hash: string;
      }>(cacheKey, 30000, 200, (value) => !!value?.hash);
      if (pendingResult) {
        return pendingResult;
      }
    }

    const lock = await this.cacheService.acquireLock(lockKey, 30000, retries);
    if (!lock) {
      const retryCached = await this.cacheService.get<{ hash: string }>(
        cacheKey,
      );
      if (retryCached) {
        return retryCached;
      }
      throw new TransactionFailedException(
        `Could not acquire lock for wallet transaction after retries`,
      );
    }

    try {
      const state = this.getUserState(userId);
      if (!state.activeProviderName) {
        throw new WalletNotConnectedException();
      }
      const provider = this.getProvider(state.activeProviderName);

      const doubleCheck = await this.cacheService.get<{ hash: string }>(
        cacheKey,
      );
      if (doubleCheck) {
        return doubleCheck;
      }

      const reserved = await this.cacheService.setIfNotExists(
        cacheKey,
        { status: 'pending' },
        30,
      );
      if (!reserved) {
        const pendingResult = await this.cacheService.waitForValue<{
          hash: string;
        }>(cacheKey, 30000, 200, (value) => !!value?.hash);
        if (pendingResult) {
          return pendingResult;
        }
      }

      for (let i = 0; i <= retries; i++) {
        try {
          const currentChainId = await provider.getChainId();
          if (
            transaction.chainId &&
            transaction.chainId.toString() !== currentChainId
          ) {
            try {
              await provider.switchNetwork(transaction.chainId.toString());
              this.emitEvent<WalletNetworkSwitchedEvent>(
                WalletEvents.NETWORK_SWITCHED,
                {
                  providerName: state.activeProviderName,
                  address,
                  oldChainId: currentChainId,
                  newChainId: transaction.chainId.toString(),
                },
              );
              state.connectionStatus.chainId = transaction.chainId.toString();
              continue;
            } catch (switchError) {
              throw new NetworkMismatchException(
                transaction.chainId.toString(),
                currentChainId,
              );
            }
          }

          const result = await provider.sendTransaction(transaction, address);
          await this.cacheService.set(cacheKey, result, 3600);
          this.emitEvent<WalletTransactionSentEvent>(
            WalletEvents.TRANSACTION_SENT,
            {
              providerName: state.activeProviderName,
              address,
              chainId: currentChainId,
              transactionHash: result.hash,
              transactionDetails: transaction,
            },
          );
          return result;
        } catch (error) {
          if (error instanceof UserRejectedTransactionException) {
            this.emitEvent<WalletTransactionRejectedEvent>(
              WalletEvents.TRANSACTION_REJECTED,
              {
                providerName: state.activeProviderName,
                address,
                chainId: state.connectionStatus.chainId,
                transactionDetails: transaction,
                error: { code: 'USER_REJECTED', message: error.message },
              },
            );
            throw error;
          } else if (error instanceof NetworkMismatchException) {
            this.emitEvent<WalletErrorEvent>(WalletEvents.ERROR, {
              providerName: state.activeProviderName,
              address,
              chainId: state.connectionStatus.chainId,
              error: { code: 'NETWORK_MISMATCH', message: error.message },
            });
            throw error;
          }

          const retryCached = await this.cacheService.get<{ hash: string }>(
            cacheKey,
          );
          if (retryCached) {
            return retryCached;
          }

          if (i < retries) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
            continue;
          }

          await this.cacheService.del(cacheKey);
          this.emitEvent<WalletErrorEvent>(WalletEvents.ERROR, {
            providerName: state.activeProviderName,
            address,
            chainId: state.connectionStatus.chainId,
            error: { code: 'TRANSACTION_FAILED', message: error.message },
          });
          throw new TransactionFailedException(
            `Failed to send transaction via ${state.activeProviderName}: ${error.message}`,
          );
        }
      }
    } finally {
      await this.cacheService.releaseLock(lock);
    }
    throw new TransactionFailedException(
      'Unknown error during transaction sending.',
    );
  }

  async switchNetwork(userId: string, chainId: string): Promise<void> {
    const state = this.getUserState(userId);
    if (!state.activeProviderName) {
      throw new WalletNotConnectedException();
    }
    const provider = this.getProvider(state.activeProviderName);
    const oldChainId = state.connectionStatus.chainId;
    try {
      await provider.switchNetwork(chainId);
      state.connectionStatus.chainId = chainId;
      this.emitEvent<WalletNetworkSwitchedEvent>(
        WalletEvents.NETWORK_SWITCHED,
        {
          providerName: state.activeProviderName,
          address: state.connectionStatus.address,
          oldChainId,
          newChainId: chainId,
        },
      );
    } catch (error) {
      this.emitEvent<WalletErrorEvent>(WalletEvents.ERROR, {
        providerName: state.activeProviderName,
        address: state.connectionStatus.address,
        chainId: oldChainId,
        error: { code: error.name, message: error.message },
      });
      throw error;
    }
  }

  private emitEvent<T extends WalletEvent>(
    eventName: WalletEvents,
    payload: Omit<T, 'timestamp' | 'event'>,
  ): void {
    const fullPayload = {
      ...payload,
      event: eventName,
      timestamp: new Date(),
    } as unknown as T;
    this.eventEmitter.emit(eventName, fullPayload);
  }

  onModuleInit() {
    this.eventEmitter.on(
      WalletEvents.CONNECTED,
      (event: WalletConnectedEvent) => {
        this.logger.log(
          `[EVENT] Wallet Connected: ${event.providerName} - ${event.address} on ${event.chainId}`,
        );
      },
    );
    this.eventEmitter.on(
      WalletEvents.DISCONNECTED,
      (event: WalletDisconnectedEvent) => {
        this.logger.log(
          `[EVENT] Wallet Disconnected: ${event.providerName} - ${event.address}`,
        );
      },
    );
    this.eventEmitter.on(
      WalletEvents.TRANSACTION_REJECTED,
      (event: WalletTransactionRejectedEvent) => {
        this.logger.warn(
          `[EVENT] Transaction Rejected: ${event.providerName} - ${event.address}`,
        );
      },
    );
    this.eventEmitter.on(
      WalletEvents.NETWORK_SWITCHED,
      (event: WalletNetworkSwitchedEvent) => {
        this.logger.log(
          `[EVENT] Network Switched: ${event.providerName} - ${event.oldChainId} to ${event.newChainId}`,
        );
      },
    );
    this.eventEmitter.on(WalletEvents.ERROR, (event: WalletErrorEvent) => {
      this.logger.error(
        `[EVENT] Wallet Error: ${event.providerName} - ${event.error?.code}: ${event.error?.message}`,
      );
    });
  }
}
