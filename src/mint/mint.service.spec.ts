import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MintService } from './mint.service';
import { Mint } from './entities/mint.entity';
import { CacheService } from '../cache/cache.service';
import { DataSource } from 'typeorm';
import { BlockchainService } from '../blockchain/blockchain.service';
import { IdempotencyService } from '../common/services/idempotency.service';

const mockMintRepository = {
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  delete: jest.fn(),
};

const mockDataSource = {
  createQueryRunner: jest.fn().mockReturnValue({
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    },
  }),
};

const mockBlockchainService = {
  sendMintTx: jest.fn(),
  waitForTransactionReceipt: jest.fn(),
};

const mockIdempotencyService = {
  generateKey: jest.fn().mockReturnValue('idemp-key'),
  check: jest.fn().mockResolvedValue(null),
  store: jest.fn().mockResolvedValue(undefined),
};

const mockCacheService = {
  withLock: jest.fn().mockImplementation((_key, _ttl, callback) => callback()),
};

describe('MintService', () => {
  let service: MintService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MintService,
        { provide: getRepositoryToken(Mint), useValue: mockMintRepository },
        { provide: DataSource, useValue: mockDataSource },
        { provide: BlockchainService, useValue: mockBlockchainService },
        { provide: IdempotencyService, useValue: mockIdempotencyService },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    service = module.get<MintService>(MintService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
