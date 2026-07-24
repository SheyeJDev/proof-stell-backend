import { Inject, Injectable, forwardRef, Logger } from '@nestjs/common';
import { Provider, Account, Contract } from 'starknet';
import { TypedConfigService } from '../common/config/typed-config.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AnalyticsEvent } from '../analytics/analytics-event.enum';
import { CacheService } from '../cache/cache.service';

/**
 * Service for interacting with the StarkNet blockchain.
 * 
 * This service handles all blockchain operations including minting, transferring,
 * burning tokens, and checking balances. It uses a configured StarkNet provider
 * and account to execute transactions on the network.
 * 
 * @example
 * ```typescript
 * const blockchainService = new BlockchainService(configService, analyticsService);
 * const result = await blockchainService.sendMintTx(123);
 * console.log(result.transaction_hash);
 * ```
 */
@Injectable()
export class BlockchainService {
  private provider: Provider;
  private account: Account;
  private readonly logger = new Logger(BlockchainService.name);

  /**
   * Creates a new BlockchainService instance.
   * 
   * @param configService - Typed configuration service for accessing environment variables
   * @param analyticsService - Analytics service for tracking blockchain events
   * 
   * @throws {Error} If required configuration values are missing
   */
  constructor(
    private readonly configService: TypedConfigService,
    @Inject(forwardRef(() => AnalyticsService))
    private readonly analyticsService: AnalyticsService,
    private readonly cacheService: CacheService,
  ) {
    this.provider = new Provider({
      nodeUrl: 'https://starknet-goerli.g.alchemy.com/v2/demo',
    });
    const privateKey = this.configService.starknetPrivateKey;
    const accountAddress = this.configService.starknetAccountAddress;
    this.account = new Account(this.provider, accountAddress, privateKey);
  }

  /**
   * Checks the health of the blockchain provider connection.
   * 
   * This method verifies that the StarkNet provider is responsive by attempting
   * to fetch the current block number.
   * 
   * @returns Promise that resolves if the provider is healthy
   * @throws {Error} If the blockchain provider is unavailable or unreachable
   * 
   * @example
   * ```typescript
   * try {
   *   await blockchainService.checkHealth();
   *   console.log('Blockchain provider is healthy');
   * } catch (error) {
   *   console.error('Blockchain provider is down:', error.message);
   * }
   * ```
   */
  async checkHealth(): Promise<void> {
    try {
      await this.provider.getBlockNumber();
    } catch {
      throw new Error('Blockchain provider is unavailable');
    }
  }

  /**
   * Sends a mint transaction to the blockchain.
   * 
   * This method executes a mint operation on the configured contract,
   * minting tokens for the specified user ID. It uses idempotency caching
   * and distributed locking to prevent duplicate transactions.
   * 
   * @param userId - The ID of the user to mint tokens for
   * @param idempotencyKey - Optional custom idempotency key (defaults to blockchain:mint:${userId})
   * @returns Promise containing the transaction hash
   * @throws {Error} If the transaction fails, the contract is unreachable, or lock cannot be acquired
   * 
   * @example
   * ```typescript
   * const result = await blockchainService.sendMintTx(123);
   * console.log('Mint transaction:', result.transaction_hash);
   * ```
   */
  async sendMintTx(userId: number, idempotencyKey?: string): Promise<{ transaction_hash: string }> {
    const key = idempotencyKey || `blockchain:mint:${userId}`;
    const lockKey = `blockchain:tx:mint:${userId}`;

    const cached = await this.cacheService.get<{ transaction_hash: string }>(key);
    if (cached) {
      this.logger.debug(`Returning cached mint tx hash for user ${userId}`);
      return cached;
    }

    const lock = await this.cacheService.acquireLock(lockKey, 30000, 3);
    if (!lock) {
      const retryCached = await this.cacheService.get<{ transaction_hash: string }>(key);
      if (retryCached) {
        return retryCached;
      }
      throw new Error(`Failed to acquire lock for mint transaction after retries`);
    }

    try {
      const doubleCheck = await this.cacheService.get<{ transaction_hash: string }>(key);
      if (doubleCheck) {
        return doubleCheck;
      }

      const contractAddress = this.configService.mintContractAddress;
      const tx = await this.account.execute({
        contractAddress,
        entrypoint: 'mint',
        calldata: [userId.toString()],
      });

      const result = { transaction_hash: tx.transaction_hash };
      await this.cacheService.set(key, result, 3600);

      if (this.analyticsService) {
        await this.analyticsService.track(AnalyticsEvent.TokenMinted, {
          userId: String(userId),
          metadata: { transaction_hash: tx.transaction_hash },
        });
      }
      return result;
    } finally {
      await this.cacheService.releaseLock(lock);
    }
  }

