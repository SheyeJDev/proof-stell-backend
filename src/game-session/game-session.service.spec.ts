import { Test, TestingModule } from '@nestjs/testing';
import { GameSessionService } from './game-session.service';
import { CacheService } from '../cache/cache.service';

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
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    service = module.get<GameSessionService>(GameSessionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
