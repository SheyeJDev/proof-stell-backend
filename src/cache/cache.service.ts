import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

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
  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

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
    const value = await this.cacheManager.get<T>(key);
    if (value) {
      this.hits++;
      this.logger.debug(`Cache hit for key: ${key}`);
    } else {
      this.misses++;
      this.logger.debug(`Cache miss for key: ${key}`);
    }
    return value;
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
    await this.cacheManager.set(key, value, ttl);
    this.logger.debug(`Cache set for key: ${key}, ttl: ${ttl}`);
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
    const redisClient = this.getRedisClient();
    if (redisClient?.incr) {
      const value = await redisClient.incr(key);
      if (value === 1 && ttl && redisClient.expire) {
        await redisClient.expire(key, ttl);
      }
      this.logger.debug(`Cache increment for key: ${key}, value: ${value}`);
      return value;
    }

    const current = (await this.get<number>(key)) || 0;
    const value = current + 1;
    await this.set(key, value, ttl);
    return value;
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
    const redisClient = this.getRedisClient();

    if (!redisClient?.ping) {
      throw new Error('Redis client is unavailable');
    }

    try {
      const response = await redisClient.ping();
      if (typeof response === 'string' && response.toUpperCase() === 'PONG') {
        return;
      }
      throw new Error('Redis ping returned an unexpected response');
    } catch {
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
    await this.cacheManager.del(key);
    const redisClient = this.getRedisClient();
    if (redisClient?.del) {
      await redisClient.del(key);
    }
    this.logger.debug(`Cache entry deleted for key: ${key}`);
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
