import { TrackMetrics, extractErrorType } from './metrics.decorator';
import {
  methodInvocationsCounter,
  methodInvocationDurationHistogram,
  methodErrorsCounter,
  blockchainTransactionCounter,
  blockchainTransactionDurationHistogram,
  blockchainTransactionErrorsCounter,
  cacheOperationDurationHistogram,
  databaseTransactionDurationHistogram,
} from './metrics.constants';
import * as client from 'prom-client';

describe('TrackMetrics Decorator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  class TestService {
    @TrackMetrics({ operation: 'testSyncSuccess' })
    syncSuccessMethod(): string {
      return 'sync-success';
    }

    @TrackMetrics({ operation: 'testSyncError' })
    syncErrorMethod(): void {
      throw new Error('Sync failure');
    }

    @TrackMetrics({ operation: 'testAsyncSuccess' })
    async asyncSuccessMethod(): Promise<string> {
      return 'async-success';
    }

    @TrackMetrics({ operation: 'testAsyncError' })
    async asyncErrorMethod(): Promise<void> {
      throw new TypeError('Async failure');
    }

    @TrackMetrics({ category: 'blockchain', trackBlockchain: true, operation: 'blockchainOp' })
    async blockchainMethod(): Promise<string> {
      return 'blockchain-success';
    }

    @TrackMetrics({ category: 'blockchain', trackBlockchain: true, operation: 'blockchainFail' })
    async blockchainFailMethod(): Promise<void> {
      throw new Error('Starknet RPC failure');
    }

    @TrackMetrics({ category: 'cache', trackCache: true, operation: 'cacheOp' })
    async cacheMethod(): Promise<string> {
      return 'cache-success';
    }

    @TrackMetrics({ category: 'database', trackDatabase: true, operation: 'dbTx' })
    async databaseMethod(): Promise<string> {
      return 'db-success';
    }
  }

  it('should instrument synchronous successful method', () => {
    const service = new TestService();
    const result = service.syncSuccessMethod();

    expect(result).toBe('sync-success');
  });

  it('should instrument synchronous throwing method and rethrow error', () => {
    const service = new TestService();

    expect(() => service.syncErrorMethod()).toThrow('Sync failure');
  });

  it('should instrument asynchronous successful method', async () => {
    const service = new TestService();
    const result = await service.asyncSuccessMethod();

    expect(result).toBe('async-success');
  });

  it('should instrument asynchronous rejecting method and rethrow rejection', async () => {
    const service = new TestService();

    await expect(service.asyncErrorMethod()).rejects.toThrow(TypeError);
  });

  it('should emit blockchain transaction metrics when decorated with trackBlockchain', async () => {
    const service = new TestService();
    const result = await service.blockchainMethod();

    expect(result).toBe('blockchain-success');
  });

  it('should emit blockchain error metrics when blockchain method fails', async () => {
    const service = new TestService();

    await expect(service.blockchainFailMethod()).rejects.toThrow('Starknet RPC failure');
  });

  it('should emit cache and database metrics for categorized methods', async () => {
    const service = new TestService();

    const cacheRes = await service.cacheMethod();
    expect(cacheRes).toBe('cache-success');

    const dbRes = await service.databaseMethod();
    expect(dbRes).toBe('db-success');
  });

  it('should correctly classify error types', () => {
    expect(extractErrorType(new Error('test'))).toBe('Error');
    expect(extractErrorType(new TypeError('test'))).toBe('TypeError');
    expect(extractErrorType({ code: 'ERR_TIMEOUT' })).toBe('ERR_TIMEOUT');
    expect(extractErrorType('String error message')).toBe('String error message');
    expect(extractErrorType(null)).toBe('UnknownError');
  });

  it('should include metrics in prom-client registry output', async () => {
    const metricsText = await client.register.metrics();
    expect(metricsText).toContain('method_invocations_total');
    expect(metricsText).toContain('method_invocation_duration_ms');
    expect(metricsText).toContain('blockchain_transaction_total');
    expect(metricsText).toContain('blockchain_transaction_duration_ms');
    expect(metricsText).toContain('cache_hit_total');
    expect(metricsText).toContain('cache_miss_total');
    expect(metricsText).toContain('database_query_duration_ms');
    expect(metricsText).toContain('database_connection_pool_size');
    expect(metricsText).toContain('available_connections');
  });
});
