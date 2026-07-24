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
      });
    }
    return this.userState.get(userId)!;
  }

  async connect(userId: string, providerName: string): Promise<WalletConnectionStatus> {
    const provider = this.getProvider(providerName);
    const state = this.getUserState(userId);
    try {
      this.logger.log(`User ${userId}: connecting to ${providerName}...`);
      const status = await provider.connect();
      state.activeProviderName = providerName;
      state.connectionStatus = status;
      this.emitEvent<WalletConnectedEvent>(WalletEvents.CONNECTED, {
        providerName,
        address: status.address,
        chainId: status.chainId,
      });
      return status;
    } catch (error) {
      this.logger.error(`User ${userId}: failed to connect to ${providerName}: ${error.message}`);
      this.emitEvent<WalletConnectionErrorEvent>(WalletEvents.CONNECTION_ERROR, {
        providerName,
        error: { code: error.name, message: error.message },
      });
      throw error;
    }
  }

  async disconnect(userId: string): Promise<void> {
    const state = this.getUserState(userId);
    if (!state.activeProviderName) {
      this.logger.warn(`User ${userId}: no active wallet to disconnect.`);
      return;
    }
    const provider = this.getProvider(state.activeProviderName);
    try {
      await provider.disconnect();
      this.emitEvent<WalletDisconnectedEvent>(WalletEvents.DISCONNECTED, {
        providerName: state.activeProviderName,
        address: state.connectionStatus.address,
        chainId: state.connectionStatus.chainId,
      });
      state.activeProviderName = null;
      state.connectionStatus = { isConnected: false };
    } catch (error) {
      this.logger.error(`User ${userId}: failed to disconnect: ${error.message}`);
      this.emitEvent<WalletErrorEvent>(WalletEvents.ERROR, {
        providerName: state.activeProviderName,
        error: { code: error.name, message: error.message },
      });
      throw error;
    }
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

  async signMessage(userId: string, message: string, address: string): Promise<Signature> {
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

  async sendTransaction(
    userId: string,
    transaction: TransactionRequest,
    address: string,
    retries = 3,
  ): Promise<{ hash: string }> {
    const lockKey = `wallet:transaction:${userId}`;
    const lock = await this.cacheService.acquireLock(lockKey, 30000, 3);
    if (!lock) {
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

      for (let i = 0; i <= retries; i++) {
        try {
          const currentChainId = await provider.getChainId();
          if (transaction.chainId && transaction.chainId.toString() !== currentChainId) {
            try {
              await provider.switchNetwork(transaction.chainId.toString());
              this.emitEvent<WalletNetworkSwitchedEvent>(WalletEvents.NETWORK_SWITCHED, {
                providerName: state.activeProviderName,
                address,
                oldChainId: currentChainId,
                newChainId: transaction.chainId.toString(),
              });
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
          this.emitEvent<WalletTransactionSentEvent>(WalletEvents.TRANSACTION_SENT, {
            providerName: state.activeProviderName,
            address,
            chainId: currentChainId,
            transactionHash: result.hash,
            transactionDetails: transaction,
          });
          return result;
        } catch (error) {
          if (error instanceof UserRejectedTransactionException) {
            this.emitEvent<WalletTransactionRejectedEvent>(WalletEvents.TRANSACTION_REJECTED, {
              providerName: state.activeProviderName,
              address,
              chainId: state.connectionStatus.chainId,
              transactionDetails: transaction,
              error: { code: 'USER_REJECTED', message: error.message },
            });
            throw error;
          } else if (error instanceof NetworkMismatchException) {
            this.emitEvent<WalletErrorEvent>(WalletEvents.ERROR, {
              providerName: state.activeProviderName,
              address,
              chainId: state.connectionStatus.chainId,
              error: { code: 'NETWORK_MISMATCH', message: error.message },
            });
            throw error;
          } else if (i < retries) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
          } else {
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
      }
    } finally {
      await this.cacheService.releaseLock(lock);
    }
    throw new TransactionFailedException('Unknown error during transaction sending.');
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
      this.emitEvent<WalletNetworkSwitchedEvent>(WalletEvents.NETWORK_SWITCHED, {
        providerName: state.activeProviderName,
        address: state.connectionStatus.address,
        oldChainId,
        newChainId: chainId,
      });
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
    this.eventEmitter.on(WalletEvents.CONNECTED, (event: WalletConnectedEvent) => {
      this.logger.log(`[EVENT] Wallet Connected: ${event.providerName} - ${event.address} on ${event.chainId}`);
    });
    this.eventEmitter.on(WalletEvents.DISCONNECTED, (event: WalletDisconnectedEvent) => {
      this.logger.log(`[EVENT] Wallet Disconnected: ${event.providerName} - ${event.address}`);
    });
    this.eventEmitter.on(WalletEvents.TRANSACTION_REJECTED, (event: WalletTransactionRejectedEvent) => {
      this.logger.warn(`[EVENT] Transaction Rejected: ${event.providerName} - ${event.address}`);
    });
    this.eventEmitter.on(WalletEvents.NETWORK_SWITCHED, (event: WalletNetworkSwitchedEvent) => {
      this.logger.log(`[EVENT] Network Switched: ${event.providerName} - ${event.oldChainId} to ${event.newChainId}`);
    });
    this.eventEmitter.on(WalletEvents.ERROR, (event: WalletErrorEvent) => {
      this.logger.error(`[EVENT] Wallet Error: ${event.providerName} - ${event.error?.code}: ${event.error?.message}`);
    });
  }
}
