import { SetMetadata } from '@nestjs/common';

export const CACHE_KEY_METADATA = 'cache:key';
export const CACHE_TTL_METADATA = 'cache:ttl';
export const CACHE_INVALIDATION_METADATA = 'cache:invalidation';

/**
 * Decorator to enable caching for a method
 * @param key - Cache key template. Use {param} for parameter interpolation
 * @param ttl - Time to live in seconds
 */
export const Cacheable = (key: string, ttl: number = 300) =>
  SetMetadata(CACHE_KEY_METADATA, { key, ttl });

/**
 * Decorator to specify cache TTL
 * @param ttl - Time to live in seconds
 */
export const CacheTTL = (ttl: number) => SetMetadata(CACHE_TTL_METADATA, ttl);

/**
 * Decorator to mark methods that should invalidate cache
 * @param patterns - Array of cache key patterns to invalidate
 */
export const CacheEvict = (patterns: string[]) =>
  SetMetadata(CACHE_INVALIDATION_METADATA, patterns);

/**
 * Cache key builders for common patterns
 */
export class CacheKeys {
  static readonly GLOBAL_LEADERBOARD =
    'leaderboard:global:page:{page}:limit:{limit}';
  static readonly USER_LEADERBOARD = 'leaderboard:user:{userId}';
  static readonly USER_PROFILE = 'user:profile:{userId}';
  static readonly USER_GAMES = 'games:user:{userId}';
  static readonly USER_GAME_STATS = 'games:user:{userId}:stats';
  static readonly ANALYTICS_TOP_EVENTS =
    'analytics:top-events:limit:{limit}:from:{from}:to:{to}';
  static readonly ANALYTICS_DASHBOARD = 'analytics:dashboard:days:{days}';
  static readonly TODAY_CHALLENGE = 'challenge:today:{date}';
  static readonly USER_BADGES = 'badges:user:{userId}';
  static readonly AVAILABLE_BADGES = 'badges:available';
  static readonly BLOCKCHAIN_MINT = 'blockchain:mint:{userId}';
  static readonly BLOCKCHAIN_TRANSFER = 'blockchain:transfer:{fromUserId}:{toUserId}';
  static readonly BLOCKCHAIN_BURN = 'blockchain:burn:{userId}';
  static readonly WALLET_TRANSACTION = 'wallet:transaction:{userId}';
  static readonly LEADERBOARD_UPDATE = 'leaderboard:user:{userId}';
  static readonly LEADERBOARD_RECALCULATE = 'leaderboard:recalculate';

  /**
   * Build cache key by replacing placeholders with actual values
   */
  static build(template: string, params: Record<string, any>): string {
    let key = template;
    for (const [param, value] of Object.entries(params)) {
      key = key.replace(new RegExp(`{${param}}`, 'g'), String(value));
    }
    return key;
  }
}
