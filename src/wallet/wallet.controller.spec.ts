import { Test, TestingModule } from '@nestjs/testing';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CacheService } from '../cache/cache.service';
import { TypedConfigService } from '../common/config/typed-config.service';
import { AuditLogInterceptor } from '../audit/interceptors/audit-log.interceptor';
import { Reflector } from '@nestjs/core';
import { WalletErrorInterceptor } from './interceptors/wallet-error.interceptor';

const mockWalletService = {
  connect: jest.fn(),
  disconnect: jest.fn(),
  getConnectionStatus: jest.fn(),
  getAccounts: jest.fn(),
  getChainId: jest.fn(),
  signMessage: jest.fn(),
  sendTransaction: jest.fn(),
  switchNetwork: jest.fn(),
};

// JWT payload uses `sub` for the user ID (not `userId`)
const mockUser = { sub: 'user-123', role: 'player' };
const mockReq = { user: mockUser };

describe('WalletController', () => {
  let controller: WalletController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WalletController],
      providers: [
        { provide: WalletService, useValue: mockWalletService },
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
        {
          provide: CacheService,
          useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
        },
        {
          provide: TypedConfigService,
          useValue: {
            jwtSecret: 'test',
            jwtIssuer: 'test',
            jwtAudience: 'test',
          },
        },
        { provide: AuditLogInterceptor, useValue: { intercept: jest.fn() } },
        { provide: Reflector, useValue: { getAllAndOverride: jest.fn() } },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideInterceptor(WalletErrorInterceptor)
      .useValue({ intercept: jest.fn() })
      .overrideInterceptor(AuditLogInterceptor)
      .useValue({ intercept: jest.fn() })
      .compile();

    controller = module.get<WalletController>(WalletController);
    jest.clearAllMocks();
  });

  it('connectWallet passes userId and providerName to service', async () => {
    mockWalletService.connect.mockResolvedValue({ isConnected: true });
    const result = await controller.connectWallet(
      { providerName: 'ArgentX' },
      mockReq as any,
    );
    expect(mockWalletService.connect).toHaveBeenCalledWith(
      'user-123',
      'ArgentX',
    );
    expect(result).toEqual({ isConnected: true });
  });

  it('disconnectWallet passes userId to service', async () => {
    mockWalletService.disconnect.mockResolvedValue(undefined);
    const result = await controller.disconnectWallet(mockReq as any);
    expect(mockWalletService.disconnect).toHaveBeenCalledWith('user-123');
    expect(result.message).toContain('disconnected');
  });

  it('getConnectionStatus passes userId to service', () => {
    mockWalletService.getConnectionStatus.mockReturnValue({
      isConnected: true,
    });
    const result = controller.getConnectionStatus(mockReq as any);
    expect(mockWalletService.getConnectionStatus).toHaveBeenCalledWith(
      'user-123',
    );
    expect(result.isConnected).toBe(true);
  });

  it('signMessage passes userId, message, address to service', async () => {
    mockWalletService.signMessage.mockResolvedValue({ serialized: '0xsig' });
    const result = await controller.signMessage(
      { providerName: 'ArgentX', message: 'hello', address: '0xABC' },
      mockReq as any,
    );
    expect(mockWalletService.signMessage).toHaveBeenCalledWith(
      'user-123',
      'hello',
      '0xABC',
    );
    expect(result.signature.serialized).toBe('0xsig');
  });

  it('sendTransaction passes userId and transaction details to service', async () => {
    mockWalletService.sendTransaction.mockResolvedValue({ hash: '0xtx' });
    const body = {
      providerName: 'ArgentX',
      fromAddress: '0xABC',
      to: '0xDEF',
      value: '100',
      chainId: '0x1',
    };
    const result = await controller.sendTransaction(body, mockReq as any);
    expect(mockWalletService.sendTransaction).toHaveBeenCalledWith(
      'user-123',
      expect.objectContaining({ to: '0xDEF', value: '100' }),
      '0xABC',
    );
    expect(result.transactionHash).toBe('0xtx');
  });

  it('switchNetwork passes userId and chainId to service', async () => {
    mockWalletService.switchNetwork.mockResolvedValue(undefined);
    const result = await controller.switchNetwork(
      { providerName: 'ArgentX', chainId: '0x89' },
      mockReq as any,
    );
    expect(mockWalletService.switchNetwork).toHaveBeenCalledWith(
      'user-123',
      '0x89',
    );
    expect(result.message).toContain('0x89');
  });
});
