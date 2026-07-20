import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MintService } from './mint.service';
import { MintController } from './mint.controller';
import { Mint } from './entities/mint.entity';
import { BlockchainModule } from 'src/blockchain/blockchain.module';
import { IdempotencyModule } from 'src/common/idempotency/idempotency.module';
import { SagaModule } from 'src/common/saga/saga.module';

@Module({
  imports: [TypeOrmModule.forFeature([Mint]), BlockchainModule, IdempotencyModule, SagaModule],
  controllers: [MintController],
  providers: [MintService],
  exports: [MintService],
})
export class MintModule {}
