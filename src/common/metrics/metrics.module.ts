import { Module, Global } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { DatabaseMetricsService } from './database-metrics.service';

@Global()
@Module({
  providers: [MetricsService, DatabaseMetricsService],
  exports: [MetricsService, DatabaseMetricsService],
})
export class MetricsModule {}
