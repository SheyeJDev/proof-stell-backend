/* eslint-disable prettier/prettier */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Leaderboard } from './entities/leaderboard.entity';
import { CreateLeaderboardDto } from './dto/create-leaderboard.dto';
import { UpdateLeaderboardDto } from './dto/update-leaderboard.dto';
import { Cron } from '@nestjs/schedule';
import { TypedConfigService } from '../common/config/typed-config.service';
import { NotificationService } from '../notification/notification.service';
import { RealtimeGateway } from '../common/gateways/realtime.gateway';
import { IdempotencyService } from '../common/services/idempotency.service';
import { CacheService } from '../cache/cache.service';
import { CacheKeys } from '../cache/decorators/cache.decorator';

/**
 * Service for managing leaderboard rankings and score submissions.
 * 
 * This service handles score submissions, rank calculations, and leaderboard queries.
 * It uses database transactions for consistency, cache invalidation for performance,
 * and real-time updates via WebSocket for live leaderboard updates.
 * 
 * @example
 * ```typescript
 * const leaderboardService = new LeaderboardService(
 *   leaderboardRepository,
 *   dataSource,
 *   configService,
 *   notificationService,
 *   realtimeGateway,
 *   cacheService
 * );
 * const entry = await leaderboardService.submitScore('user-id', { score: 100 });
 * ```
 */
