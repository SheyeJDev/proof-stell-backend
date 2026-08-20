import { Injectable, Logger } from '@nestjs/common';
import * as client from 'prom-client';
import {
  blockchainTransactionDurationHistogram,
  blockchainTransactionCounter,
  blockchainTransactionErrorsCounter,
  cacheHitCounter,
  cacheMissCounter,
  cacheOperationDurationHistogram,
  databaseQueryDurationHistogram,
  databaseConnectionPoolSizeGauge,
  availableConnectionsGauge,
  databaseAvailableConnectionsGauge,
  databaseTransactionDurationHistogram,
  methodInvocationDurationHistogram,
  methodInvocationsCounter,
  methodErrorsCounter,
} from './metrics.constants';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  // ---------------------------------------------------------------------------
  // Blockchain Metrics Helpers
  // ---------------------------------------------------------------------------

  recordBlockchainTransaction(
    method: string,
    durationMs: number,
    status: 'success' | 'error',
    errorType?: string,
  ): void {
    blockchainTransactionCounter.inc({ method, status });
    blockchainTransactionDurationHistogram.observe({ method, status }, durationMs);

    if (status === 'error' && errorType) {
      blockchainTransactionErrorsCounter.inc({ method, error_type: errorType });
    }
  }

  // ---------------------------------------------------------------------------
  // Cache Metrics Helpers
  // ---------------------------------------------------------------------------

  recordCacheHit(operation: string = 'get', keyPrefix: string = 'default'): void {
    cacheHitCounter.inc({ operation, key_prefix: keyPrefix });
  }

  recordCacheMiss(operation: string = 'get', keyPrefix: string = 'default'): void {
    cacheMissCounter.inc({ operation, key_prefix: keyPrefix });
  }

  recordCacheOperation(
    operation: string,
    durationMs: number,
    status: 'success' | 'error' = 'success',
  ): void {
    cacheOperationDurationHistogram.observe({ operation, status }, durationMs);
  }

  // ---------------------------------------------------------------------------
  // Database Metrics Helpers
  // ---------------------------------------------------------------------------

  recordDatabaseQuery(
    queryType: string,
    durationMs: number,
    status: 'success' | 'error' = 'success',
  ): void {
    databaseQueryDurationHistogram.observe({ query_type: queryType.toLowerCase(), status }, durationMs);
  }

  recordDatabaseTransaction(
    transactionName: string,
    durationMs: number,
    status: 'success' | 'error' = 'success',
  ): void {
    databaseTransactionDurationHistogram.observe(
      { transaction_name: transactionName, status },
      durationMs,
    );
  }

  updateDatabasePoolMetrics(
    database: string = 'postgres',
    poolSize: number,
    available: number,
  ): void {
    databaseConnectionPoolSizeGauge.set({ database }, poolSize);
    availableConnectionsGauge.set({ database }, available);
    databaseAvailableConnectionsGauge.set({ database }, available);
  }

  // ---------------------------------------------------------------------------
  // Method Auto-Instrumentation Metrics Helpers
  // ---------------------------------------------------------------------------

  recordMethodInvocation(
    className: string,
    methodName: string,
    durationMs: number,
    status: 'success' | 'error',
    errorType?: string,
  ): void {
    methodInvocationsCounter.inc({ class_name: className, method_name: methodName, status });
    methodInvocationDurationHistogram.observe(
      { class_name: className, method_name: methodName, status },
      durationMs,
    );

    if (status === 'error' && errorType) {
      methodErrorsCounter.inc({ class_name: className, method_name: methodName, error_type: errorType });
    }
  }

  /**
   * Returns current Prometheus metrics formatted as text.
   */
  async getMetrics(): Promise<string> {
    return client.register.metrics();
  }
}
