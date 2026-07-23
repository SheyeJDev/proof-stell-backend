import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Repository } from 'typeorm';
import { MetricsService } from './metrics.service';
import { User } from '../../users/entities/user.entity';
import { Game } from 'src/game/entities/game.entity';

describe('MetricsService', () => {
  let service: MetricsService;
  let userRepository: Repository<User>;
  let gameRepository: Repository<Game>;
  let cacheManager: any;

  const mockUserRepository = {
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      getCount: jest.fn(),
      select: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    })),
    query: jest.fn(),
  };

  const mockGameRepository = {
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      getCount: jest.fn(),
      select: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    })),
  };

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(Game),
          useValue: mockGameRepository,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
    gameRepository = module.get<Repository<Game>>(getRepositoryToken(Game));
    cacheManager = module.get(CACHE_MANAGER);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getActiveUsers', () => {
    it('should return cached data if available', async () => {
      cacheManager.get.mockResolvedValue({ count: 42 });
      const result = await service.getActiveUsers();
      expect(result).toEqual({ count: 42 });
      expect(cacheManager.get).toHaveBeenCalled();
    });

    it('should query database when cache is empty', async () => {
      cacheManager.get.mockResolvedValue(undefined);
      mockUserRepository.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(10),
      });
      const result = await service.getActiveUsers();
      expect(result.count).toBe(10);
    });
  });
});