@Injectable()
export class LeaderboardService {
  /**
   * Creates a new LeaderboardService instance.
   * 
   * @param leaderboardRepository - TypeORM repository for Leaderboard entity
   * @param dataSource - TypeORM data source for transaction management
   * @param configService - Service for configuration values
   * @param notificationService - Service for sending notifications
   * @param realtimeGateway - Service for real-time WebSocket updates
   * @param cacheService - Service for caching operations
   */
  constructor(
    @InjectRepository(Leaderboard)
    private readonly leaderboardRepository: Repository<Leaderboard>,
    private readonly dataSource: DataSource,
    private readonly configService: TypedConfigService,
    private readonly notificationService: NotificationService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly cacheService: CacheService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  /**
   * Submits a score to the leaderboard.
   * 
   * This method handles score submission with transaction safety, rank recalculation,
   * cache invalidation, and real-time updates. It ensures that only higher scores
   * are accepted and triggers notifications for rank changes.
   * 
   * @param userId - The ID of the user submitting the score
   * @param createLeaderboardDto - Object containing the score to submit
   * @returns Promise containing the updated leaderboard entry
   * @throws {BadRequestException} If new score is not higher than current score
   * 
   * @example
   * ```typescript
   * const entry = await leaderboardService.submitScore('user-id', { score: 1500 });
   * console.log(`New rank: ${entry.rank}`);
   * ```
   */
  async submitScore(
    userId: string,
    createLeaderboardDto: CreateLeaderboardDto,
  ): Promise<Leaderboard> {
    const { score } = createLeaderboardDto;
    const idempotencyKey = this.idempotencyService.generateKey(
      'submit-score',
      userId,
    );

    const cachedResult = await this.idempotencyService.check<Leaderboard>(idempotencyKey);
    if (cachedResult) {
      return cachedResult;
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let previousRank: number | undefined;
    let isNewEntry = false;
    let finalEntry: Leaderboard;

    try {
      // Lock the row for this user to prevent concurrent race
      const existing = await queryRunner.manager
        .createQueryBuilder(Leaderboard, 'lb')
        .setLock('pessimistic_write')
        .where('lb.userId = :userId', { userId })
        .getOne();

      if (existing) {
        if (score <= existing.score) {
          throw new BadRequestException(
            'New score must be higher than current score',
          );
        }
        previousRank = existing.rank;
        existing.score = score;
        await queryRunner.manager.save(existing);
      } else {
        isNewEntry = true;
        const newEntry = queryRunner.manager.create(Leaderboard, {
          userId,
          score,
          rank: 0,
        });
        await queryRunner.manager.save(newEntry);
      }

      // Recalculate ranks within the same transaction using SQL window function
      if (this.configService.leaderboardRecalculationStrategy !== 'batch') {
        await this.recalculateRanksWithManager(queryRunner.manager);
      }

      finalEntry = await queryRunner.manager.findOneOrFail(Leaderboard, {
        where: { userId },
        relations: ['user'],
      });

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    // Invalidate cache after successful persistence
    await this.invalidateLeaderboardCache(userId);

    // Post-commit: emit notifications and realtime events
    if (isNewEntry) {
      await this.notificationService.create({
        userIds: [userId],
        title: 'Leaderboard Entry',
        message: `You have entered the leaderboard at rank ${finalEntry.rank}.`,
        type: 'leaderboard',
        icon: '🏆',
      });
      await this.emitRealtimeLeaderboardUpdate('global', 'new_entry');
    } else if (previousRank !== undefined && finalEntry.rank !== previousRank) {
      await this.notificationService.create({
        userIds: [userId],
        title: 'Leaderboard Update',
        message: `Your new leaderboard rank is ${finalEntry.rank}.`,
        type: 'leaderboard',
        icon: '🏆',
      });
      this.realtimeGateway.emitUserRankChange(
        userId,
        previousRank,
        finalEntry.rank,
        finalEntry.score,
      );
      await this.emitRealtimeLeaderboardUpdate('global', 'rank_change');
    } else {
      await this.emitRealtimeLeaderboardUpdate('global', 'score_change');
    }

    await this.idempotencyService.store(idempotencyKey, finalEntry, 600000);
    return finalEntry;
  }

  /**
   * Retrieves the global leaderboard with pagination.
   * 
   * This method returns paginated leaderboard entries ordered by rank.
   * Results include user relations for display purposes.
   * 
   * @param page - The page number to retrieve (default: 1)
   * @param limit - The number of entries per page (default: 50)
   * @returns Promise containing leaderboard entries, total count, and pagination info
   * 
   * @example
   * ```typescript
   * const { leaderboard, total, page, limit } = await leaderboardService.getGlobalLeaderboard(1, 50);
   * console.log(`Showing ${leaderboard.length} of ${total} entries`);
   * ```
   */
  async getGlobalLeaderboard(
    page: number = 1,
    limit: number = 50,
  ): Promise<{
    leaderboard: Leaderboard[];
    total: number;
    page: number;
    limit: number;
  }> {
    const [leaderboard, total] = await this.leaderboardRepository.findAndCount({
      relations: ['user'],
      order: { rank: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { leaderboard, total, page, limit };
  }

  /**
   * Retrieves a specific user's leaderboard entry.
   * 
   * This method returns the leaderboard entry for a specific user,
   * including their rank and user relation data.
   * 
   * @param userId - The ID of the user to retrieve
   * @returns Promise containing the leaderboard entry
   * @throws {NotFoundException} If user is not found on the leaderboard
   * 
   * @example
   * ```typescript
   * const entry = await leaderboardService.getUserLeaderboard('user-id');
   * console.log(`User rank: ${entry.rank}, score: ${entry.score}`);
   * ```
   */
  async getUserLeaderboard(userId: string): Promise<Leaderboard> {
    const leaderboardEntry = await this.leaderboardRepository.findOne({
      where: { userId },
      relations: ['user'],
    });

    if (!leaderboardEntry) {
      throw new NotFoundException('User not found in leaderboard');
    }

    return leaderboardEntry;
  }

  /**
   * Updates a user's score on the leaderboard.
   * 
   * This method is an alias for submitScore, allowing score updates
   * through the update endpoint interface.
   * 
   * @param userId - The ID of the user to update
   * @param updateLeaderboardDto - Object containing the new score
   * @returns Promise containing the updated leaderboard entry
   * 
   * @example
   * ```typescript
   * const entry = await leaderboardService.updateScore('user-id', { score: 2000 });
   * ```
   */
  async updateScore(
    userId: string,
    updateLeaderboardDto: UpdateLeaderboardDto,
  ): Promise<Leaderboard> {
    return this.submitScore(userId, updateLeaderboardDto as CreateLeaderboardDto);
  }

  /**
   * Recalculates ranks using a single SQL UPDATE with RANK() window function.
   * 
   * This method efficiently recalculates all leaderboard ranks using
   * SQL window functions, avoiding in-memory row loading for large datasets.
   * It runs automatically every 5 minutes via cron job.
   * 
   * @example
   * ```typescript
   * await leaderboardService.recalculateRanks();
   * ```
   */
  // Batched rank recalculation every 5 minutes
  @Cron('*/5 * * * *')
  public async recalculateRanks(): Promise<void> {
    await this.recalculateRanksWithManager(this.dataSource.manager);
    await this.invalidateGlobalLeaderboardCache();
  }

  /**
   * Recalculates ranks using the specified entity manager.
   * 
   * This private method performs the actual rank recalculation using
   * SQL window functions for efficiency.
   * 
   * @param manager - The TypeORM entity manager to use for the query
   * @private
   */
  private async recalculateRanksWithManager(
    manager: import('typeorm').EntityManager,
  ): Promise<void> {
    await manager.query(`
      UPDATE leaderboard
      SET rank = ranked.new_rank
      FROM (
        SELECT id, RANK() OVER (ORDER BY score DESC, "updatedAt" ASC) AS new_rank
        FROM leaderboard
      ) ranked
      WHERE leaderboard.id = ranked.id
    `);
  }

  /**
   * Forces an immediate rank recalculation.
   * 
   * This method triggers an immediate rank recalculation outside of
   * the normal cron schedule. Useful for manual rank fixes.
   * 
   * @example
   * ```typescript
   * await leaderboardService.forceRecalculateRanks();
   * ```
   */
  async forceRecalculateRanks(): Promise<void> {
    await this.recalculateRanks();
  }

  /**
   * Resets the entire leaderboard.
   * 
   * This method clears all leaderboard entries, invalidates cache,
   * and emits a reset event to connected clients. Use with caution.
   * 
   * @example
   * ```typescript
   * await leaderboardService.resetLeaderboard();
   * ```
   */
  async resetLeaderboard(): Promise<void> {
    await this.leaderboardRepository.clear();
    await this.invalidateLeaderboardCache();
    await this.emitRealtimeLeaderboardUpdate('global', 'reset');
  }

  /**
   * Invalidates leaderboard cache entries.
   * 
   * This private method clears cached leaderboard data for both
   * the global leaderboard and specific user entries.
   * 
   * @param userId - Optional user ID to invalidate specific user cache
   * @private
   */
  private async invalidateLeaderboardCache(userId?: string): Promise<void> {
    await this.invalidateGlobalLeaderboardCache();
    if (userId) {
      const userKey = CacheKeys.build(CacheKeys.USER_LEADERBOARD, { userId });
      await this.cacheService.del(userKey);
    }
  }

  /**
   * Invalidates global leaderboard cache for common page/limit combinations.
   * 
   * This private method clears cached leaderboard data for the most
   * commonly accessed page and limit combinations.
   * @private
   */
  private async invalidateGlobalLeaderboardCache(): Promise<void> {
    // Invalidate common page/limit combinations
    for (const page of [1, 2, 3]) {
      for (const limit of [10, 20, 50, 100]) {
        const key = CacheKeys.build(CacheKeys.GLOBAL_LEADERBOARD, { page, limit });
        await this.cacheService.del(key);
      }
    }
  }

  /**
   * Emits real-time leaderboard updates to connected clients.
   * 
   * This private method broadcasts leaderboard updates via WebSocket
   * to all subscribed clients, including the top 100 entries.
   * 
   * @param leaderboardId - The ID of the leaderboard to update
   * @param updateType - The type of update (score_change, rank_change, new_entry, reset)
   * @private
   */
  private async emitRealtimeLeaderboardUpdate(
    leaderboardId: string,
    updateType: 'score_change' | 'rank_change' | 'new_entry' | 'reset',
  ): Promise<void> {
    const top100 = await this.getGlobalLeaderboard(1, 100);
    this.realtimeGateway.emitLeaderboardUpdate(
      leaderboardId,
      top100.leaderboard,
      updateType,
    );

    if (updateType === 'reset') {
      this.realtimeGateway.emitLeaderboardStats(leaderboardId, {
        totalPlayers: 0,
        averageScore: 0,
        topScore: 0,
        lastUpdated: new Date().toISOString(),
      });
    }
  }
}
