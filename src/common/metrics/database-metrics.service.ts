import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MetricsService } from './metrics.service';

@Injectable()
export class DatabaseMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseMetricsService.name);
  private intervalRef?: NodeJS.Timeout;

  constructor(
    private readonly metricsService: MetricsService,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  onModuleInit(): void {
    this.collectPoolMetrics();
    this.intervalRef = setInterval(() => {
      this.collectPoolMetrics();
    }, 15000);

    if (this.intervalRef.unref) {
      this.intervalRef.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
    }
  }

  /**
   * Collects current database connection pool stats and updates Prometheus gauges.
   */
  collectPoolMetrics(): { poolSize: number; availableConnections: number } {
    let poolSize = 0;
    let availableConnections = 0;

    try {
      if (this.dataSource && this.dataSource.isInitialized) {
        const driver: any = this.dataSource.driver;
        const pool = driver?.master || driver?.pool;

        if (pool) {
          // pg.Pool properties
          const totalCount =
            typeof pool.totalCount === 'number'
              ? pool.totalCount
              : typeof pool.size === 'number'
              ? pool.size
              : 0;

          const idleCount =
            typeof pool.idleCount === 'number'
              ? pool.idleCount
              : typeof pool.available === 'number'
              ? pool.available
              : totalCount;

          poolSize = totalCount;
          availableConnections = idleCount;
        }
      }
    } catch (err) {
      this.logger.debug(
        `Could not read database connection pool stats: ${(err as Error)?.message}`,
      );
    }

    this.metricsService.updateDatabasePoolMetrics(
      'postgres',
      poolSize,
      availableConnections,
    );

    return { poolSize, availableConnections };
  }

  /**
   * Identifies the SQL command type (e.g. SELECT, INSERT, UPDATE, DELETE).
   */
  extractQueryType(query: string): string {
    if (!query || typeof query !== 'string') {
      return 'other';
    }
    const trimmed = query.trim();
    const firstWord = trimmed.split(/\s+/)[0]?.toUpperCase();
    if (['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'BEGIN', 'COMMIT', 'ROLLBACK'].includes(firstWord)) {
      return firstWord.toLowerCase();
    }
    return 'other';
  }

  /**
   * Records execution duration of a database query.
   */
  recordQuery(
    query: string,
    durationMs: number,
    status: 'success' | 'error' = 'success',
  ): void {
    const queryType = this.extractQueryType(query);
    this.metricsService.recordDatabaseQuery(queryType, durationMs, status);
  }

  /**
   * Records execution duration of a database transaction.
   */
  recordTransaction(
    transactionName: string,
    durationMs: number,
    status: 'success' | 'error' = 'success',
  ): void {
    this.metricsService.recordDatabaseTransaction(
      transactionName,
      durationMs,
      status,
    );
  }
}
