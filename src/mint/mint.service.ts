import { Injectable, Logger } from '@nestjs/common';
import { UpdateMintDto } from './dto/update-mint.dto';
import { Mint, MintStatus } from './entities/mint.entity';
import { Repository, DataSource } from 'typeorm';
import { BlockchainService } from 'src/blockchain/blockchain.service';
import { InjectRepository } from '@nestjs/typeorm';
import { IdempotencyService } from 'src/common/services/idempotency.service';
import { SagaBuilder } from 'src/common/saga/saga.builder';
import { CacheService } from 'src/cache/cache.service';
import { CacheKeys } from 'src/cache/decorators/cache.decorator';
import { TrackMetrics } from 'src/common/metrics/metrics.decorator';

@Injectable()
export class MintService {
  private readonly logger = new Logger(MintService.name);

  constructor(
    @InjectRepository(Mint)
    private readonly mintRepository: Repository<Mint>,
    private readonly dataSource: DataSource,
    private readonly blockchainService: BlockchainService,
    private readonly idempotencyService: IdempotencyService,
    private readonly cacheService: CacheService,
  ) {}

  @TrackMetrics({ category: 'mint', trackDatabase: true, operation: 'mint' })
  async mint(userId: number): Promise<Mint> {
    const mintLockKey = `mint:lock:${userId}`;
    const result = await this.cacheService.withLock(mintLockKey, 30000, async () => {
      return this.executeMint(userId);
    });
    if (!result) {
      throw new Error(`Could not acquire mint lock for user ${userId} after retries`);
    }
    return result;
  }

  private async executeMint(userId: number): Promise<Mint> {
    const idempotencyKey = this.idempotencyService.generateKey('mint', String(userId));

    const cachedResult = await this.idempotencyService.check<Mint>(idempotencyKey);
    if (cachedResult) {
      this.logger.log(`Returning cached mint result for user ${userId}`);
      return cachedResult;
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const ctx: Record<string, any> = { queryRunner, userId, mint: null as Mint | null };

    try {
      await SagaBuilder.create<Record<string, any>>()
        .step('send-blockchain-tx', async (c) => {
          const txResponse = await this.blockchainService.sendMintTx(c.userId);
          c.txHash = txResponse.transaction_hash;
        }, async (c) => {
          // Compensation: mark mint as failed if it was created
          if (c.mint) {
            c.mint.status = MintStatus.FAILED;
            await c.queryRunner.manager.save(c.mint);
          }
        })
        .step('verify-blockchain-receipt', async (c) => {
          const receipt = await this.blockchainService.waitForTransactionReceipt(c.txHash);
          c.receipt = receipt;
        }, async () => {
          // Best-effort compensation for receipt verification
        })
        .step('persist-mint-record', async (c) => {
          const mint = c.queryRunner.manager.create({
            userId: c.userId,
            transactionHash: c.txHash,
            status: c.receipt.status === 'ACCEPTED_ON_L2' ? MintStatus.CONFIRMED : MintStatus.FAILED,
            blockNumber: c.receipt.blockNumber,
            receipt: c.receipt,
          });
          c.mint = await c.queryRunner.manager.save(mint);
        }, async (c) => {
          // Compensation: remove mint record
          if (c.mint?.id) {
            await c.queryRunner.manager.delete(Mint, c.mint.id);
          }
        })
        .execute(ctx);

      await queryRunner.commitTransaction();
      const result = ctx.mint;
      await this.idempotencyService.store(idempotencyKey, result, 600000);
      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Mint failed for user ${userId}: ${errorMessage}`);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  findAll() {
    return `This action returns all mint`;
  }

  findOne(id: number) {
    return `This action returns a #${id} mint`;
  }

  update(id: number, updateMintDto: UpdateMintDto) {
    return `This action updates a #${id} mint`;
  }

  remove(id: number) {
    return `This action removes a #${id} mint`;
  }
}
