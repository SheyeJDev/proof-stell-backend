# Cache Service Documentation

## Overview

The CacheService provides a unified interface for caching operations with Redis backend. It supports both memory and Redis-based caching, tracks cache statistics (hits/misses), and provides atomic operations for counters.

## Cache Key Convention

Follow the pattern: `<module>:<entity>:<id>`

### Key Format Rules

- **Module:** Lowercase module name (e.g., `user`, `leaderboard`, `game`)
- **Entity:** Lowercase entity name (e.g., `profile`, `ranking`, `session`)
- **ID:** Entity identifier (can be string, number, or composite key)

### Examples

| Module | Entity | ID | Full Key |
|---|---|---|---|
| user | profile | 123 | `user:profile:123` |
| leaderboard | ranking | daily | `leaderboard:ranking:daily` |
| game | session | abc-123 | `game:session:abc-123` |
| auth | token | jwt_hash | `auth:token:abc123def456` |
| api | rate_limit | user_123 | `api:rate_limit:user_123` |

### Composite Keys

For composite identifiers, use consistent separators:

```typescript
// Good: Using colon as separator
`leaderboard:ranking:daily:2026-07-18`

// Good: Using underscore for complex IDs
`game:session:user_123_game_456`

// Avoid: Inconsistent separators
`leaderboard:ranking:daily-2026-07-18` // Don't mix separators
```

## TTL Values by Entity Type

### Recommended TTL Values

| Entity Type | TTL | Reason |
|---|---|---|
| User Profile | 3600s (1 hour) | User data changes infrequently |
| User Session | 1800s (30 min) | Session timeout alignment |
| Leaderboard Ranking | 300s (5 min) | Frequent score updates |
| Game Session | 600s (10 min) | Active game duration |
| API Rate Limit | 60s (1 min) | Rate limiting window |
| Auth Token | 7200s (2 hours) | Token expiration alignment |
| Static Config | 86400s (24 hours) | Rarely changes |
| Temporary Data | 60s (1 min) | Short-lived operations |

### TTL Configuration

```typescript
// CacheService usage with TTL
await cacheService.set('user:profile:123', userData, 3600); // 1 hour
await cacheService.set('leaderboard:ranking:daily', rankings, 300); // 5 minutes
await cacheService.set('game:session:abc-123', sessionData, 600); // 10 minutes
```

## Cache Invalidation Patterns

### Manual Invalidation

```typescript
// Delete specific key
await cacheService.del('user:profile:123');

// Delete pattern (requires Redis SCAN)
const keys = await redisClient.keys('user:profile:*');
await Promise.all(keys.map(key => cacheService.del(key)));
```

### Time-Based Invalidation

```typescript
// Rely on TTL for automatic expiration
await cacheService.set('leaderboard:ranking:daily', rankings, 300);
```

### Event-Based Invalidation

```typescript
// Invalidate on data updates
async updateUserProfile(userId: number, data: any) {
  await userRepository.update(userId, data);
  await cacheService.del(`user:profile:${userId}`);
}
```

### Pattern-Based Invalidation

```typescript
// Invalidate all leaderboard caches
async invalidateLeaderboardCaches() {
  const keys = await redisClient.keys('leaderboard:*');
  await Promise.all(keys.map(key => cacheService.del(key)));
}
```

## Cache Service API

### get<T>(key: string): Promise<T | undefined>

Retrieves a value from the cache with hit/miss tracking.

```typescript
const userData = await cacheService.get<User>('user:profile:123');
if (userData) {
  console.log('Cache hit:', userData);
} else {
  console.log('Cache miss - fetch from database');
}
```

### set<T>(key: string, value: T, ttl?: number): Promise<void>

Sets a value in the cache with optional TTL.

```typescript
// With TTL
await cacheService.set('user:profile:123', userData, 3600);

// Without TTL (uses cache-manager default)
await cacheService.set('leaderboard:ranking:daily', rankings);
```

### increment(key: string, ttl?: number): Promise<number>

Atomically increments a counter value.

```typescript
// Rate limiting counter
const requestCount = await cacheService.increment('api:rate_limit:user_123', 60);
if (requestCount > 100) {
  throw new Error('Rate limit exceeded');
}
```

### del(key: string): Promise<void>

Deletes a specific key from the cache.

```typescript
await cacheService.del('user:profile:123');
```

### ping(): Promise<void>

Checks Redis connectivity.

```typescript
try {
  await cacheService.ping();
  console.log('Redis is healthy');
} catch (error) {
  console.error('Redis is down:', error.message);
}
```

### getStats(): CacheStats

Returns cache performance statistics.

```typescript
const stats = cacheService.getStats();
console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(2)}%`);
console.log(`Total requests: ${stats.totalRequests}`);
```

### resetStats(): void

Resets cache statistics counters.

```typescript
cacheService.resetStats();
```

## Best Practices

### 1. Always Use Consistent Key Format

```typescript
// Good
const key = `user:profile:${userId}`;

