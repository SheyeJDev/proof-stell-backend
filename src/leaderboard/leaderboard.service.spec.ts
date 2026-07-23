import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LeaderboardService } from './Leaderboard.service';
import { Leaderboard } from './entities/leaderboard.entity';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { RealtimeGateway } from '../common/gateways/realtime.gateway';
import { TypedConfigService } from '../common/config/typed-config.service';
import { NotificationService } from '../notification/notification.service';
import { CacheService } from '../cache/cache.service';

const mockEntry = { id: 1, userId: 'u1', score: 100, rank: 1, updatedAt: new Date() };

const mockQueryRunner = {
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
};

const mockDataSource = {
  createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  manager: { query: jest.fn() },
};

const mockRepository = {
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  clear: jest.fn(),
};

const mockConfigService = {
  leaderboardRecalculationStrategy: 'immediate',
};

const mockNotificationService = { create: jest.fn() };

const mockCacheService = { 
  del: jest.fn(),
  withLock: jest.fn().mockImplementation((_key, _ttl, callback) => callback()),
};

describe('LeaderboardService', () => {
  let service: LeaderboardService;
  let gateway: RealtimeGateway;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset queryBuilder mock
    mockQueryRunner.manager.createQueryBuilder.mockReturnValue({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderboardService,
        { provide: getRepositoryToken(Leaderboard), useValue: mockRepository },
        { provide: DataSource, useValue: mockDataSource },
        { provide: TypedConfigService, useValue: mockConfigService },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: CacheService, useValue: mockCacheService },
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

    service = module.get<LeaderboardService>(LeaderboardService);
    gateway = module.get<RealtimeGateway>(RealtimeGateway);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('submitScore', () => {
    it('creates new entry within a transaction', async () => {
      const qb = mockQueryRunner.manager.createQueryBuilder();
      (qb.getOne as jest.Mock).mockResolvedValue(null); // no existing entry
      mockQueryRunner.manager.create.mockReturnValue({ ...mockEntry, rank: 0 });
      mockQueryRunner.manager.save.mockResolvedValue(mockEntry);
      mockQueryRunner.manager.query.mockResolvedValue(undefined);
      mockQueryRunner.manager.findOneOrFail.mockResolvedValue(mockEntry);
      mockRepository.findAndCount.mockResolvedValue([[mockEntry], 1]);

      const result = await service.submitScore('u1', { score: 100 });

      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
      expect(mockCacheService.del).toHaveBeenCalled();
      expect(result).toEqual(mockEntry);
    });

    it('updates score when higher within a transaction', async () => {
      const existing = { ...mockEntry, score: 50 };
      const qb = mockQueryRunner.manager.createQueryBuilder();
      (qb.getOne as jest.Mock).mockResolvedValue(existing);
      mockQueryRunner.manager.save.mockResolvedValue({ ...existing, score: 100 });
      mockQueryRunner.manager.query.mockResolvedValue(undefined);
      mockQueryRunner.manager.findOneOrFail.mockResolvedValue({ ...mockEntry, rank: 2 });
      mockRepository.findAndCount.mockResolvedValue([[mockEntry], 1]);

      await service.submitScore('u1', { score: 100 });

      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockCacheService.del).toHaveBeenCalled();
    });

    it('throws BadRequestException for equal or lower score', async () => {
      const existing = { ...mockEntry, score: 100 };
      const qb = mockQueryRunner.manager.createQueryBuilder();
      (qb.getOne as jest.Mock).mockResolvedValue(existing);

      await expect(service.submitScore('u1', { score: 50 })).rejects.toThrow(
        BadRequestException,
      );
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('rolls back on unexpected error', async () => {
      const qb = mockQueryRunner.manager.createQueryBuilder();
      (qb.getOne as jest.Mock).mockRejectedValue(new Error('DB error'));

      await expect(service.submitScore('u1', { score: 100 })).rejects.toThrow('DB error');
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });

  describe('getUserLeaderboard', () => {
    it('throws NotFoundException for non-existent user', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      await expect(service.getUserLeaderboard('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('resetLeaderboard', () => {
    it('clears repository and invalidates cache', async () => {
      mockRepository.findAndCount.mockResolvedValue([[], 0]);
      await service.resetLeaderboard();
      expect(mockRepository.clear).toHaveBeenCalled();
      expect(mockCacheService.del).toHaveBeenCalled();
      expect(gateway.emitLeaderboardUpdate).toHaveBeenCalled();
    });
  });

  describe('recalculateRanks', () => {
    it('uses SQL window function and invalidates cache', async () => {
      mockDataSource.manager.query.mockResolvedValue(undefined);
      await service.recalculateRanks();
      expect(mockDataSource.manager.query).toHaveBeenCalledWith(
        expect.stringContaining('RANK()'),
      );
      expect(mockCacheService.del).toHaveBeenCalled();
    });
  });
});
