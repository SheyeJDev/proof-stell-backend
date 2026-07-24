import { Module } from '@nestjs/common';
import { BlockchainService } from './blockchain.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [AnalyticsModule, CacheModule],
  providers: [BlockchainService],
  exports: [BlockchainService],
  controllers: [],
})
export class BlockchainModule {}