// Bad - inconsistent format
const key = `user-profile-${userId}`;
```

### 2. Set Appropriate TTL

```typescript
// Good - short TTL for frequently changing data
await cacheService.set('leaderboard:ranking:daily', rankings, 300);

// Good - longer TTL for rarely changing data
await cacheService.set('user:profile:123', userData, 3600);

// Bad - no TTL for frequently changing data
await cacheService.set('leaderboard:ranking:daily', rankings);
```

### 3. Invalidate on Updates

```typescript
async updateUserData(userId: number, data: any) {
  // Update database
  await userRepository.update(userId, data);
  
  // Invalidate cache
  await cacheService.del(`user:profile:${userId}`);
}
```

### 4. Use Atomic Operations for Counters

```typescript
// Good - atomic increment
const count = await cacheService.increment('api:requests', 60);

// Bad - non-atomic (race condition)
const current = await cacheService.get('api:requests') || 0;
await cacheService.set('api:requests', current + 1);
```

### 5. Monitor Cache Performance

```typescript
// Periodically check cache stats
setInterval(() => {
  const stats = cacheService.getStats();
  if (stats.hitRate < 0.8) {
    console.warn('Cache hit rate below 80%:', stats.hitRate);
  }
}, 60000);
```

## Common Patterns

### Cache-Aside Pattern

```typescript
async getUserProfile(userId: number) {
  const cacheKey = `user:profile:${userId}`;
  
  // Try cache first
  const cached = await cacheService.get<User>(cacheKey);
  if (cached) {
    return cached;
  }
  
  // Cache miss - fetch from database
  const user = await userRepository.findById(userId);
  
  // Store in cache
  await cacheService.set(cacheKey, user, 3600);
  
  return user;
}
```

### Write-Through Pattern

```typescript
async updateUserProfile(userId: number, data: any) {
  // Update database
  const updated = await userRepository.update(userId, data);
  
  // Update cache immediately
  await cacheService.set(`user:profile:${userId}`, updated, 3600);
  
  return updated;
}
```

### Rate Limiting Pattern

```typescript
async checkRateLimit(userId: number, limit: number = 100) {
  const key = `api:rate_limit:user_${userId}`;
  const count = await cacheService.increment(key, 60);
  
  if (count === 1) {
    // First request in window
    await cacheService.set(key, count, 60);
  }
  
  if (count > limit) {
    throw new Error('Rate limit exceeded');
  }
  
  return { remaining: limit - count };
}
```

### Distributed Lock Pattern

```typescript
// Note: Use DistributedLockService for production
async acquireLock(resourceId: string, ttl: number = 30) {
  const key = `lock:${resourceId}`;
  const acquired = await cacheService.set(key, '1', ttl);
  
  if (!acquired) {
    throw new Error('Lock already held');
  }
  
  return async () => {
    await cacheService.del(key);
  };
}
```

## Troubleshooting

### High Cache Miss Rate

**Symptoms:** Hit rate below 80%

**Solutions:**
- Increase TTL for frequently accessed data
- Check if cache keys are being invalidated too frequently
- Verify cache key format consistency
- Monitor Redis memory usage

### Memory Issues

**Symptoms:** Redis out of memory errors

**Solutions:**
- Reduce TTL values
- Implement cache eviction policies
- Monitor key space size
- Use more specific key patterns

### Stale Data

**Symptoms:** Cache returns outdated data

**Solutions:**
- Implement proper cache invalidation on updates
- Use shorter TTL for frequently changing data
- Add version numbers to cache keys
- Implement cache warming strategies

## Performance Considerations

### Redis Operations

- Use `increment` for atomic counter operations
- Batch operations using `mget`/`mset` when possible
- Avoid `KEYS` command in production (use `SCAN` instead)
- Use pipelining for multiple operations

### Memory Usage

- Monitor Redis memory usage regularly
- Set appropriate `maxmemory` and `maxmemory-policy` in Redis config
- Use data structures efficiently (e.g., hashes for related data)
- Implement key expiration to prevent memory leaks

### Network Latency

- Deploy Redis close to application servers
- Use connection pooling
- Consider local caching for extremely hot data
- Monitor Redis connection metrics

## Monitoring

### Key Metrics

- **Hit Rate:** Percentage of cache hits vs total requests
- **Memory Usage:** Redis memory consumption
- **Key Count:** Total number of cached keys
- **Latency:** Average cache operation time
- **Evictions:** Number of keys evicted due to memory pressure

### Monitoring Commands

```bash
# Redis info
redis-cli INFO memory
redis-cli INFO stats

# Cache service stats (via API)
GET /health/cache
```

## Security Considerations

- Never cache sensitive data without encryption
- Use Redis AUTH in production
- Restrict Redis network access
- Validate cache keys to prevent injection attacks
- Implement cache poisoning protection
