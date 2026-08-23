import * as Joi from 'joi';

const jwtTtl = Joi.string()
  .pattern(/^\d+(ms|s|m|h|d)$/)
  .message('must be a duration like 15m, 24h, or 7d');

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ISSUER: Joi.string().default('proof-stell-backend'),
  JWT_AUDIENCE: Joi.string().default('proof-stell-client'),
  JWT_ACCESS_TTL: jwtTtl.default('15m'),
  JWT_REFRESH_TTL: jwtTtl.default('7d'),
  BCRYPT_SALT_ROUNDS: Joi.number().default(12),
  LEADERBOARD_RECALCULATION_STRATEGY: Joi.string().default('batch'),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  MAIL_HOST: Joi.string().required(),
  MAIL_PORT: Joi.number().integer().positive().default(587),
  MAIL_USER: Joi.string().required(),
  MAIL_PASS: Joi.string().required(),
  MAIL_FROM: Joi.string().required(),
  AUTH_MAX_FAILED_ATTEMPTS: Joi.number().integer().positive().default(5),
  AUTH_LOCKOUT_DURATION_SECONDS: Joi.number().integer().positive().default(900),
  AUTH_ATTEMPT_WINDOW_SECONDS: Joi.number().integer().positive().default(900),
  CRON_LOCK_TTL_MS: Joi.number().integer().positive().default(300000),
  SCHEDULER_INSTANCE_ID: Joi.string().optional(),
  STARKNET_PRIVATE_KEY: Joi.string().required(),
  STARKNET_ACCOUNT_ADDRESS: Joi.string().required(),
  MINT_CONTRACT_ADDRESS: Joi.string().required(),
  ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  CORS_ENABLED: Joi.string().valid('true', 'false').default('true'),
  // Notification delivery configuration
  NOTIFICATION_MAX_ATTEMPTS: Joi.number().integer().positive().default(5),
  NOTIFICATION_BASE_DELAY_MS: Joi.number().integer().positive().default(100),
  NOTIFICATION_DEDUP_WINDOW_MS: Joi.number()
    .integer()
    .positive()
    .default(300000),
  // Add more validations as needed
});
