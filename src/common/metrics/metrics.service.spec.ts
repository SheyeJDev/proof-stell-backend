import { Test, TestingModule } from '@nestjs/testing';
import { MetricsService } from './metrics.service';
import { DatabaseMetricsService } from './database-metrics.service';
import { DataSource } from 'typeorm';

describe('MetricsService & DatabaseMetricsService', () => {
  let metricsService: MetricsService;
  let databaseMetricsService: DatabaseMetricsService;

  const mockDataSource = {
    isInitialized: true,
    driver: {
      master: {
        totalCount: 10,
        idleCount: 8,
      },
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        DatabaseMetricsService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    metricsService = module.get<MetricsService>(MetricsService);
    databaseMetricsService = module.get<DatabaseMetricsService>(DatabaseMetricsService);
  });

  it('should be defined', () => {
    expect(metricsService).toBeDefined();
    expect(databaseMetricsService).toBeDefined();
  });

  it('should record blockchain metrics', async () => {
    metricsService.recordBlockchainTransaction('sendMintTx', 150, 'success');
    metricsService.recordBlockchainTransaction('sendTransferTx', 300, 'error', 'StarknetRpcError');

    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('blockchain_transaction_total');
    expect(metrics).toContain('sendMintTx');
    expect(metrics).toContain('blockchain_transaction_errors_total');
  });

  it('should record cache hits, misses, and operation latency', async () => {
    metricsService.recordCacheHit('get', 'user');
    metricsService.recordCacheMiss('get', 'leaderboard');
    metricsService.recordCacheOperation('set', 2.5, 'success');

    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('cache_hit_total');
    expect(metrics).toContain('cache_miss_total');
    expect(metrics).toContain('cache_operation_duration_ms');
  });

  it('should collect connection pool metrics from DataSource', async () => {
    const poolStats = databaseMetricsService.collectPoolMetrics();
    expect(poolStats.poolSize).toBe(10);
    expect(poolStats.availableConnections).toBe(8);

    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('database_connection_pool_size');
    expect(metrics).toContain('available_connections');
  });

  it('should extract query types and record database queries', async () => {
    expect(databaseMetricsService.extractQueryType('SELECT * FROM users')).toBe('select');
    expect(databaseMetricsService.extractQueryType('INSERT INTO game_sessions ...')).toBe('insert');
    expect(databaseMetricsService.extractQueryType('UPDATE leaderboard ...')).toBe('update');
    expect(databaseMetricsService.extractQueryType('DELETE FROM tokens ...')).toBe('delete');

    databaseMetricsService.recordQuery('SELECT * FROM users', 12, 'success');
    databaseMetricsService.recordTransaction('reportSessionSaga', 45, 'success');

    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('database_query_duration_ms');
    expect(metrics).toContain('database_transaction_duration_ms');
  });
});
