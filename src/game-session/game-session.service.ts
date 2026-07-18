import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { GameSession } from './entities/game-session.entity';
import { InputEvent } from './entities/input-event.entity';
import { ReportSessionDto } from './dto/report-session.dto';
import { StartSessionDto } from './dto/start-session.dto';
import * as crypto from 'crypto';

export interface SessionAnalytics {
  totalSessions: string;
  averageScore: number;
  highestScore: number;
  averageDuration: number;
}

/**
 * Service for managing game sessions and input events.
 * 
 * This service handles game session lifecycle including starting sessions,
 * reporting session results with integrity verification, and retrieving
 * session analytics. It uses cryptographic nonces and HMAC signatures
 * to ensure session integrity and prevent cheating.
 * 
 * @example
 * ```typescript
 * const gameSessionService = new GameSessionService(
 *   gameSessionRepository,
 *   inputEventRepository,
 *   dataSource
 * );
 * const { sessionId, nonce } = await gameSessionService.startSession(
 *   'user-id',
 *   { challengeId: 'challenge-123' }
 * );
 * ```
 */
@Injectable()
export class GameSessionService {
  private readonly logger = new Logger(GameSessionService.name);

  /**
   * Creates a new GameSessionService instance.
   * 
   * @param gameSessionRepository - TypeORM repository for GameSession entity
   * @param inputEventRepository - TypeORM repository for InputEvent entity
   * @param dataSource - TypeORM data source for transaction management
   */
  constructor(
    @InjectRepository(GameSession)
    private gameSessionRepository: Repository<GameSession>,
    @InjectRepository(InputEvent)
    private inputEventRepository: Repository<InputEvent>,
    private dataSource: DataSource,
  ) {}

  /**
   * Starts a new game session for a user.
   * 
   * This method creates a new game session with a cryptographic nonce
   * for integrity verification. The nonce must be used when reporting
   * the session results to prevent tampering.
   * 
   * @param userId - The ID of the user starting the session
   * @param dto - Object containing the challenge ID
   * @returns Promise containing the session ID and nonce
   * 
   * @example
   * ```typescript
   * const { sessionId, nonce } = await gameSessionService.startSession(
   *   'user-id',
   *   { challengeId: 'challenge-123' }
   * );
   * // Store nonce securely for later reporting
   * ```
   */
  async startSession(
    userId: string,
    dto: StartSessionDto,
  ): Promise<{ sessionId: string; nonce: string }> {
    const nonce = crypto.randomBytes(32).toString('hex');
    const gameSession = this.gameSessionRepository.create({
      userId,
      challengeId: dto.challengeId,
      nonce,
      isVerified: false,
    });
    const savedSession = await this.gameSessionRepository.save(gameSession);
    return { sessionId: savedSession.id, nonce };
  }

  /**
   * Reports the results of a completed game session.
   * 
   * This method verifies session integrity using HMAC signature,
   * stores the session results, and batches input events for performance.
   * The session can only be reported once and must include a valid signature.
   * 
   * @param userId - The ID of the user reporting the session
   * @param reportSessionDto - Object containing session data, inputs, and signature
   * @returns Promise containing the saved game session
   * @throws {NotFoundException} If session not found or doesn't belong to user
   * @throws {BadRequestException} If session already reported or signature invalid
   * 
   * @example
   * ```typescript
   * const session = await gameSessionService.reportSession('user-id', {
   *   sessionId: 'session-id',
   *   challengeId: 'challenge-123',
   *   score: 100,
   *   duration: 60,
   *   inputs: [...],
   *   signature: 'hmac-signature'
   * });
   * ```
   */
  async reportSession(
    userId: string,
    reportSessionDto: ReportSessionDto,
  ): Promise<GameSession> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const gameSession = await queryRunner.manager.findOne(GameSession, {
        where: { id: reportSessionDto.sessionId, userId },
      });

      if (!gameSession) {
        throw new NotFoundException(
          'Session not found or does not belong to you',
        );
      }

      if (gameSession.nonceUsedAt) {
        throw new BadRequestException('Session has already been reported');
      }

      // Verify session HMAC integrity
      const calculatedHash = this.calculateSessionHash(
        gameSession.nonce,
        reportSessionDto,
      );
      if (calculatedHash !== reportSessionDto.signature) {
        throw new BadRequestException('Session integrity check failed');
      }

