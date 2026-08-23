import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from '../src/cache/cache.service';
import { DistributedLockService } from '../src/cache/distributed-lock.service';
import { BlockchainService } from '../src/blockchain/blockchain.service';
import { WalletService } from '../src/wallet/wallet.service';
import { LeaderboardService } from '../src/leaderboard/Leaderboard.service';
import { GameSessionService } from '../src/game-session/game-session.service';
import { MintService } from '../src/mint/mint.service';
import { TypedConfigService } from '../src/common/config/typed-config.service';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { CacheModule } from '../src/cache/cache.module';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Leaderboard } from '../src/leaderboard/entities/leaderboard.entity';
import { GameSession } from '../src/game-session/entities/game-session.entity';
import { InputEvent } from '../src/game-session/entities/input-event.entity';
import { User } from '../src/users/entities/user.entity';
import { RealtimeGateway } from '../src/common/gateways/realtime.gateway';
import { NotificationService } from '../src/notification/notification.service';
import { InputEventType } from '../src/game-session/entities/input-event.entity';
import { IdempotencyService } from '../src/common/services/idempotency.service';
import { AchievementService } from '../src/badge/services/achievement.service';

const buildRedisClient = () => ({
  set: jest.fn().mockResolvedValue('OK'),
  eval: jest.fn().mockResolvedValue(1),
});

