import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CacheService } from './cache.service';
import { Logger } from '@nestjs/common';
import { DistributedLockService } from './distributed-lock.service';

describe('CacheService', () => {
  let service: CacheService;
  let cacheManager: any;

  const mockCacheManager: any = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    reset: jest.fn(),
  };

  const mockDistributedLockService = {
    acquire: jest.fn(),
    release: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
        {
          provide: DistributedLockService,
          useValue: mockDistributedLockService,
        },
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);
    cacheManager = module.get(CACHE_MANAGER);

    // Clear all mocks before each test
    jest.clearAllMocks();
    delete mockCacheManager.store;
  });

  afterEach(() => {
    service.resetStats();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('get', () => {
    it('should return cached value and increment hits', async () => {
      const key = 'test-key';
      const value = { data: 'test-data' };
      mockCacheManager.get.mockResolvedValue(value);

      const result = await service.get(key);

      expect(result).toEqual(value);
      expect(mockCacheManager.get).toHaveBeenCalledWith(key);
      expect(service.getStats().hits).toBe(1);
      expect(service.getStats().misses).toBe(0);
    });

    it('should return undefined and increment misses when cache miss', async () => {
      const key = 'nonexistent-key';
      mockCacheManager.get.mockResolvedValue(undefined);

      const result = await service.get(key);

      expect(result).toBeUndefined();
      expect(mockCacheManager.get).toHaveBeenCalledWith(key);
      expect(service.getStats().hits).toBe(0);
      expect(service.getStats().misses).toBe(1);
    });

    it('should handle null values as cache miss', async () => {
      const key = 'null-key';
      mockCacheManager.get.mockResolvedValue(null);

      const result = await service.get(key);

      expect(result).toBeNull();
      expect(service.getStats().hits).toBe(0);
      expect(service.getStats().misses).toBe(1);
    });
  });

  describe('set', () => {
    it('should set value with TTL', async () => {
      const key = 'test-key';
      const value = { data: 'test-data' };
      const ttl = 300;

      await service.set(key, value, ttl);

      expect(mockCacheManager.set).toHaveBeenCalledWith(key, value, ttl);
    });

    it('should set value without TTL', async () => {
      const key = 'test-key';
      const value = { data: 'test-data' };

      await service.set(key, value);

      expect(mockCacheManager.set).toHaveBeenCalledWith(key, value, undefined);
    });
  });

  describe('increment', () => {
    it('should atomically increment using redis client when available', async () => {
      const redisClient = {
        incr: jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(1),
      };
      mockCacheManager.store = {
        getClient: jest.fn().mockReturnValue(redisClient),
      };

      const result = await service.increment('auth:attempts:key', 900);

      expect(result).toBe(1);
      expect(redisClient.incr).toHaveBeenCalledWith('auth:attempts:key');
      expect(redisClient.expire).toHaveBeenCalledWith('auth:attempts:key', 900);
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });

    it('should fall back to cache get/set when redis client is unavailable', async () => {
      delete mockCacheManager.store;
      mockCacheManager.get.mockResolvedValue(2);

      const result = await service.increment('auth:attempts:key', 900);

      expect(result).toBe(3);
      expect(mockCacheManager.get).toHaveBeenCalledWith('auth:attempts:key');
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'auth:attempts:key',
        3,
        900,
      );
    });
  });

  describe('del', () => {
    it('should delete cache entry', async () => {
      const key = 'test-key';

      await service.del(key);

      expect(mockCacheManager.del).toHaveBeenCalledWith(key);
    });
  });

  describe('reset', () => {
    it('should no-op because cache-manager v6 does not expose reset', async () => {
      await service.reset();

      expect(mockCacheManager.reset).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      // Simulate some cache hits and misses
      mockCacheManager.get
        .mockResolvedValueOnce('hit1')
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce('hit2')
        .mockResolvedValueOnce(undefined);

      await service.get('key1'); // hit
      await service.get('key2'); // miss
      await service.get('key3'); // hit
      await service.get('key4'); // miss

      const stats = service.getStats();

      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(0.5);
      expect(stats.totalRequests).toBe(4);
    });

    it('should return zero hit rate when no requests', () => {
      const stats = service.getStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
      expect(stats.totalRequests).toBe(0);
    });
  });

  describe('resetStats', () => {
    it('should reset statistics', async () => {
      // Generate some stats
      mockCacheManager.get.mockResolvedValue('hit');
      await service.get('key1');

      expect(service.getStats().hits).toBe(1);

      service.resetStats();

      const stats = service.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
      expect(stats.totalRequests).toBe(0);
    });
  });

  describe('acquireLock', () => {
    it('should acquire lock via DistributedLockService', async () => {
      const lock = { key: 'test:lock', token: 'token-123' };
      mockDistributedLockService.acquire.mockResolvedValue(lock);

      const result = await service.acquireLock('test:lock', 30000, 3);

      expect(result).toEqual(lock);
      expect(mockDistributedLockService.acquire).toHaveBeenCalledWith('test:lock', 30000);
    });

    it('should retry acquiring lock up to the specified retries', async () => {
      mockDistributedLockService.acquire
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ key: 'test:lock', token: 'token' });

      const result = await service.acquireLock('test:lock', 30000, 2);

      expect(result).toEqual({ key: 'test:lock', token: 'token' });
      expect(mockDistributedLockService.acquire).toHaveBeenCalledTimes(3);
    });

    it('should return null after all retries are exhausted', async () => {
      mockDistributedLockService.acquire.mockResolvedValue(null);

      const result = await service.acquireLock('test:lock', 30000, 2);

      expect(result).toBeNull();
      expect(mockDistributedLockService.acquire).toHaveBeenCalledTimes(3);
    });
  });

  describe('releaseLock', () => {
    it('should delegate to DistributedLockService.release for a valid lock', async () => {
      const lock = { key: 'test:lock', token: 'token-123' };
      mockDistributedLockService.release.mockResolvedValue(true);

      const result = await service.releaseLock(lock);

      expect(result).toBe(true);
      expect(mockDistributedLockService.release).toHaveBeenCalledWith(lock);
    });

    it('should return false for null lock', async () => {
      const result = await service.releaseLock(null);
      expect(result).toBe(false);
      expect(mockDistributedLockService.release).not.toHaveBeenCalled();
    });
  });

  describe('withLock', () => {
    it('should execute callback when lock is acquired', async () => {
      const lock = { key: 'test:lock', token: 'token-123' };
      mockDistributedLockService.acquire.mockResolvedValue(lock);
      const callback = jest.fn().mockResolvedValue('result-value');

      const result = await service.withLock('test:lock', 30000, callback);

      expect(result).toBe('result-value');
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockDistributedLockService.release).toHaveBeenCalledWith(lock);
    });

    it('should return null and not execute callback when lock is not acquired', async () => {
      mockDistributedLockService.acquire.mockResolvedValue(null);
      const callback = jest.fn();

      const result = await service.withLock('test:lock', 30000, callback);

      expect(result).toBeNull();
      expect(callback).not.toHaveBeenCalled();
    });

    it('should release lock even when callback throws', async () => {
      const lock = { key: 'test:lock', token: 'token-123' };
      mockDistributedLockService.acquire.mockResolvedValue(lock);
      const error = new Error('work failed');
      const callback = jest.fn().mockRejectedValue(error);

      await expect(service.withLock('test:lock', 30000, callback)).rejects.toThrow(error);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockDistributedLockService.release).toHaveBeenCalledWith(lock);
    });
  });
});

