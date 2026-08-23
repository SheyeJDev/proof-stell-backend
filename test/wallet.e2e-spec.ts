import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { WalletService } from '../src/wallet/wallet.service';
import { AuthGuard } from '../src/auth/guards/auth.guard';

const mockWalletService = {
  connect: jest.fn().mockResolvedValue({ isConnected: true }),
  sendTransaction: jest.fn().mockResolvedValue({ hash: '0xtx' }),
};

describe('WalletController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(WalletService)
      .useValue(mockWalletService)
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = { sub: 'user-123', role: 'player' };
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    // Mirrors the global pipe configured in main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects connect payloads with unknown fields (regression: DTO import type erasure)', async () => {
    await request(app.getHttpServer())
      .post('/wallet/connect')
      .send({ providerName: 'argentx', notAField: 'should be rejected' })
      .expect(400);

    expect(mockWalletService.connect).not.toHaveBeenCalled();
  });

  it('accepts a valid connect payload', async () => {
    await request(app.getHttpServer())
      .post('/wallet/connect')
      .send({ providerName: 'argentx' })
      .expect(201);
  });

  it('rejects send-transaction payloads with unknown fields', async () => {
    await request(app.getHttpServer())
      .post('/wallet/send-transaction')
      .send({
        fromAddress: '0xABC',
        to: '0xDEF',
        value: '100',
        chainId: '0x1',
        maliciousExtraField: true,
      })
      .expect(400);

    expect(mockWalletService.sendTransaction).not.toHaveBeenCalled();
  });
});
