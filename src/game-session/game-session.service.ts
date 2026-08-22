import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Counter, Histogram, register } from 'prom-client';
import { GameSession } from './entities/game-session.entity';
import { InputEvent } from './entities/input-event.entity';
import { ReportSessionDto } from './dto/report-session.dto';
import { StartSessionDto } from './dto/start-session.dto';
import { User } from '../users/entities/user.entity';
import { LeaderboardService } from '../leaderboard/Leaderboard.service';
import { AchievementService } from '../badge/services/achievement.service';
import { IdempotencyService } from '../common/services/idempotency.service';
import { SagaBuilder } from '../common/saga/saga.builder';
import { CacheService } from '../cache/cache.service';
import * as crypto from 'crypto';

function getOrCreateCounter<T extends string>(
  config: import('prom-client').CounterConfiguration<T>,
): Counter<T> {
  const existing = register.getSingleMetric(config.name);
  if (existing) {
    return existing as Counter<T>;
  }
  return new Counter<T>(config);
}

function getOrCreateHistogram<T extends string>(
  config: import('prom-client').HistogramConfiguration<T>,
): Histogram<T> {
  const existing = register.getSingleMetric(config.name);
  if (existing) {
    return existing as Histogram<T>;
  }
  return new Histogram<T>(config);
}

export const gameSessionOperationsCounter = getOrCreateCounter({
  name: 'game_session_operations_total',
  help: 'Total number of game session operations executed',
  labelNames: ['operation', 'status'] as const,
});

