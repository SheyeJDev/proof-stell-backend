import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameSessionController } from './game-session.controller';
import { GameSessionService } from './game-session.service';
import { GameSession } from './entities/game-session.entity';
import { InputEvent } from './entities/input-event.entity';
import { SessionIntegrityGuard } from '../common/guards/session-integrity.guard';
import { User } from '../users/entities/user.entity';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { BadgeModule } from '../badge/badge.module';
import { IdempotencyModule } from '../common/idempotency/idempotency.module';
import { SagaModule } from '../common/saga/saga.module';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GameSession, InputEvent, User]),
    LeaderboardModule,
    BadgeModule,
    IdempotencyModule,
    SagaModule,
    CacheModule,
  ],
  controllers: [GameSessionController],
  providers: [GameSessionService, SessionIntegrityGuard],
  exports: [GameSessionService],
})
export class GameSessionModule {}
