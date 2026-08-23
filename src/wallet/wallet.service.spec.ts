import { Test, TestingModule } from '@nestjs/testing';
import { WalletService } from './wallet.service';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ArgentXProvider } from './providers/argentx.provider';
import { BraavosProvider } from './providers/braavos.provider';
import { CacheService } from '../cache/cache.service';
import {
  WalletNotConnectedException,
  WalletProviderNotFoundException,
} from './exceptions/wallet.exception';

const mockProvider = {
  name: 'MockProvider',
  isAvailable: jest.fn().mockReturnValue(true),
  connect: jest.fn().mockResolvedValue({
    isConnected: true,
    address: '0xABC',
    chainId: '0x1',
    providerName: 'MockProvider',
  }),
  disconnect: jest.fn().mockResolvedValue(undefined),
  getAccounts: jest.fn().mockResolvedValue(['0xABC']),
  getChainId: jest.fn().mockResolvedValue('0x1'),
  signMessage: jest
    .fn()
    .mockResolvedValue({ r: '0xr', s: '0xs', v: '27', serialized: '0xsig' }),
  sendTransaction: jest.fn().mockResolvedValue({ hash: '0xtxhash' }),
  switchNetwork: jest.fn().mockResolvedValue(undefined),
};

describe('WalletService', () => {
  let service: WalletService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn(), on: jest.fn() },
        },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn().mockResolvedValue(undefined),
            set: jest.fn().mockResolvedValue(undefined),
            acquireLock: jest.fn().mockResolvedValue({
              key: 'wallet:transaction:user1:abc',
              token: 'token',
            }),
            releaseLock: jest.fn().mockResolvedValue(true),
            setIfNotExists: jest.fn().mockResolvedValue(true),
            waitForValue: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: ArgentXProvider, useValue: mockProvider },
        {
          provide: BraavosProvider,
          useValue: {
            ...mockProvider,
            name: 'Braavos',
            isAvailable: jest.fn().mockReturnValue(false),
          },
        },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
    jest.clearAllMocks();
    mockProvider.isAvailable.mockReturnValue(true);
    mockProvider.connect.mockResolvedValue({
      isConnected: true,
      address: '0xABC',
      chainId: '0x1',
      providerName: 'MockProvider',
    });
    mockProvider.getChainId.mockResolvedValue('0x1');
    mockProvider.sendTransaction.mockResolvedValue({ hash: '0xtxhash' });
  });

  describe('per-user state isolation', () => {
    it('returns disconnected status for a new user', () => {
      const status = service.getConnectionStatus('user1');
      expect(status.isConnected).toBe(false);
    });

    it('isolates connection state between concurrent users', async () => {
      await service.connect('user1', 'MockProvider');
      const user1Status = service.getConnectionStatus('user1');
      const user2Status = service.getConnectionStatus('user2');

      expect(user1Status.isConnected).toBe(true);
      expect(user2Status.isConnected).toBe(false);
    });

    it('disconnect for one user does not affect another', async () => {
      await service.connect('user1', 'MockProvider');
      await service.connect('user2', 'MockProvider');
      await service.disconnect('user1');

      expect(service.getConnectionStatus('user1').isConnected).toBe(false);
      expect(service.getConnectionStatus('user2').isConnected).toBe(true);
    });
  });

  describe('connect', () => {
    it('throws WalletProviderNotFoundException for unknown provider', async () => {
      await expect(service.connect('user1', 'Unknown')).rejects.toThrow(
        WalletProviderNotFoundException,
      );
    });

    it('connects and returns status', async () => {
      const status = await service.connect('user1', 'MockProvider');
      expect(status.isConnected).toBe(true);
      expect(status.address).toBe('0xABC');
    });
  });

  describe('disconnect', () => {
    it('does nothing if no active wallet', async () => {
      await expect(service.disconnect('user1')).resolves.not.toThrow();
    });
  });

  describe('getAccounts', () => {
    it('throws WalletNotConnectedException when not connected', async () => {
      await expect(service.getAccounts('user1')).rejects.toThrow(
        WalletNotConnectedException,
      );
    });

    it('returns accounts when connected', async () => {
      await service.connect('user1', 'MockProvider');
      const accounts = await service.getAccounts('user1');
      expect(accounts).toEqual(['0xABC']);
    });
  });

  describe('sendTransaction', () => {
    it('throws WalletNotConnectedException when not connected', async () => {
      await expect(
        service.sendTransaction(
          'user1',
          { to: '0xDEF', value: '100' },
          '0xABC',
          0,
        ),
      ).rejects.toThrow(WalletNotConnectedException);
    });

    it('sends transaction and returns hash', async () => {
      await service.connect('user1', 'MockProvider');
      const result = await service.sendTransaction(
        'user1',
        { to: '0xDEF', value: '100', chainId: '0x1', requestId: 'req-123' },
        '0xABC',
        0,
      );
      expect(result.hash).toBe('0xtxhash');
    });

    it('returns cached transaction when the same requestId is reused', async () => {
      const mockCache = (service as any).cacheService as unknown as {
        get: jest.Mock;
      };
      mockCache.get.mockResolvedValueOnce({ hash: '0xcached' });

      await service.connect('user1', 'MockProvider');
      const result = await service.sendTransaction(
        'user1',
        { to: '0xDEF', value: '100', chainId: '0x1', requestId: 'req-123' },
        '0xABC',
        0,
      );

      expect(result.hash).toBe('0xcached');
      expect(mockProvider.sendTransaction).not.toHaveBeenCalled();
    });
  });

  describe('signMessage', () => {
    it('throws WalletNotConnectedException when not connected', async () => {
      await expect(
        service.signMessage('user1', 'hello', '0xABC'),
      ).rejects.toThrow(WalletNotConnectedException);
    });

    it('returns signature when connected', async () => {
      await service.connect('user1', 'MockProvider');
      const sig = await service.signMessage('user1', 'hello', '0xABC');
      expect(sig.serialized).toBe('0xsig');
    });
  });
});
