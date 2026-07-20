import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  jwtAccessTtl: string;
  jwtRefreshTtl: string;
  bcryptSaltRounds: number;
  leaderboardRecalculationStrategy: string;
  redisHost: string;
  redisPort: number;
  mailHost: string;
  mailPort: number;
  mailUser: string;
  mailPass: string;
  mailFrom: string;
  authMaxFailedAttempts: number;
  authLockoutDurationSeconds: number;
  authAttemptWindowSeconds: number;
  cronLockTtlMs: number;
  schedulerInstanceId: string;
  starknetPrivateKey: string;
  starknetAccountAddress: string;
  mintContractAddress: string;
  blockchainReceiptTimeoutMs: number;
  allowedOrigins: string;
  corsEnabled: boolean;
  // Add more config types as needed
}

@Injectable()
export class TypedConfigService {
  constructor(private readonly configService: ConfigService) {}

  get app(): AppConfig {
    return {
      port: this.configService.get<number>('app.port'),
      nodeEnv: this.configService.get<string>('app.nodeEnv'),
      databaseUrl: this.configService.get<string>('app.databaseUrl'),
      jwtSecret: this.configService.get<string>('app.jwtSecret'),
      jwtIssuer: this.configService.get<string>(
        'app.jwtIssuer',
        'proof-stell-backend',
      ),
      jwtAudience: this.configService.get<string>(
        'app.jwtAudience',
        'proof-stell-client',
      ),
      jwtAccessTtl: this.configService.get<string>('app.jwtAccessTtl', '15m'),
      jwtRefreshTtl: this.configService.get<string>('app.jwtRefreshTtl', '7d'),
      bcryptSaltRounds: this.configService.get<number>(
        'app.bcryptSaltRounds',
        12,
      ),
      leaderboardRecalculationStrategy: this.configService.get<string>(
        'app.leaderboardRecalculationStrategy',
        'batch',
      ),
      redisHost: this.configService.get<string>('app.redisHost', 'localhost'),
      redisPort: this.configService.get<number>('app.redisPort', 6379),
      mailHost: this.configService.get<string>('app.mailHost'),
      mailPort: this.configService.get<number>('app.mailPort', 587),
      mailUser: this.configService.get<string>('app.mailUser'),
      mailPass: this.configService.get<string>('app.mailPass'),
      mailFrom: this.configService.get<string>('app.mailFrom'),
      authMaxFailedAttempts: this.configService.get<number>(
        'app.authMaxFailedAttempts',
        5,
      ),
      authLockoutDurationSeconds: this.configService.get<number>(
        'app.authLockoutDurationSeconds',
        900,
      ),
      authAttemptWindowSeconds: this.configService.get<number>(
        'app.authAttemptWindowSeconds',
        900,
      ),
      cronLockTtlMs: this.configService.get<number>(
        'app.cronLockTtlMs',
        300000,
      ),
      schedulerInstanceId: this.configService.get<string>(
        'app.schedulerInstanceId',
        // Fallback is overridden on construction if `os`/`process` are
        // available; this default only kicks in during unit tests.
        'instance-0',
      ),
      starknetPrivateKey: this.configService.get<string>(
        'app.starknetPrivateKey',
      ),
      starknetAccountAddress: this.configService.get<string>(
        'app.starknetAccountAddress',
      ),
      mintContractAddress: this.configService.get<string>(
        'app.mintContractAddress',
      ),
      blockchainReceiptTimeoutMs: this.configService.get<number>(
        'app.blockchainReceiptTimeoutMs',
        120000,
      ),
      allowedOrigins: this.configService.get<string>(
        'app.allowedOrigins',
        'http://localhost:3000',
      ),
      corsEnabled: this.configService.get<boolean>('app.corsEnabled', true),
      // Add more config getters as needed
    };
  }

  // Direct getters for convenience
  get port() {
    return this.app.port;
  }
  get nodeEnv() {
    return this.app.nodeEnv;
  }
  get databaseUrl() {
    return this.app.databaseUrl;
  }
  get jwtSecret() {
    return this.app.jwtSecret;
  }
  get jwtIssuer() {
    return this.app.jwtIssuer;
  }
  get jwtAudience() {
    return this.app.jwtAudience;
  }
  get jwtAccessTtl() {
    return this.app.jwtAccessTtl;
  }
  get jwtRefreshTtl() {
    return this.app.jwtRefreshTtl;
  }
  get bcryptSaltRounds() {
    return this.app.bcryptSaltRounds;
  }
  get leaderboardRecalculationStrategy() {
    return this.app.leaderboardRecalculationStrategy;
  }
  get redisHost() {
    return this.app.redisHost;
  }
  get redisPort() {
    return this.app.redisPort;
  }
  get mailHost() {
    return this.app.mailHost;
  }
  get mailPort() {
    return this.app.mailPort;
  }
  get mailUser() {
    return this.app.mailUser;
  }
  get mailPass() {
    return this.app.mailPass;
  }
  get mailFrom() {
    return this.app.mailFrom;
  }
  get authMaxFailedAttempts() {
    return this.app.authMaxFailedAttempts;
  }
  get authLockoutDurationSeconds() {
    return this.app.authLockoutDurationSeconds;
  }
  get authAttemptWindowSeconds() {
    return this.app.authAttemptWindowSeconds;
  }
  get cronLockTtlMs() {
    return this.app.cronLockTtlMs;
  }
  get schedulerInstanceId() {
    return this.app.schedulerInstanceId;
  }
  get starknetPrivateKey() {
    return this.app.starknetPrivateKey;
  }
  get starknetAccountAddress() {
    return this.app.starknetAccountAddress;
  }
  get mintContractAddress() {
    return this.app.mintContractAddress;
  }
  get blockchainReceiptTimeoutMs() {
    return this.app.blockchainReceiptTimeoutMs;
  }
  get allowedOrigins() {
    return this.app.allowedOrigins;
  }
  get corsEnabled() {
    return this.app.corsEnabled;
  }
}
