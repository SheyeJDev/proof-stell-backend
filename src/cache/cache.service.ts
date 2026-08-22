import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Counter, Histogram, register } from 'prom-client';
import { DistributedLockService } from './distributed-lock.service';
import { AcquiredLock } from './distributed-lock.service';

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

export const cacheHitCounter = getOrCreateCounter({
  name: 'cache_hit_total',
  help: 'Total number of cache hits',
  labelNames: ['operation', 'key_prefix'] as const,
});

export const cacheMissCounter = getOrCreateCounter({
  name: 'cache_miss_total',
  help: 'Total number of cache misses',
  labelNames: ['operation', 'key_prefix'] as const,
});

export const cacheOperationDurationHistogram = getOrCreateHistogram({
  name: 'cache_operation_duration_ms',
  help: 'Duration of cache operations in milliseconds',
  labelNames: ['operation', 'status'] as const,
  buckets: [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000],
});

export const cacheOperationsCounter = getOrCreateCounter({
  name: 'cache_operations_total',
  help: 'Total number of cache operations executed',
  labelNames: ['operation', 'status'] as const,
});

function getKeyPrefix(key: string): string {
  if (!key) return 'unknown';
  const parts = key.split(':');
  return parts[0] || 'default';
}

/**
 * Service for managing cache operations with Redis backend.
 *
 * This service provides a unified interface for caching operations including
 * get, set, increment, delete, and health checks. It tracks cache statistics
 * (hits/misses) and supports both memory and Redis-based caching.
 *
 * ## Cache Key Convention
 * Follow the pattern: `<module>:<entity>:<id>`
 * Examples:
 * - `user:profile:123`
 * - `leaderboard:ranking:daily`
 * - `game:session:abc-123`
 *
 * @example
 * ```typescript
 * const cacheService = new CacheService(cacheManager);
 * await cacheService.set('user:profile:123', userData, 3600);
 * const data = await cacheService.get('user:profile:123');
 * ```
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private hits = 0;
  private misses = 0;

  /**
   * Creates a new CacheService instance.
   *
   * @param cacheManager - The cache-manager instance (configured for Redis or memory)
   */
  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly distributedLockService: DistributedLockService,
  ) {}

  /**
   * Retrieves a value from the cache.
   *
   * This method fetches a value by key and tracks cache hit/miss statistics.
   *
   * @param key - The cache key to retrieve
   * @returns Promise containing the cached value or undefined if not found
   *
   * @example
   * ```typescript
   * const userData = await cacheService.get<User>('user:profile:123');
   * if (userData) {
   *   console.log('Cache hit:', userData);
   * }
   * ```
   */
  async get<T>(key: string): Promise<T | undefined> {
    const startTime = Date.now();
    const prefix = getKeyPrefix(key);
    try {
      const value = await this.cacheManager.get<T>(key);
      const durationMs = Date.now() - startTime;
      cacheOperationDurationHistogram.observe(
        { operation: 'get', status: 'success' },
        durationMs,
      );
      cacheOperationsCounter.inc({ operation: 'get', status: 'success' });

      if (value !== undefined && value !== null) {
        this.hits++;
        cacheHitCounter.inc({ operation: 'get', key_prefix: prefix });
        this.logger.debug(`Cache hit for key: ${key}`);
        return value;
      }
      this.misses++;
      cacheMissCounter.inc({ operation: 'get', key_prefix: prefix });
      this.logger.debug(`Cache miss for key: ${key}`);
      return undefined;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      cacheOperationDurationHistogram.observe(
        { operation: 'get', status: 'error' },
        durationMs,
      );
      cacheOperationsCounter.inc({ operation: 'get', status: 'error' });
      throw error;
    }
  }

  /**
   * Sets a value in the cache with an optional TTL.
   *
   * This method stores a value in the cache with an optional time-to-live
   * in seconds. If no TTL is provided, the value persists based on the
   * cache manager's default configuration.
   *
   * @param key - The cache key to set
   * @param value - The value to cache
   * @param ttl - Time-to-live in seconds (optional)
   *
   * @example
   * ```typescript
   * // Cache for 1 hour
   * await cacheService.set('user:profile:123', userData, 3600);
   *
   * // Cache with default TTL
   * await cacheService.set('leaderboard:ranking:daily', rankings);
   * ```
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const startTime = Date.now();
    try {
      await this.cacheManager.set(key, value, ttl);
      const durationMs = Date.now() - startTime;
      cacheOperationDurationHistogram.observe(
        { operation: 'set', status: 'success' },
        durationMs,
      );
      cacheOperationsCounter.inc({ operation: 'set', status: 'success' });
      this.logger.debug(`Cache set for key: ${key}, ttl: ${ttl}`);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      cacheOperationDurationHistogram.observe(
        { operation: 'set', status: 'error' },
        durationMs,
      );
      cacheOperationsCounter.inc({ operation: 'set', status: 'error' });
      throw error;
    }
  }

  /**
   * Increments a counter value in the cache.
   *
   * This method atomically increments a counter value. If the key doesn't exist,
   * it initializes to 1. Supports Redis INCR operation for better performance
   * when Redis is available.
   *
   * @param key - The cache key for the counter
   * @param ttl - Time-to-live in seconds (optional, only applied on first increment)
   * @returns Promise containing the new counter value
   *
   * @example
   * ```typescript
   * // Increment request counter with 5-minute TTL
   * const count = await cacheService.increment('api:requests:123', 300);
   * console.log('Request count:', count);
   * ```
   */
  async increment(key: string, ttl?: number): Promise<number> {
    const startTime = Date.now();
    try {
      const redisClient = this.getRedisClient();
      if (redisClient?.incr) {
        const value = await redisClient.incr(key);
        if (value === 1 && ttl && redisClient.expire) {
          await redisClient.expire(key, ttl);
        }
        const durationMs = Date.now() - startTime;
        cacheOperationDurationHistogram.observe(
          { operation: 'increment', status: 'success' },
          durationMs,
        );
        cacheOperationsCounter.inc({
          operation: 'increment',
          status: 'success',
        });
        this.logger.debug(`Cache increment for key: ${key}, value: ${value}`);
        return value;
      }

      const current = (await this.get<number>(key)) || 0;
      const value = current + 1;
      await this.set(key, value, ttl);
      const durationMs = Date.now() - startTime;
      cacheOperationDurationHistogram.observe(
        { operation: 'increment', status: 'success' },
        durationMs,
      );
      cacheOperationsCounter.inc({ operation: 'increment', status: 'success' });
      return value;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      cacheOperationDurationHistogram.observe(
        { operation: 'increment', status: 'error' },
        durationMs,
      );
      cacheOperationsCounter.inc({ operation: 'increment', status: 'error' });
      throw error;
    }
  }

  /**
   * Resets the cache (no-op in cache-manager v6+).
   *
   * This method is kept for compatibility but does not perform any operation
   * as cache-manager v6+ removed the reset functionality.
   *
   * @deprecated Use specific key deletion instead
   */
  async reset(): Promise<void> {
    /* Cache reset not available in cache-manager v6+ */
    this.logger.debug(`Cache reset called (no-op in cache-manager v6+)`);
  }

  /**
   * Pings the Redis server to check connectivity.
   *
   * This method verifies that the Redis backend is responsive by sending
   * a PING command and expecting a PONG response.
   *
   * @returns Promise that resolves if Redis is responsive
   * @throws {Error} If Redis client is unavailable or ping fails
   *
   * @example
   * ```typescript
   * try {
   *   await cacheService.ping();
   *   console.log('Redis is healthy');
   * } catch (error) {
   *   console.error('Redis is down:', error.message);
   * }
   * ```
   */
  async ping(): Promise<void> {
    const startTime = Date.now();
    const redisClient = this.getRedisClient();

    if (!redisClient?.ping) {
      const durationMs = Date.now() - startTime;
      cacheOperationDurationHistogram.observe(
        { operation: 'ping', status: 'error' },
        durationMs,
      );
      cacheOperationsCounter.inc({ operation: 'ping', status: 'error' });
      throw new Error('Redis client is unavailable');
    }

    try {
      const response = await redisClient.ping();
      if (typeof response === 'string' && response.toUpperCase() === 'PONG') {
        const durationMs = Date.now() - startTime;
        cacheOperationDurationHistogram.observe(
          { operation: 'ping', status: 'success' },
          durationMs,
        );
        cacheOperationsCounter.inc({ operation: 'ping', status: 'success' });
        return;
      }
      throw new Error('Redis ping returned an unexpected response');
    } catch (error) {
      const durationMs = Date.now() - startTime;
      cacheOperationDurationHistogram.observe(
        { operation: 'ping', status: 'error' },
        durationMs,
      );
      cacheOperationsCounter.inc({ operation: 'ping', status: 'error' });
      if (
        error instanceof Error &&
        error.message === 'Redis ping returned an unexpected response'
      ) {
        throw error;
      }
      throw new Error('Redis ping failed');
    }
  }

  /**
   * Deletes a specific key from the cache.
   *
   * This method removes a key from both the cache-manager and the Redis
   * backend if available.
   *
   * @param key - The cache key to delete
   *
   * @example
   * ```typescript
   * await cacheService.del('user:profile:123');
   * ```
   */
  async del(key: string): Promise<void> {
    const startTime = Date.now();
    try {
      await this.cacheManager.del(key);
      const redisClient = this.getRedisClient();
      if (redisClient?.del) {
        await redisClient.del(key);
      }
      const durationMs = Date.now() - startTime;
      cacheOperationDurationHistogram.observe(
        { operation: 'del', status: 'success' },
        durationMs,
      );
      cacheOperationsCounter.inc({ operation: 'del', status: 'success' });
      this.logger.debug(`Cache entry deleted for key: ${key}`);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      cacheOperationDurationHistogram.observe(
        { operation: 'del', status: 'error' },
        durationMs,
      );
      cacheOperationsCounter.inc({ operation: 'del', status: 'error' });
      throw error;
    }
  }

  /**
   * Attempts to acquire a distributed lock for the given key.
   *
   * This method wraps the Redis-based distributed lock with retry logic
   * to handle concurrent acquisition attempts. If the lock cannot be
   * acquired after the specified number of retries, null is returned.
   *
   * @param key - The lock key to acquire
   * @param ttl - Time-to-live in milliseconds (default: 30000)
   * @param retries - Number of retry attempts (default: 3)
   * @returns Promise containing the acquired lock handle or null
   *
   * @example
   * ```typescript
   * const lock = await cacheService.acquireLock('leaderboard:recalculate', 30000, 3);
   * if (!lock) {
   *   console.log('Could not acquire lock');
   *   return;
   * }
   * try {
   *   // Critical section
   * } finally {
   *   await cacheService.releaseLock(lock);
   * }
   * ```
   */
  async acquireLock(
    key: string,
    ttl: number = 30000,
    retries = 3,
  ): Promise<AcquiredLock | null> {
    const startTime = Date.now();
    try {
      for (let attempt = 0; attempt <= retries; attempt++) {
        const lock = await this.distributedLockService.acquire(key, ttl);
        if (lock) {
          const durationMs = Date.now() - startTime;
          cacheOperationDurationHistogram.observe(
            { operation: 'acquireLock', status: 'success' },
            durationMs,
          );
          cacheOperationsCounter.inc({
            operation: 'acquireLock',
            status: 'success',
          });
          return lock;
        }
        if (attempt < retries) {
          await new Promise((resolve) =>
            setTimeout(resolve, 50 * (attempt + 1)),
          );
        }
      }
      const durationMs = Date.now() - startTime;
      cacheOperationDurationHistogram.observe(
        { operation: 'acquireLock', status: 'miss' },
        durationMs,
      );
      cacheOperationsCounter.inc({ operation: 'acquireLock', status: 'miss' });
      this.logger.warn(
        `Failed to acquire lock '${key}' after ${retries + 1} attempts`,
      );
      return null;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      cacheOperationDurationHistogram.observe(
        { operation: 'acquireLock', status: 'error' },
        durationMs,
      );
      cacheOperationsCounter.inc({ operation: 'acquireLock', status: 'error' });
      throw error;
    }
  }

  /**
   * Releases a previously acquired distributed lock.
   *
   * This method safely releases a lock using an atomic Lua script to
   * prevent releasing a lock that has been re-acquired by another instance.
   *
   * @param lock - The lock handle returned from acquireLock
   * @returns Promise containing true if the lock was released, false otherwise
   *
   * @example
   * ```typescript
   * const released = await cacheService.releaseLock(lock);
   * ```
   */
  async releaseLock(lock: AcquiredLock | null | undefined): Promise<boolean> {
    const startTime = Date.now();
    try {
      if (!lock) {
        return false;
      }
      const released = await this.distributedLockService.release(lock);
      const durationMs = Date.now() - startTime;
      cacheOperationDurationHistogram.observe(
        { operation: 'releaseLock', status: released ? 'success' : 'failure' },
        durationMs,
      );
      cacheOperationsCounter.inc({
        operation: 'releaseLock',
        status: released ? 'success' : 'failure',
      });
      return released;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      cacheOperationDurationHistogram.observe(
        { operation: 'releaseLock', status: 'error' },
        durationMs,
      );
      cacheOperationsCounter.inc({ operation: 'releaseLock', status: 'error' });
      throw error;
    }
  }

  /**
   * Executes a callback while holding a distributed lock.
   *
   * This helper acquires a lock, runs the provided callback, and releases
   * the lock in a finally block. Returns null if the lock cannot be acquired.
   *
   * @param key - The lock key to acquire
   * @param ttl - Time-to-live in milliseconds
   * @param callback - The async callback to execute while holding the lock
   * @returns Promise containing the callback result or null if lock not acquired
   *
   * @example
   * ```typescript
   * const result = await cacheService.withLock('leaderboard:recalculate', 30000, async () => {
   *   await recalculateRanks();
   *   return 'done';
   * });
   * if (!result) {
   *   console.log('Recalculation skipped: lock not acquired');
   * }
   * ```
   */
  async withLock<T>(
    key: string,
    ttl: number,
    callback: () => Promise<T>,
  ): Promise<T | null> {
    const startTime = Date.now();
    const lock = await this.acquireLock(key, ttl);
    if (!lock) {
      this.logger.debug(`Skipping work for lock '${key}'; not acquired.`);
      return null;
    }
    try {
      const result = await callback();
      const durationMs = Date.now() - startTime;
      cacheOperationDurationHistogram.observe(
        { operation: 'withLock', status: 'success' },
        durationMs,
      );
      cacheOperationsCounter.inc({ operation: 'withLock', status: 'success' });
      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      cacheOperationDurationHistogram.observe(
        { operation: 'withLock', status: 'error' },
        durationMs,
      );
      cacheOperationsCounter.inc({ operation: 'withLock', status: 'error' });
      throw error;
    } finally {
      await this.releaseLock(lock);
    }
  }

  async setIfNotExists<T>(
    key: string,
    value: T,
    ttl?: number,
  ): Promise<boolean> {
    const startTime = Date.now();
    try {
      const client = this.getRedisClient();
      if (client?.set) {
        const serialized = JSON.stringify(value);
        const options: any = { nx: true };
        if (ttl) {
          options.ex = ttl;
        }
        const result = await client.set(key, serialized, options);
        const success = result === 'OK';
        const durationMs = Date.now() - startTime;
        cacheOperationDurationHistogram.observe(
          {
            operation: 'setIfNotExists',
            status: success ? 'success' : 'exists',
          },
          durationMs,
        );
        cacheOperationsCounter.inc({
          operation: 'setIfNotExists',
          status: success ? 'success' : 'exists',
        });
        return success;
      }

      const existing = await this.get<T>(key);
      if (existing !== undefined) {
        const durationMs = Date.now() - startTime;
        cacheOperationDurationHistogram.observe(
          { operation: 'setIfNotExists', status: 'exists' },
          durationMs,
        );
        cacheOperationsCounter.inc({
          operation: 'setIfNotExists',
          status: 'exists',
        });
        return false;
      }
      await this.set(key, value, ttl);
      const durationMs = Date.now() - startTime;
      cacheOperationDurationHistogram.observe(
        { operation: 'setIfNotExists', status: 'success' },
        durationMs,
      );
      cacheOperationsCounter.inc({
        operation: 'setIfNotExists',
        status: 'success',
      });
      return true;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      cacheOperationDurationHistogram.observe(
        { operation: 'setIfNotExists', status: 'error' },
        durationMs,
      );
      cacheOperationsCounter.inc({
        operation: 'setIfNotExists',
        status: 'error',
      });
      throw error;
    }
  }

  async waitForValue<T>(
    key: string,
    timeoutMs: number,
    intervalMs = 100,
    predicate?: (value: T | undefined) => boolean,
  ): Promise<T | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await this.get<T>(key);
      if (value !== undefined && (!predicate || predicate(value))) {
        return value;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return undefined;
  }

  /**
   * Gets cache statistics including hits, misses, and hit rate.
   *
   * This method returns performance metrics for the cache service,
   * useful for monitoring and optimization.
   *
   * @returns Object containing hits, misses, hit rate, and total requests
   *
   * @example
   * ```typescript
   * const stats = cacheService.getStats();
   * console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(2)}%`);
   * ```
   */
  getStats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      totalRequests: total,
    };
  }

  /**
   * Resets cache statistics counters.
   *
   * This method zeroes out the hit and miss counters, useful for
   * periodic monitoring or testing.
   *
   * @example
   * ```typescript
   * cacheService.resetStats();
   * ```
   */
  resetStats() {
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Gets the underlying Redis client instance.
   *
   * This private method attempts to extract the Redis client from the
   * cache-manager store configuration. It handles multiple store implementations.
   *
   * @returns The Redis client instance or undefined if not available
   * @private
   */
  private getRedisClient(): any {
    const cacheManager = this.cacheManager as any;
    const store = cacheManager.store || cacheManager.stores?.[0];
    return store?.getClient?.() || store?.client || store?.redis || undefined;
  }
}
