import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GameSessionService } from './game-session.service';
import { GameSession } from './entities/game-session.entity';
import { InputEvent } from './entities/input-event.entity';
import { User } from '../users/entities/user.entity';
import { DataSource } from 'typeorm';
import { LeaderboardService } from '../leaderboard/Leaderboard.service';
import { AchievementService } from '../badge/services/achievement.service';
import { IdempotencyService } from '../common/services/idempotency.service';
import { CacheService } from '../cache/cache.service';

const mockGameSessionRepository = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockInputEventRepository = {
  create: jest.fn(),
  save: jest.fn(),
};

const mockUserRepository = {
  findOne: jest.fn(),
  save: jest.fn(),
};

const mockDataSource = {
  createQueryRunner: jest.fn().mockReturnValue({
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      createQueryBuilder: jest.fn(),
    },
  }),
};

const mockLeaderboardService = {
  submitScore: jest.fn(),
};

const mockAchievementService = {
  checkAndAwardAchievements: jest.fn(),
};

const mockIdempotencyService = {
  generateKey: jest.fn().mockReturnValue('idemp-key'),
  check: jest.fn().mockResolvedValue(null),
  store: jest.fn().mockResolvedValue(undefined),
};

const mockCacheService = {
  acquireLock: jest.fn().mockResolvedValue({ key: 'lock', token: 'token' }),
  releaseLock: jest.fn().mockResolvedValue(true),
};

describe('GameSessionService', () => {
  let service: GameSessionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameSessionService,
        { provide: getRepositoryToken(GameSession), useValue: mockGameSessionRepository },
        { provide: getRepositoryToken(InputEvent), useValue: mockInputEventRepository },
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        { provide: DataSource, useValue: mockDataSource },
        { provide: LeaderboardService, useValue: mockLeaderboardService },
        { provide: AchievementService, useValue: mockAchievementService },
        { provide: IdempotencyService, useValue: mockIdempotencyService },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    service = module.get<GameSessionService>(GameSessionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
