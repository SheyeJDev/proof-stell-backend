import { Test, TestingModule } from '@nestjs/testing';
import { BlockchainService } from './blockchain.service';
import { TypedConfigService } from '../common/config/typed-config.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AnalyticsEvent } from '../analytics/analytics-event.enum';
import { CacheService } from '../cache/cache.service';

const mockAccount = {
  execute: jest.fn(),
};
const mockProvider = {};
const mockConfigService = {
  mintContractAddress: '0x123',
  starknetPrivateKey: '0xabc',
  starknetAccountAddress: '0xdef',
};
const mockAnalyticsService = {
  track: jest.fn(),
};
const mockCacheService = {
  get: jest.fn(),
  set: jest.fn(),
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
};

jest.mock('starknet', () => ({
  Provider: jest.fn(() => mockProvider),
  Account: jest.fn(() => mockAccount),
  Contract: jest.fn(() => ({
    call: jest.fn().mockResolvedValue({ toString: () => '1000' }),
  })),
}));

describe('BlockchainService', () => {
  let service: BlockchainService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockchainService,
        { provide: TypedConfigService, useValue: mockConfigService },
        { provide: AnalyticsService, useValue: mockAnalyticsService },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    service = module.get<BlockchainService>(BlockchainService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should mint tokens and track analytics', async () => {
    mockAccount.execute.mockResolvedValue({ transaction_hash: '0xhash' });
    mockCacheService.get.mockResolvedValue(undefined);
    mockCacheService.acquireLock.mockResolvedValue({ key: 'blockchain:tx:mint:1', token: 'token' });
    mockCacheService.releaseLock.mockResolvedValue(true);

    const result = await service.sendMintTx(1);

    expect(mockAccount.execute).toHaveBeenCalledWith({
      contractAddress: '0x123',
      entrypoint: 'mint',
      calldata: ['1'],
    });
    expect(mockAnalyticsService.track).toHaveBeenCalledWith(
      AnalyticsEvent.TokenMinted,
      { userId: '1', metadata: { transaction_hash: '0xhash' } },
    );
    expect(result).toEqual({ transaction_hash: '0xhash' });
  });

  it('should return cached mint transaction hash when present', async () => {
    mockCacheService.get.mockResolvedValue({ transaction_hash: '0xcached' });
    const result = await service.sendMintTx(1);
    expect(result).toEqual({ transaction_hash: '0xcached' });
    expect(mockAccount.execute).not.toHaveBeenCalled();
  });

  it('should transfer tokens and track analytics', async () => {
    mockAccount.execute.mockResolvedValue({ transaction_hash: '0xtransfer' });
    mockCacheService.get.mockResolvedValue(undefined);
    mockCacheService.acquireLock.mockResolvedValue({ key: 'blockchain:tx:transfer:1:2', token: 'token' });
    mockCacheService.releaseLock.mockResolvedValue(true);

    const result = await service.sendTransferTx(1, 2, 50);

    expect(mockAccount.execute).toHaveBeenCalledWith({
      contractAddress: '0x123',
      entrypoint: 'transfer',
      calldata: ['1', '2', '50'],
    });
    expect(mockAnalyticsService.track).toHaveBeenCalledWith(
      AnalyticsEvent.TokenTransferred,
      {
        userId: '1',
        metadata: { toUserId: 2, amount: 50, transaction_hash: '0xtransfer' },
      },
    );
    expect(result).toEqual({ transaction_hash: '0xtransfer' });
  });

  it('should return cached transfer transaction hash when present', async () => {
    mockCacheService.get.mockResolvedValue({ transaction_hash: '0xcached-transfer' });
    const result = await service.sendTransferTx(1, 2, 50);
    expect(result).toEqual({ transaction_hash: '0xcached-transfer' });
    expect(mockAccount.execute).not.toHaveBeenCalled();
  });

  it('should burn tokens and track analytics', async () => {
    mockAccount.execute.mockResolvedValue({ transaction_hash: '0xburn' });
    mockCacheService.get.mockResolvedValue(undefined);
    mockCacheService.acquireLock.mockResolvedValue({ key: 'blockchain:tx:burn:1', token: 'token' });
    mockCacheService.releaseLock.mockResolvedValue(true);

    const result = await service.sendBurnTx(1, 25);

    expect(mockAccount.execute).toHaveBeenCalledWith({
      contractAddress: '0x123',
      entrypoint: 'burn',
      calldata: ['1', '25'],
    });
    expect(mockAnalyticsService.track).toHaveBeenCalledWith(
      AnalyticsEvent.TokenBurned,
      { userId: '1', metadata: { amount: 25, transaction_hash: '0xburn' } },
    );
    expect(result).toEqual({ transaction_hash: '0xburn' });
  });

  it('should return cached burn transaction hash when present', async () => {
    mockCacheService.get.mockResolvedValue({ transaction_hash: '0xcached-burn' });
    const result = await service.sendBurnTx(1, 25);
    expect(result).toEqual({ transaction_hash: '0xcached-burn' });
    expect(mockAccount.execute).not.toHaveBeenCalled();
  });

  it('should get balance', async () => {
    const result = await service.getBalance(1);
    expect(result).toEqual({ balance: '1000' });
  });
});
