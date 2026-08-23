import { registerAs } from '@nestjs/config';
import * as os from 'os';

// Deterministic per-process scheduler identifier used as a fallback
// when SCHEDULER_INSTANCE_ID is not provided. Computed once at module
// load so every log line within a single process stays correlated.
const SCHEDULER_INSTANCE_ID_FALLBACK = `${os.hostname?.() || 'host'}-${process.pid}`;

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtIssuer: process.env.JWT_ISSUER || 'proof-stell-backend',
  jwtAudience: process.env.JWT_AUDIENCE || 'proof-stell-client',
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || '15m',
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10),
  leaderboardRecalculationStrategy:
    process.env.LEADERBOARD_RECALCULATION_STRATEGY || 'batch',
  redisHost: process.env.REDIS_HOST || 'localhost',
  redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
  mailHost: process.env.MAIL_HOST,
  mailPort: parseInt(process.env.MAIL_PORT || '587', 10),
  mailUser: process.env.MAIL_USER,
  mailPass: process.env.MAIL_PASS,
  mailFrom: process.env.MAIL_FROM,
  authMaxFailedAttempts: parseInt(
    process.env.AUTH_MAX_FAILED_ATTEMPTS || '5',
    10,
  ),
  authLockoutDurationSeconds: parseInt(
    process.env.AUTH_LOCKOUT_DURATION_SECONDS || '900',
    10,
  ),
  authAttemptWindowSeconds: parseInt(
    process.env.AUTH_ATTEMPT_WINDOW_SECONDS || '900',
    10,
  ),
  cronLockTtlMs: parseInt(process.env.CRON_LOCK_TTL_MS || '300000', 10),
  schedulerInstanceId:
    process.env.SCHEDULER_INSTANCE_ID || SCHEDULER_INSTANCE_ID_FALLBACK,
  starknetPrivateKey: process.env.STARKNET_PRIVATE_KEY,
  starknetAccountAddress: process.env.STARKNET_ACCOUNT_ADDRESS,
  mintContractAddress: process.env.MINT_CONTRACT_ADDRESS,
  blockchainReceiptTimeoutMs: parseInt(
    process.env.BLOCKCHAIN_RECEIPT_TIMEOUT_MS || '120000',
    10,
  ),
  allowedOrigins: process.env.ALLOWED_ORIGINS || 'http://localhost:3000',
  corsEnabled: process.env.CORS_ENABLED !== 'false',
  // Notification delivery configuration
  notificationMaxAttempts: parseInt(
    process.env.NOTIFICATION_MAX_ATTEMPTS || '5',
    10,
  ),
  notificationBaseDelayMs: parseInt(
    process.env.NOTIFICATION_BASE_DELAY_MS || '100',
    10,
  ),
  notificationDedupWindowMs: parseInt(
    process.env.NOTIFICATION_DEDUP_WINDOW_MS || '300000',
    10,
  ),
  // Add more config values as needed
}));