  /**
   * Sends a transfer transaction to the blockchain.
   * 
   * This method executes a transfer operation on the configured contract,
   * transferring tokens from one user to another. It uses idempotency caching
   * and distributed locking to prevent duplicate transactions.
   * 
   * @param fromUserId - The ID of the user sending tokens
   * @param toUserId - The ID of the user receiving tokens
   * @param amount - The amount of tokens to transfer
   * @param idempotencyKey - Optional custom idempotency key (defaults to blockchain:transfer:${fromUserId}:${toUserId})
   * @returns Promise containing the transaction hash
   * @throws {Error} If the transaction fails, the contract is unreachable, or lock cannot be acquired
   * 
   * @example
   * ```typescript
   * const result = await blockchainService.sendTransferTx(123, 456, 100);
   * console.log('Transfer transaction:', result.transaction_hash);
   * ```
   */
  async sendTransferTx(
    fromUserId: number,
    toUserId: number,
    amount: number,
    idempotencyKey?: string,
  ): Promise<{ transaction_hash: string }> {
    const key = idempotencyKey || `blockchain:transfer:${fromUserId}:${toUserId}`;
    const lockKey = `blockchain:tx:transfer:${fromUserId}:${toUserId}`;

    const cached = await this.cacheService.get<{ transaction_hash: string }>(key);
    if (cached) {
      this.logger.debug(`Returning cached transfer tx hash for ${fromUserId} -> ${toUserId}`);
      return cached;
    }

    const lock = await this.cacheService.acquireLock(lockKey, 30000, 3);
    if (!lock) {
      const retryCached = await this.cacheService.get<{ transaction_hash: string }>(key);
      if (retryCached) {
        return retryCached;
      }
      throw new Error(`Failed to acquire lock for transfer transaction after retries`);
    }

    try {
      const doubleCheck = await this.cacheService.get<{ transaction_hash: string }>(key);
      if (doubleCheck) {
        return doubleCheck;
      }

      const contractAddress = this.configService.mintContractAddress;
      const tx = await this.account.execute({
        contractAddress,
        entrypoint: 'transfer',
        calldata: [fromUserId.toString(), toUserId.toString(), amount.toString()],
      });

      const result = { transaction_hash: tx.transaction_hash };
      await this.cacheService.set(key, result, 3600);

      if (this.analyticsService) {
        await this.analyticsService.track(AnalyticsEvent.TokenTransferred, {
          userId: String(fromUserId),
          metadata: { toUserId, amount, transaction_hash: tx.transaction_hash },
        });
      }
      return result;
    } finally {
      await this.cacheService.releaseLock(lock);
    }
  }

  /**
   * Sends a burn transaction to the blockchain.
   * 
   * This method executes a burn operation on the configured contract,
   * burning tokens from the specified user's balance. It uses idempotency
   * caching and distributed locking to prevent duplicate transactions.
   * 
   * @param userId - The ID of the user whose tokens will be burned
   * @param amount - The amount of tokens to burn
   * @param idempotencyKey - Optional custom idempotency key (defaults to blockchain:burn:${userId})
   * @returns Promise containing the transaction hash
   * @throws {Error} If the transaction fails, the contract is unreachable, or lock cannot be acquired
   * 
   * @example
   * ```typescript
   * const result = await blockchainService.sendBurnTx(123, 50);
   * console.log('Burn transaction:', result.transaction_hash);
   * ```
   */
  async sendBurnTx(
    userId: number,
    amount: number,
    idempotencyKey?: string,
  ): Promise<{ transaction_hash: string }> {
    const key = idempotencyKey || `blockchain:burn:${userId}`;
    const lockKey = `blockchain:tx:burn:${userId}`;

    const cached = await this.cacheService.get<{ transaction_hash: string }>(key);
    if (cached) {
      this.logger.debug(`Returning cached burn tx hash for user ${userId}`);
      return cached;
    }

    const lock = await this.cacheService.acquireLock(lockKey, 30000, 3);
    if (!lock) {
      const retryCached = await this.cacheService.get<{ transaction_hash: string }>(key);
      if (retryCached) {
        return retryCached;
      }
      throw new Error(`Failed to acquire lock for burn transaction after retries`);
    }

    try {
      const doubleCheck = await this.cacheService.get<{ transaction_hash: string }>(key);
      if (doubleCheck) {
        return doubleCheck;
      }

      const contractAddress = this.configService.mintContractAddress;
      const tx = await this.account.execute({
        contractAddress,
        entrypoint: 'burn',
        calldata: [userId.toString(), amount.toString()],
      });

      const result = { transaction_hash: tx.transaction_hash };
      await this.cacheService.set(key, result, 3600);

      if (this.analyticsService) {
        await this.analyticsService.track(AnalyticsEvent.TokenBurned, {
          userId: String(userId),
          metadata: { amount, transaction_hash: tx.transaction_hash },
        });
      }
      return result;
    } finally {
      await this.cacheService.releaseLock(lock);
    }
  }

  /**
   * Retrieves the token balance for a specific user.
   * 
   * This method queries the configured contract to get the current
   * token balance for the specified user ID.
   * 
   * @param userId - The ID of the user to query balance for
   * @returns Promise containing the balance as a string
   * @throws {Error} If the contract call fails or is unreachable
   * 
   * @example
   * ```typescript
   * const { balance } = await blockchainService.getBalance(123);
   * console.log('User balance:', balance);
   * ```
   */
  async getBalance(userId: number): Promise<{ balance: string }> {
    const contractAddress = this.configService.mintContractAddress;
    const contract = new Contract([], contractAddress, this.provider);
    const result = await contract.call('balanceOf', [userId.toString()]);
    const balance = result?.toString() || '0';
    return { balance };
  }

  async waitForTransactionReceipt(
    txHash: string,
    timeoutMs?: number,
  ): Promise<{ status: 'ACCEPTED_ON_L2' | 'REJECTED'; blockNumber?: number }> {
    const startTime = Date.now();
    const pollInterval = 3000;
    const effectiveTimeout = timeoutMs ?? this.configService.blockchainReceiptTimeoutMs;

    while (Date.now() - startTime < effectiveTimeout) {
      try {
        const receipt = await this.provider.getTransactionReceipt(txHash);
        if (receipt) {
          const blockNumber =
            receipt.value &&
            typeof receipt.value === 'object' &&
            'block_number' in receipt.value &&
            typeof receipt.value.block_number === 'number'
              ? receipt.value.block_number
              : undefined;

          return {
            status: receipt.isSuccess() ? 'ACCEPTED_ON_L2' : 'REJECTED',
            blockNumber,
          };
        }
      } catch {
        // Transaction not yet confirmed, continue polling
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(
      `Transaction ${txHash} not confirmed within ${effectiveTimeout}ms`,
    );
  }
}