export const gameSessionOperationDurationHistogram = getOrCreateHistogram({
  name: 'game_session_operation_duration_ms',
  help: 'Duration of game session operations in milliseconds',
  labelNames: ['operation', 'status'] as const,
  buckets: [5, 20, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
});

export const gameSessionScoreHistogram = getOrCreateHistogram({
  name: 'game_session_score',
  help: 'Distribution of reported game session scores',
  labelNames: ['status'] as const,
  buckets: [0, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 50000],
});

export const gameSessionErrorsCounter = getOrCreateCounter({
  name: 'game_session_errors_total',
  help: 'Total number of game session errors by operation and error type',
  labelNames: ['operation', 'error_type'] as const,
});

export interface SessionAnalytics {
  totalSessions: string;
  averageScore: number;
  highestScore: number;
  averageDuration: number;
}

interface SessionReportContext extends Record<string, any> {
  queryRunner: import('typeorm').QueryRunner;
  userId: string;
  score: number;
  duration: number;
  metadata: Record<string, any>;
  sessionId: string;
  savedSession: GameSession | null;
  inputEvents: InputEvent[];
  previousGamesPlayed: number;
  previousTotalScore: number;
  previousHighestScore: number;
}

@Injectable()
export class GameSessionService {
  private readonly logger = new Logger(GameSessionService.name);

  constructor(
    @InjectRepository(GameSession)
    private gameSessionRepository: Repository<GameSession>,
    @InjectRepository(InputEvent)
    private inputEventRepository: Repository<InputEvent>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private dataSource: DataSource,
    private readonly leaderboardService: LeaderboardService,
    private readonly achievementService: AchievementService,
    private readonly idempotencyService: IdempotencyService,
    private readonly cacheService: CacheService,
  ) {}

  async startSession(
    userId: string,
    dto: StartSessionDto,
  ): Promise<{ sessionId: string; nonce: string }> {
    const startTime = Date.now();
    try {
      const nonce = crypto.randomBytes(32).toString('hex');
      const gameSession = this.gameSessionRepository.create({
        userId,
        challengeId: dto.challengeId,
        nonce,
        isVerified: false,
      });
      const savedSession = await this.gameSessionRepository.save(gameSession);
      const durationMs = Date.now() - startTime;
      gameSessionOperationDurationHistogram.observe(
        { operation: 'startSession', status: 'success' },
        durationMs,
      );
      gameSessionOperationsCounter.inc({
        operation: 'startSession',
        status: 'success',
      });
      return { sessionId: savedSession.id, nonce };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      gameSessionOperationDurationHistogram.observe(
        { operation: 'startSession', status: 'error' },
        durationMs,
      );
      gameSessionOperationsCounter.inc({
        operation: 'startSession',
        status: 'error',
      });
      gameSessionErrorsCounter.inc({
        operation: 'startSession',
        error_type: error?.name || 'Error',
      });
      throw error;
    }
  }

  async reportSession(
    userId: string,
    reportSessionDto: ReportSessionDto,
    isSuspicious: boolean = false,
    suspicionReason?: string,
  ): Promise<GameSession> {
    const startTime = Date.now();
    const idempotencyKey = this.idempotencyService.generateKey(
      'report-session',
      `${userId}:${reportSessionDto.sessionId}`,
    );

    // Log suspicious sessions for operational investigation
    if (isSuspicious) {
      this.logger.warn('Suspicious session reported', {
        userId,
        sessionId: reportSessionDto.sessionId,
        reason: suspicionReason,
        score: reportSessionDto.score,
        duration: reportSessionDto.duration,
        inputCount: reportSessionDto.inputs?.length,
      });
    }

    try {
      const cachedResult =
        await this.idempotencyService.check<GameSession>(idempotencyKey);
      if (cachedResult) {
        this.logger.log(`Returning cached session report for user ${userId}`);
        const durationMs = Date.now() - startTime;
        gameSessionOperationDurationHistogram.observe(
          { operation: 'reportSession', status: 'cached' },
          durationMs,
        );
        gameSessionOperationsCounter.inc({
          operation: 'reportSession',
          status: 'cached',
        });
        return cachedResult;
      }

      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const ctx: SessionReportContext = {
        queryRunner,
        userId,
        score: reportSessionDto.score,
        duration: reportSessionDto.duration,
        metadata: reportSessionDto.metadata || {},
        sessionId: reportSessionDto.sessionId,
        savedSession: null,
        inputEvents: [],
        previousGamesPlayed: 0,
        previousTotalScore: 0,
        previousHighestScore: 0,
      };

      try {
        await SagaBuilder.create<SessionReportContext>()
          .step(
            'verify-and-save-session',
            async (c) => {
              const gameSession = await c.queryRunner.manager.findOne(
                GameSession,
                {
                  where: { id: c.sessionId, userId: c.userId },
                },
              );

              if (!gameSession) {
                throw new NotFoundException(
                  'Session not found or does not belong to you',
                );
              }

              if (gameSession.nonceUsedAt) {
                throw new BadRequestException(
                  'Session has already been reported',
                );
              }

              const calculatedHash = this.calculateSessionHash(
                gameSession.nonce,
                reportSessionDto,
              );
              if (calculatedHash !== reportSessionDto.signature) {
                throw new BadRequestException('Session integrity check failed');
              }

              gameSession.score = c.score;
              gameSession.duration = c.duration;
              gameSession.metadata = c.metadata;
              gameSession.isVerified = true;
              gameSession.nonceUsedAt = new Date();
              
              // Mark session as suspicious if flagged by guard
              if (isSuspicious) {
                gameSession.isSuspicious = true;
                gameSession.suspicionReason = suspicionReason || 'Unknown';
                // Include suspicion info in metadata for investigation
                gameSession.metadata = {
                  ...c.metadata,
                  suspicion: {
                    reason: suspicionReason,
                    detectedAt: new Date().toISOString(),
                  },
                };
              }

              c.savedSession = await c.queryRunner.manager.save(
                GameSession,
                gameSession,
              );
            },
            async (c) => {
              if (c.savedSession) {
                c.savedSession.isVerified = false;
                c.savedSession.nonceUsedAt = null;
                c.savedSession.score = 0;
                c.savedSession.duration = 0;
                c.savedSession.metadata = null;
                await c.queryRunner.manager.save(c.savedSession);
              }
            },
          )
          .step(
            'save-input-events',
            async (c) => {
              const batchSize = 1000;
              const inputBatches = this.chunkArray(
                reportSessionDto.inputs,
                batchSize,
              );

              for (const batch of inputBatches) {
                const inputEvents = batch.map((input) =>
                  c.queryRunner.manager.create(InputEvent, {
                    gameSessionId: c.savedSession!.id,
                    eventType: input.eventType,
                    timestamp: input.timestamp,
                    eventData: input.eventData,
                    clientId: input.clientId,
                  }),
                );

                await c.queryRunner.manager.save(InputEvent, inputEvents);
                c.inputEvents.push(...inputEvents);
              }
            },
            async (c) => {
              if (c.savedSession?.id) {
                await c.queryRunner.manager.delete(InputEvent, {
                  gameSessionId: c.savedSession.id,
                });
              }
            },
          )
          .step(
            'update-user-stats',
            async (c) => {
              const user = await c.queryRunner.manager.findOne(User, {
                where: { id: c.userId },
              });

              if (!user) {
                throw new NotFoundException('User not found');
              }

              c.previousGamesPlayed = user.gamesPlayed;
              c.previousTotalScore = user.totalScore;
              c.previousHighestScore = user.highestScore;

              user.gamesPlayed += 1;
              user.totalScore += c.score;
              user.highestScore = Math.max(user.highestScore, c.score);

              await c.queryRunner.manager.save(user);
            },
            async (c) => {
              if (c.userId) {
                await c.queryRunner.manager.update(User, c.userId, {
                  gamesPlayed: c.previousGamesPlayed,
                  totalScore: c.previousTotalScore,
                  highestScore: c.previousHighestScore,
                });
              }
            },
          )
          .step(
            'update-leaderboard',
            async (c) => {
              const lockKey = `leaderboard:user:${c.userId}`;
              const acquired = await this.cacheService.acquireLock(
                lockKey,
                30000,
                3,
              );
              if (!acquired) {
                throw new Error(
                  `Could not acquire leaderboard update lock for user ${c.userId}`,
                );
              }
              try {
                await this.leaderboardService.submitScore(c.userId, {
                  score: c.score,
                });
              } finally {
                await this.cacheService.releaseLock(acquired);
              }
            },
            async (c) => {
              try {
                await this.leaderboardService.submitScore(c.userId, {
                  score: c.previousHighestScore || 0,
                } as any);
              } catch {
                // Ignore compensation errors
              }
            },
          )
          .step(
            'award-badges',
            async (c) => {
              const context = {
                gameId: c.savedSession!.id,
                score: c.score,
                duration: c.duration,
                triggerEvent: 'game_completion',
              };

              await this.achievementService.checkAndAwardAchievements(
                c.userId,
                context,
                c.queryRunner.manager,
              );
            },
            async (c) => {
              try {
                const badges = await c.queryRunner.manager
                  .createQueryBuilder('ub', 'user_badges')
                  .where('ub.userId = :userId', { userId: c.userId })
                  .andWhere("ub.metadata->>'gameId' = :gameId", {
                    gameId: c.savedSession?.id,
                  })
                  .getMany();

                for (const badge of badges) {
                  await c.queryRunner.manager.remove(badge);
                }
              } catch {
                // Ignore compensation errors
              }
            },
          )
          .execute(ctx);

        await queryRunner.commitTransaction();

        this.logger.log(
          `Game session reported successfully for user ${userId}, session ${ctx.savedSession!.id}`,
        );

        const result = ctx.savedSession!;
        await this.idempotencyService.store(idempotencyKey, result, 600000);
        const durationMs = Date.now() - startTime;
        gameSessionOperationDurationHistogram.observe(
          { operation: 'reportSession', status: 'success' },
          durationMs,
        );
        gameSessionOperationsCounter.inc({
          operation: 'reportSession',
          status: 'success',
        });
        gameSessionScoreHistogram.observe(
          { status: 'success' },
          reportSessionDto.score,
        );
        return result;
      } catch (error) {
        await queryRunner.rollbackTransaction();
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Failed to report session for user ${userId}: ${errorMessage}`,
          error instanceof Error ? error.stack : '',
        );
        const durationMs = Date.now() - startTime;
        gameSessionOperationDurationHistogram.observe(
          { operation: 'reportSession', status: 'error' },
          durationMs,
        );
        gameSessionOperationsCounter.inc({
          operation: 'reportSession',
          status: 'error',
        });
        gameSessionErrorsCounter.inc({
          operation: 'reportSession',
          error_type: error?.name || 'Error',
        });
        throw error;
      } finally {
        await queryRunner.release();
      }
    } catch (error) {
      throw error;
    }
  }

  async findSessionsByUser(
    userId: string,
    requestingUser: { id: string; role: string },
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ sessions: GameSession[]; total: number }> {
    const startTime = Date.now();
    try {
      if (requestingUser.id !== userId && requestingUser.role !== 'admin') {
        throw new ForbiddenException('You can only access your own sessions');
      }

      const [sessions, total] = await this.gameSessionRepository
        .createQueryBuilder('gs')
        .select([
          'gs.id',
          'gs.userId',
          'gs.challengeId',
          'gs.score',
          'gs.duration',
          'gs.createdAt',
        ])
        .where('gs.userId = :userId', { userId })
        .orderBy('gs.createdAt', 'DESC')
        .limit(limit)
        .offset(offset)
        .getManyAndCount();

      const durationMs = Date.now() - startTime;
      gameSessionOperationDurationHistogram.observe(
        { operation: 'findSessionsByUser', status: 'success' },
        durationMs,
      );
      gameSessionOperationsCounter.inc({
        operation: 'findSessionsByUser',
        status: 'success',
      });
      return { sessions, total };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      gameSessionOperationDurationHistogram.observe(
        { operation: 'findSessionsByUser', status: 'error' },
        durationMs,
      );
      gameSessionOperationsCounter.inc({
        operation: 'findSessionsByUser',
        status: 'error',
      });
      gameSessionErrorsCounter.inc({
        operation: 'findSessionsByUser',
        error_type: error?.name || 'Error',
      });
      throw error;
    }
  }

  async findSessionById(sessionId: string): Promise<GameSession> {
    const startTime = Date.now();
    try {
      const session = await this.gameSessionRepository.findOne({
        where: { id: sessionId },
        relations: ['user', 'challenge', 'inputs'],
      });

      if (!session) {
        throw new NotFoundException('Game session not found');
      }

      const durationMs = Date.now() - startTime;
      gameSessionOperationDurationHistogram.observe(
        { operation: 'findSessionById', status: 'success' },
        durationMs,
      );
      gameSessionOperationsCounter.inc({
        operation: 'findSessionById',
        status: 'success',
      });
      return session;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      gameSessionOperationDurationHistogram.observe(
        { operation: 'findSessionById', status: 'error' },
        durationMs,
      );
      gameSessionOperationsCounter.inc({
        operation: 'findSessionById',
        status: 'error',
      });
      gameSessionErrorsCounter.inc({
        operation: 'findSessionById',
        error_type: error?.name || 'Error',
      });
      throw error;
    }
  }

  async getSessionAnalytics(
    userId?: string,
    challengeId?: string,
  ): Promise<SessionAnalytics> {
    const startTime = Date.now();
    try {
      const queryBuilder = this.gameSessionRepository.createQueryBuilder('gs');

      if (userId) {
        queryBuilder.andWhere('gs.userId = :userId', { userId });
      }

      if (challengeId) {
        queryBuilder.andWhere('gs.challengeId = :challengeId', { challengeId });
      }

      const analytics = await queryBuilder
        .select([
          'COUNT(*) as totalSessions',
          'AVG(gs.score) as averageScore',
          'MAX(gs.score) as highestScore',
          'AVG(gs.duration) as averageDuration',
        ])
        .getRawOne<{
          totalSessions: string;
          averageScore: number;
          highestScore: number;
          averageDuration: number;
        }>();

      const durationMs = Date.now() - startTime;
      gameSessionOperationDurationHistogram.observe(
        { operation: 'getSessionAnalytics', status: 'success' },
        durationMs,
      );
      gameSessionOperationsCounter.inc({
        operation: 'getSessionAnalytics',
        status: 'success',
      });
      return analytics as SessionAnalytics;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      gameSessionOperationDurationHistogram.observe(
        { operation: 'getSessionAnalytics', status: 'error' },
        durationMs,
      );
      gameSessionOperationsCounter.inc({
        operation: 'getSessionAnalytics',
        status: 'error',
      });
      gameSessionErrorsCounter.inc({
        operation: 'getSessionAnalytics',
        error_type: error?.name || 'Error',
      });
      throw error;
    }
  }

  private calculateSessionHash(
    nonce: string,
    sessionData: ReportSessionDto,
  ): string {
    const dataToHash = {
      challengeId: sessionData.challengeId,
      score: sessionData.score,
      duration: sessionData.duration,
      inputCount: sessionData.inputs.length,
      firstInput: sessionData.inputs[0]?.timestamp || 0,
      lastInput:
        sessionData.inputs[sessionData.inputs.length - 1]?.timestamp || 0,
    };

    const serverSecret =
      process.env.SESSION_HMAC_SECRET || 'default-dev-secret';

    return crypto
      .createHmac('sha256', serverSecret)
      .update(nonce + JSON.stringify(dataToHash))
      .digest('hex');
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
