import * as client from 'prom-client';

/**
 * Helper to safely retrieve or create Prometheus metrics without throwing
 * 'A metric with the name ... has already been registered' in test or reload environments.
 */
function getOrCreateCounter<T extends string>(
  config: client.CounterConfiguration<T>,
): client.Counter<T> {
  const existing = client.register.getSingleMetric(config.name);
  if (existing) {
    return existing as client.Counter<T>;
  }
  return new client.Counter<T>(config);
}

function getOrCreateHistogram<T extends string>(
  config: client.HistogramConfiguration<T>,
): client.Histogram<T> {
  const existing = client.register.getSingleMetric(config.name);
  if (existing) {
    return existing as client.Histogram<T>;
  }
  return new client.Histogram<T>(config);
}

function getOrCreateGauge<T extends string>(
  config: client.GaugeConfiguration<T>,
): client.Gauge<T> {
  const existing = client.register.getSingleMetric(config.name);
  if (existing) {
    return existing as client.Gauge<T>;
  }
  return new client.Gauge<T>(config);
}

// -----------------------------------------------------------------------------
// Blockchain Transaction Metrics
// -----------------------------------------------------------------------------

export const blockchainTransactionDurationHistogram = getOrCreateHistogram({
  name: 'blockchain_transaction_duration_ms',
  help: 'Latency of blockchain transactions in milliseconds',
  labelNames: ['method', 'status'] as const,
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
});

export const blockchainTransactionCounter = getOrCreateCounter({
  name: 'blockchain_transaction_total',
  help: 'Total number of blockchain transactions executed',
  labelNames: ['method', 'status'] as const,
});

export const blockchainTransactionErrorsCounter = getOrCreateCounter({
  name: 'blockchain_transaction_errors_total',
  help: 'Total number of blockchain transaction errors by method and error type',
  labelNames: ['method', 'error_type'] as const,
});

// -----------------------------------------------------------------------------
// Cache Metrics
// -----------------------------------------------------------------------------

export const cacheHitCounter = getOrCreateCounter({
  name: 'cache_hit_total',
  help: 'Total number of cache hits',
  labelNames: ['operation', 'key_prefix'] as const,
});

export const cacheMissCounter = getOrCreateCounter({
  name: 'cache_miss_total',
  help: 'Total number of cache misses',
  labelNames: ['operation', 'key_prefix'] as const,
});

export const cacheOperationDurationHistogram = getOrCreateHistogram({
  name: 'cache_operation_duration_ms',
  help: 'Duration of cache operations in milliseconds',
  labelNames: ['operation', 'status'] as const,
  buckets: [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000],
});

// -----------------------------------------------------------------------------
// Database Metrics
// -----------------------------------------------------------------------------

export const databaseQueryDurationHistogram = getOrCreateHistogram({
  name: 'database_query_duration_ms',
  help: 'Duration of database queries in milliseconds by query type',
  labelNames: ['query_type', 'status'] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
});

export const databaseConnectionPoolSizeGauge = getOrCreateGauge({
  name: 'database_connection_pool_size',
  help: 'Total number of database connections in the connection pool',
  labelNames: ['database'] as const,
});

export const availableConnectionsGauge = getOrCreateGauge({
  name: 'available_connections',
  help: 'Number of available (idle) database connections in the pool',
  labelNames: ['database'] as const,
});

export const databaseAvailableConnectionsGauge = getOrCreateGauge({
  name: 'database_available_connections',
  help: 'Alias for available database connections in the pool',
  labelNames: ['database'] as const,
});

export const databaseTransactionDurationHistogram = getOrCreateHistogram({
  name: 'database_transaction_duration_ms',
  help: 'Duration of database transactions in milliseconds',
  labelNames: ['transaction_name', 'status'] as const,
  buckets: [5, 20, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
});

// -----------------------------------------------------------------------------
// Method Auto-Instrumentation Metrics
// -----------------------------------------------------------------------------

export const methodInvocationDurationHistogram = getOrCreateHistogram({
  name: 'method_invocation_duration_ms',
  help: 'Duration of instrumented method calls in milliseconds',
  labelNames: ['class_name', 'method_name', 'status'] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
});

export const methodInvocationsCounter = getOrCreateCounter({
  name: 'method_invocations_total',
  help: 'Total number of method invocations',
  labelNames: ['class_name', 'method_name', 'status'] as const,
});

export const methodErrorsCounter = getOrCreateCounter({
  name: 'method_errors_total',
  help: 'Total number of errors from instrumented methods',
  labelNames: ['class_name', 'method_name', 'error_type'] as const,
});