describe('Distributed Locks Integration Tests', () => {
  let redisClient: ReturnType<typeof buildRedisClient>;
  let cacheService: CacheService;
  let distributedLockService: DistributedLockService;

  beforeEach(async () => {
    redisClient = buildRedisClient();

    const module: TestingModule = await Test.createTestingModule({
      imports: [CacheModule],
      providers: [
        {
          provide: CACHE_MANAGER,
          useValue: {
            store: { getClient: () => redisClient },
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: TypedConfigService,
          useValue: {
            cronLockTtlMs: 300000,
            schedulerInstanceId: 'test-instance',
          },
        },
      ],
    }).compile();

    distributedLockService = module.get(DistributedLockService);
    cacheService = module.get(CacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('lock behavior under concurrent load', () => {
    it('should serialize lock acquisitions across concurrent calls', async () => {
      const order: string[] = [];
      const lockKey = 'test:concurrent:lock';

      const acquireAndRun = async (id: string) => {
        const result = await cacheService.withLock(lockKey, 10000, async () => {
          order.push(`start-${id}`);
          await new Promise((resolve) => setTimeout(resolve, 50));
          order.push(`end-${id}`);
          return `result-${id}`;
        });
        return result;
      };

      const results = await Promise.all([
        acquireAndRun('A'),
        acquireAndRun('B'),
        acquireAndRun('C'),
      ]);

      expect(results.filter((r) => r !== null)).toHaveLength(3);
      expect(order).toEqual([
        'start-A',
        'end-A',
        'start-B',
        'end-B',
        'start-C',
        'end-C',
      ]);
    });

    it('should release lock even when the protected work throws', async () => {
      const lockKey = 'test:throw:lock';
      const second = await cacheService.withLock(lockKey, 10000, async () => {
        throw new Error('work failed');
      });

      expect(second).toBeNull();
      const third = await cacheService.withLock(
        lockKey,
        10000,
        async () => 'recovered',
      );
      expect(third).toBe('recovered');
    });
  });

  describe('BlockchainService distributed lock behavior', () => {
    let blockchainService: BlockchainService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [CacheModule],
        providers: [
          BlockchainService,
          {
            provide: CACHE_MANAGER,
            useValue: {
              store: { getClient: () => redisClient },
              get: jest.fn(),
              set: jest.fn(),
              del: jest.fn(),
            },
          },
          {
            provide: TypedConfigService,
            useValue: {
              mintContractAddress: '0x123',
              cronLockTtlMs: 300000,
              schedulerInstanceId: 'test-instance',
              starknetPrivateKey: '0xabc',
              starknetAccountAddress: '0xdef',
            },
          },
          { provide: AnalyticsService, useValue: { track: jest.fn() } },
        ],
      }).compile();

      blockchainService = module.get<BlockchainService>(BlockchainService);
    });

    it('should only submit one blockchain transaction for concurrent mint requests', async () => {
      const mockExecute = jest
        .fn()
        .mockResolvedValue({ transaction_hash: '0xhash' });
      (blockchainService as any).account = { execute: mockExecute };
      (blockchainService as any).cacheService = cacheService;

      const calls: Promise<any>[] = [];
      for (let i = 0; i < 5; i++) {
        calls.push(blockchainService.sendMintTx(1));
      }

      const results = await Promise.all(calls);

      expect(results).toHaveLength(5);
      const successResults = results.filter(
        (r) => r !== null && r.transaction_hash,
      );
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(successResults.every((r) => r.transaction_hash === '0xhash')).toBe(
        true,
      );
    });
  });

  describe('WalletService transaction lock', () => {
    let walletService: WalletService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WalletService,
          { provide: CacheService, useValue: cacheService },
          {
            provide: 'CONFIG_SERVICE',
            useValue: { get: jest.fn() },
          },
        ],
      }).compile();

      walletService = module.get<WalletService>(WalletService);
    });

    it('should acquire and release wallet transaction lock around sendTransaction', async () => {
      const mockProvider = {
        getChainId: jest.fn().mockResolvedValue('0x1'),
        sendTransaction: jest.fn().mockResolvedValue({ hash: '0xtx' }),
      };
      (walletService as any).providers = { mock: mockProvider };
      (walletService as any).userState = {
        u1: {
          activeProviderName: 'mock',
          connectionStatus: {
            isConnected: true,
            address: '0xaddr',
            chainId: '0x1',
          },
        },
      };

      const result = await walletService.sendTransaction(
        'u1',
        { chainId: 1 },
        '0xaddr',
      );

      expect(result.hash).toBe('0xtx');
      expect(cacheService.acquireLock).toHaveBeenCalledWith(
        'wallet:transaction:u1',
        30000,
        3,
      );
      expect(cacheService.releaseLock).toHaveBeenCalled();
    });
  });

  describe('LeaderboardService recalculateRanks lock', () => {
    let leaderboardService: LeaderboardService;
    let mockDataSource: any;
    let mockRepository: any;

    beforeEach(async () => {
      mockRepository = {
        findOne: jest.fn(),
        find: jest.fn(),
        findAndCount: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
        clear: jest.fn(),
      };

      mockDataSource = {
        createQueryRunner: jest.fn().mockReturnValue({
          connect: jest.fn(),
          startTransaction: jest.fn(),
          commitTransaction: jest.fn(),
          rollbackTransaction: jest.fn(),
          release: jest.fn(),
          manager: {
            createQueryBuilder: jest.fn().mockReturnValue({
              setLock: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              getOne: jest.fn(),
            }),
            create: jest.fn(),
            save: jest.fn(),
            query: jest.fn(),
            findOneOrFail: jest.fn(),
          },
        }),
        manager: { query: jest.fn() },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          LeaderboardService,
          {
            provide: getRepositoryToken(Leaderboard),
            useValue: mockRepository,
          },
          { provide: DataSource, useValue: mockDataSource },
          {
            provide: TypedConfigService,
            useValue: { leaderboardRecalculationStrategy: 'batch' },
          },
          { provide: NotificationService, useValue: { create: jest.fn() } },
          { provide: CacheService, useValue: cacheService },
          {
            provide: RealtimeGateway,
            useValue: {
              emitLeaderboardUpdate: jest.fn(),
              emitUserRankChange: jest.fn(),
              emitLeaderboardStats: jest.fn(),
            },
          },
        ],
      }).compile();

      leaderboardService = module.get<LeaderboardService>(LeaderboardService);
    });

    it('should skip recalculation when lock is not acquired', async () => {
      const withLockSpy = jest
        .spyOn(cacheService, 'withLock')
        .mockResolvedValue(null);

      await leaderboardService.recalculateRanks();

      expect(withLockSpy).toHaveBeenCalledWith(
        'leaderboard:recalculate',
        30000,
        expect.any(Function),
      );
      expect(mockDataSource.manager.query).not.toHaveBeenCalled();
    });

    it('should perform recalculation when lock is acquired', async () => {
      const withLockSpy = jest
        .spyOn(cacheService, 'withLock')
        .mockImplementation((_key, _ttl, callback) => callback());

      await leaderboardService.recalculateRanks();

      expect(mockDataSource.manager.query).toHaveBeenCalled();
    });
  });

  describe('GameSessionService leaderboard lock', () => {
    let gameSessionService: GameSessionService;
    let mockDataSource: any;
    let mockGameSessionRepository: any;
    let mockInputEventRepository: any;
    let mockUserRepository: any;
    let mockLeaderboardService: any;
    let mockAchievementService: any;

    beforeEach(async () => {
      mockGameSessionRepository = {
        create: jest.fn(),
        save: jest.fn(),
        findOne: jest.fn(),
        createQueryBuilder: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          offset: jest.fn().mockReturnThis(),
          getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
        }),
      };

      mockInputEventRepository = {
        create: jest.fn(),
        save: jest.fn(),
      };

      mockUserRepository = {
        findOne: jest.fn(),
        save: jest.fn(),
        update: jest.fn(),
        createQueryBuilder: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        }),
      };

      mockLeaderboardService = {
        submitScore: jest
          .fn()
          .mockResolvedValue({ id: 1, userId: 'u1', score: 100, rank: 1 }),
      };

      mockAchievementService = {
        checkAndAwardAchievements: jest.fn(),
      };

      mockDataSource = {
        createQueryRunner: jest.fn().mockReturnValue({
          connect: jest.fn(),
          startTransaction: jest.fn(),
          commitTransaction: jest.fn(),
          rollbackTransaction: jest.fn(),
          release: jest.fn(),
          manager: {
            findOne: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue({
              setLock: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              getOne: jest.fn(),
            }),
          },
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GameSessionService,
          {
            provide: getRepositoryToken(GameSession),
            useValue: mockGameSessionRepository,
          },
          {
            provide: getRepositoryToken(InputEvent),
            useValue: mockInputEventRepository,
          },
          { provide: getRepositoryToken(User), useValue: mockUserRepository },
          { provide: DataSource, useValue: mockDataSource },
          { provide: CacheService, useValue: cacheService },
          { provide: LeaderboardService, useValue: mockLeaderboardService },
          {
            provide: IdempotencyService,
            useValue: {
              generateKey: (op: string, id: string) => `${op}:${id}`,
              check: jest.fn().mockResolvedValue(null),
              store: jest.fn(),
            },
          },
          { provide: AchievementService, useValue: mockAchievementService },
        ],
      }).compile();

      gameSessionService = module.get<GameSessionService>(GameSessionService);
    });

    it('should acquire and release leaderboard lock around submitScore', async () => {
      const mockQueryRunner = mockDataSource.createQueryRunner();
      mockQueryRunner.manager.findOne.mockResolvedValue({
        id: 'session-1',
        userId: 'u1',
        nonce: 'nonce',
        nonceUsedAt: null,
      });
      mockQueryRunner.manager.save.mockResolvedValue({ id: 'session-1' });
      mockQueryRunner.manager.delete.mockResolvedValue(undefined);

      jest
        .spyOn(gameSessionService as any, 'calculateSessionHash')
        .mockReturnValue('fake-sig');

      await gameSessionService.reportSession('u1', {
        sessionId: 'session-1',
        challengeId: 'challenge-1',
        score: 100,
        duration: 60,
        signature: 'fake-sig',
        metadata: {},
        inputs: [
          {
            eventType: InputEventType.CLICK,
            timestamp: Date.now(),
            eventData: {},
            clientId: 'c1',
          },
        ],
      });

      expect(cacheService.acquireLock).toHaveBeenCalledWith(
        expect.stringContaining('leaderboard:user:u1'),
        30000,
        3,
      );
      expect(cacheService.releaseLock).toHaveBeenCalled();
      expect(mockLeaderboardService.submitScore).toHaveBeenCalledWith('u1', {
        score: 100,
      });
    });
  });

  describe('MintService distributed lock', () => {
    let mintService: MintService;
    let mockDataSource: any;
    let mockMintRepository: any;
    let mockBlockchainService: any;
    let mockIdempotencyService: any;

    beforeEach(async () => {
      mockMintRepository = {
        create: jest.fn(),
        save: jest.fn(),
      };

      mockBlockchainService = {
        sendMintTx: jest.fn().mockResolvedValue({ transaction_hash: '0xhash' }),
        waitForTransactionReceipt: jest
          .fn()
          .mockResolvedValue({ status: 'ACCEPTED_ON_L2', blockNumber: 1 }),
      };

      mockIdempotencyService = {
        generateKey: jest.fn(),
        check: jest.fn().mockResolvedValue(null),
        store: jest.fn(),
      };

      mockDataSource = {
        createQueryRunner: jest.fn().mockReturnValue({
          connect: jest.fn(),
          startTransaction: jest.fn(),
          commitTransaction: jest.fn(),
          rollbackTransaction: jest.fn(),
          release: jest.fn(),
          manager: {
            create: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
          },
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MintService,
          {
            provide: getRepositoryToken(
              require('../src/mint/entities/mint.entity').Mint,
            ),
            useValue: mockMintRepository,
          },
          { provide: DataSource, useValue: mockDataSource },
          { provide: BlockchainService, useValue: mockBlockchainService },
          { provide: CacheService, useValue: cacheService },
          { provide: IdempotencyService, useValue: mockIdempotencyService },
        ],
      }).compile();

      mintService = module.get<MintService>(MintService);
    });

    it('should acquire mint lock before executing blockchain transaction', async () => {
      await mintService.mint(1);

      expect(cacheService.withLock).toHaveBeenCalledWith(
        expect.stringContaining('mint:lock:1'),
        30000,
        expect.any(Function),
      );
      expect(mockBlockchainService.sendMintTx).toHaveBeenCalledWith(1);
    });
  });
});
