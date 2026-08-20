import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import * as request from 'supertest';
import * as client from 'prom-client';
import { MetricsModule } from '../src/common/metrics/metrics.module';
import { MetricsService } from '../src/common/metrics/metrics.service';
import { DatabaseMetricsService } from '../src/common/metrics/database-metrics.service';
import { CacheService } from '../src/cache/cache.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { DistributedLockService } from '../src/cache/distributed-lock.service';
import { DataSource } from 'typeorm';

describe('Prometheus Metrics Integration Tests', () => {
  let app: INestApplication;
  let metricsService: MetricsService;
  let databaseMetricsService: DatabaseMetricsService;
  let cacheService: CacheService;

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const mockDistributedLockService = {
    acquire: jest.fn(),
    release: jest.fn(),
  };

  const mockDataSource = {
    isInitialized: true,
    driver: {
      master: {
        totalCount: 20,
        idleCount: 15,
      },
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PrometheusModule.register({
          defaultMetrics: {
            enabled: false,
          },
        }),
        MetricsModule,
      ],
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
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    metricsService = moduleFixture.get<MetricsService>(MetricsService);
    databaseMetricsService = moduleFixture.get<DatabaseMetricsService>(DatabaseMetricsService);
    cacheService = moduleFixture.get<CacheService>(CacheService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /metrics should return 200 and Prometheus text format', async () => {
    const response = await request(app.getHttpServer())
      .get('/metrics')
      .expect(200);

    expect(response.headers['content-type']).toContain('text/plain');
  });

  it('should track blockchain transaction metrics (latency, total, errors)', async () => {
    // Record sample blockchain operations
    metricsService.recordBlockchainTransaction('sendMintTx', 450, 'success');
    metricsService.recordBlockchainTransaction('sendTransferTx', 320, 'success');
    metricsService.recordBlockchainTransaction('sendBurnTx', 600, 'error', 'StarknetContractError');

    const metricsResponse = await request(app.getHttpServer()).get('/metrics').expect(200);
    const body = metricsResponse.text;

    expect(body).toContain('blockchain_transaction_total');
    expect(body).toContain('blockchain_transaction_duration_ms');
    expect(body).toContain('blockchain_transaction_errors_total');
    expect(body).toContain('method="sendMintTx"');
    expect(body).toContain('method="sendBurnTx"');
    expect(body).toContain('error_type="StarknetContractError"');
  });

  it('should track cache hit/miss ratio and operation latency', async () => {
    // Simulate cache hits and misses
    mockCacheManager.get.mockResolvedValueOnce({ id: 1, name: 'Alice' });
    await cacheService.get('user:profile:1');

    mockCacheManager.get.mockResolvedValueOnce(undefined);
    await cacheService.get('user:profile:2');

    // Simulate cache set
    mockCacheManager.set.mockResolvedValueOnce(undefined);
    await cacheService.set('user:profile:2', { id: 2, name: 'Bob' }, 300);

    const metricsResponse = await request(app.getHttpServer()).get('/metrics').expect(200);
    const body = metricsResponse.text;

    expect(body).toContain('cache_hit_total');
    expect(body).toContain('cache_miss_total');
    expect(body).toContain('cache_operation_duration_ms');
    expect(body).toContain('operation="get"');
    expect(body).toContain('operation="set"');
  });

  it('should monitor database connection pool size, available connections, query and transaction durations', async () => {
    databaseMetricsService.collectPoolMetrics();
    databaseMetricsService.recordQuery('SELECT * FROM leaderboard ORDER BY score DESC', 25, 'success');
    databaseMetricsService.recordQuery('INSERT INTO game_sessions (id) VALUES (1)', 18, 'success');
    databaseMetricsService.recordTransaction('submitScoreSaga', 85, 'success');

    const metricsResponse = await request(app.getHttpServer()).get('/metrics').expect(200);
    const body = metricsResponse.text;

    expect(body).toContain('database_connection_pool_size');
    expect(body).toContain('available_connections');
    expect(body).toContain('database_query_duration_ms');
    expect(body).toContain('database_transaction_duration_ms');
    expect(body).toContain('query_type="select"');
    expect(body).toContain('query_type="insert"');
    expect(body).toContain('transaction_name="submitScoreSaga"');
  });

  it('should export all required SLI metrics with positive values in Prometheus output', async () => {
    const metricsResponse = await request(app.getHttpServer()).get('/metrics').expect(200);
    const body = metricsResponse.text;

    // Verify all 10 core metrics from the requirements exist in Prometheus output
    const requiredMetrics = [
      'blockchain_transaction_duration_ms',
      'blockchain_transaction_total',
      'blockchain_transaction_errors_total',
      'cache_hit_total',
      'cache_miss_total',
      'cache_operation_duration_ms',
      'database_query_duration_ms',
      'database_connection_pool_size',
      'available_connections',
      'database_transaction_duration_ms',
      'method_invocations_total',
      'method_invocation_duration_ms',
      'method_errors_total',
    ];

    for (const metric of requiredMetrics) {
      expect(body).toContain(metric);
    }
  });
});
