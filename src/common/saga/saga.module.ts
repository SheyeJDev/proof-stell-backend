import { Module } from '@nestjs/common';
import { SagaBuilder } from './saga.builder';

@Module({
  providers: [SagaBuilder],
  exports: [SagaBuilder],
})
export class SagaModule {}