      // Update game session
      gameSession.score = reportSessionDto.score;
      gameSession.duration = reportSessionDto.duration;
      gameSession.metadata = reportSessionDto.metadata;
      gameSession.isVerified = true;
      gameSession.nonceUsedAt = new Date();

      const savedSession = await queryRunner.manager.save(
        GameSession,
        gameSession,
      );

      // Create input events in batches for performance
      const batchSize = 1000;
      const inputBatches = this.chunkArray(reportSessionDto.inputs, batchSize);

      for (const batch of inputBatches) {
        const inputEvents = batch.map((input) =>
          queryRunner.manager.create(InputEvent, {
            gameSessionId: savedSession.id,
            eventType: input.eventType,
            timestamp: input.timestamp,
            eventData: input.eventData,
            clientId: input.clientId,
          }),
        );

        await queryRunner.manager.save(InputEvent, inputEvents);
      }

      await queryRunner.commitTransaction();

      this.logger.log(
        `Game session reported successfully for user ${userId}, session ${savedSession.id}`,
      );

      return savedSession;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to report session for user ${userId}: ${errorMessage}`,
        error instanceof Error ? error.stack : '',
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Retrieves game sessions for a specific user.
   * 
   * This method returns paginated game sessions for a user. Users can
   * only access their own sessions unless they have admin role.
   * 
   * @param userId - The ID of the user to fetch sessions for
   * @param requestingUser - The user making the request (for authorization)
   * @param limit - Maximum number of sessions to return (default: 50)
   * @param offset - Number of sessions to skip (default: 0)
   * @returns Promise containing sessions array and total count
   * @throws {ForbiddenException} If user tries to access another user's sessions
   * 
   * @example
   * ```typescript
   * const { sessions, total } = await gameSessionService.findSessionsByUser(
   *   'user-id',
   *   { id: 'user-id', role: 'user' },
   *   50,
   *   0
   * );
   * ```
   */
  async findSessionsByUser(
    userId: string,
    requestingUser: { id: string; role: string },
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ sessions: GameSession[]; total: number }> {
    if (requestingUser.id !== userId && requestingUser.role !== 'admin') {
      throw new ForbiddenException('You can only access your own sessions');
    }

    // Avoid eager loading of large relations by default. Load only summary fields for listing.
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

    return { sessions, total };
  }

  /**
   * Retrieves a specific game session by ID.
   * 
   * This method returns complete session data including user, challenge,
   * and input event relations.
   * 
   * @param sessionId - The ID of the session to retrieve
   * @returns Promise containing the game session
   * @throws {NotFoundException} If session with the specified ID does not exist
   * 
   * @example
   * ```typescript
   * const session = await gameSessionService.findSessionById('session-id');
   * ```
   */
  async findSessionById(sessionId: string): Promise<GameSession> {
    const session = await this.gameSessionRepository.findOne({
      where: { id: sessionId },
      relations: ['user', 'challenge', 'inputs'],
    });

    if (!session) {
      throw new NotFoundException('Game session not found');
    }

    return session;
  }

  /**
   * Retrieves analytics for game sessions.
   * 
   * This method calculates aggregate statistics for game sessions,
   * optionally filtered by user or challenge. Returns total sessions,
   * average score, highest score, and average duration.
   * 
   * @param userId - Optional user ID to filter by
   * @param challengeId - Optional challenge ID to filter by
   * @returns Promise containing session analytics
   * 
   * @example
   * ```typescript
   * const analytics = await gameSessionService.getSessionAnalytics(
   *   'user-id',
   *   'challenge-123'
   * );
   * console.log(`Average score: ${analytics.averageScore}`);
   * ```
   */
  async getSessionAnalytics(
    userId?: string,
    challengeId?: string,
  ): Promise<SessionAnalytics> {
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

    return analytics as SessionAnalytics;
  }

  /**
   * Calculates the HMAC signature for session integrity verification.
   * 
   * This private method creates a cryptographic signature using the
   * session nonce and key session data to prevent tampering.
   * 
   * @param nonce - The cryptographic nonce from session start
   * @param sessionData - The session data to sign
   * @returns The HMAC signature as a hex string
   * @private
   */
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

  /**
   * Splits an array into chunks of specified size.
   * 
   * This private method is used for batching input events
   * to improve database insertion performance.
   * 
   * @param array - The array to chunk
   * @param size - The size of each chunk
   * @returns Array of chunks
   * @private
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
