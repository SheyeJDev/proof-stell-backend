import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Provider, Account, Contract } from 'starknet';
import { TypedConfigService } from '../common/config/typed-config.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AnalyticsEvent } from '../analytics/analytics-event.enum';

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
   * minting tokens for the specified user ID.
   * 
   * @param userId - The ID of the user to mint tokens for
   * @returns Promise containing the transaction hash
   * @throws {Error} If the transaction fails or the contract is unreachable
   * 
   * @example
   * ```typescript
   * const result = await blockchainService.sendMintTx(123);
   * console.log('Mint transaction:', result.transaction_hash);
   * ```
   */
  async sendMintTx(userId: number): Promise<{ transaction_hash: string }> {
    const contractAddress = this.configService.mintContractAddress;
    const tx = await this.account.execute({
      contractAddress,
      entrypoint: 'mint',
      calldata: [userId.toString()],
    });
    if (this.analyticsService) {
      await this.analyticsService.track(AnalyticsEvent.TokenMinted, {
        userId: String(userId),
        metadata: { transaction_hash: tx.transaction_hash },
      });
    }
    return { transaction_hash: tx.transaction_hash };
  }

  /**
   * Sends a transfer transaction to the blockchain.
   * 
   * This method executes a transfer operation on the configured contract,
   * transferring tokens from one user to another.
   * 
   * @param fromUserId - The ID of the user sending tokens
   * @param toUserId - The ID of the user receiving tokens
   * @param amount - The amount of tokens to transfer
   * @returns Promise containing the transaction hash
   * @throws {Error} If the transaction fails or the contract is unreachable
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
  ): Promise<{ transaction_hash: string }> {
    const contractAddress = this.configService.mintContractAddress;
    const tx = await this.account.execute({
      contractAddress,
      entrypoint: 'transfer',
      calldata: [fromUserId.toString(), toUserId.toString(), amount.toString()],
    });
    if (this.analyticsService) {
      await this.analyticsService.track(AnalyticsEvent.TokenTransferred, {
        userId: String(fromUserId),
        metadata: { toUserId, amount, transaction_hash: tx.transaction_hash },
      });
    }
    return { transaction_hash: tx.transaction_hash };
  }

  /**
   * Sends a burn transaction to the blockchain.
   * 
   * This method executes a burn operation on the configured contract,
   * burning tokens from the specified user's balance.
   * 
   * @param userId - The ID of the user whose tokens will be burned
   * @param amount - The amount of tokens to burn
   * @returns Promise containing the transaction hash
   * @throws {Error} If the transaction fails or the contract is unreachable
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
  ): Promise<{ transaction_hash: string }> {
    const contractAddress = this.configService.mintContractAddress;
    const tx = await this.account.execute({
      contractAddress,
      entrypoint: 'burn',
      calldata: [userId.toString(), amount.toString()],
    });
    if (this.analyticsService) {
      await this.analyticsService.track(AnalyticsEvent.TokenBurned, {
        userId: String(userId),
        metadata: { amount, transaction_hash: tx.transaction_hash },
      });
    }
    return { transaction_hash: tx.transaction_hash };
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
}
