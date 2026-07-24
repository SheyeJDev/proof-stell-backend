import { Test, TestingModule } from '@nestjs/testing';
import { MintService } from './mint.service';
import { CacheService } from '../cache/cache.service';

const mockCacheService = {
  withLock: jest.fn().mockImplementation((_key, _ttl, callback) => callback()),
};

describe('MintService', () => {
  let service: MintService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MintService,
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    service = module.get<MintService>(MintService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
