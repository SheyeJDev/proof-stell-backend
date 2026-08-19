import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { ArgentXProvider } from './providers/argentx.provider';
import { BraavosProvider } from './providers/braavos.provider';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CacheModule } from '../cache/cache.module';
import { TypedConfigService } from '../common/config/typed-config.service';

@Module({
  imports: [
    ConfigModule,
    EventEmitterModule.forRoot(),
    CacheModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('app.jwtSecret'),
        signOptions: {
          issuer: configService.get<string>('app.jwtIssuer'),
          audience: configService.get<string>('app.jwtAudience'),
          expiresIn: configService.get<string>('app.jwtAccessTtl'),
        },
      }),
    }),
  ],
  providers: [
    WalletService,
    ArgentXProvider,
    BraavosProvider,
    AuthGuard,
    TypedConfigService,
  ],
  controllers: [WalletController],
  exports: [WalletService],
})
export class WalletModule {}
