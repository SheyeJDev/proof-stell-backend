import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Between } from 'typeorm';
import { AuditLogService, type LogActionParams } from '../audit-log.service';
import { AuditLog } from '../../entities/audit-log.entity';
import { jest } from '@jest/globals';

type MockAuditLogRepo = {
  create: jest.Mock;
  save: jest.Mock;
  findOne: jest.Mock;
  find: jest.Mock;
  findAndCount: jest.Mock;
  count: jest.Mock;
  createQueryBuilder: jest.Mock;
};

describe('AuditLogService', () => {
  let service: AuditLogService;
  let repository: MockAuditLogRepo;

  const mockAuditLog = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    userId: 'user-123',
    actionType: 'USER_LOGIN',
    metadata: { ip: '127.0.0.1' },
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0',
    resource: 'auth',
    result: 'SUCCESS',
    errorMessage: null,
  } as unknown as AuditLog;

  beforeEach(async () => {
    const mockRepository: MockAuditLogRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        {
          provide: getRepositoryToken(AuditLog),
          useValue: mockRepository as any,
        },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
    repository = module.get(getRepositoryToken(AuditLog));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('logAction', () => {
    it('should create and save an audit log', async () => {
      const params: LogActionParams = {
        actionType: 'USER_LOGIN',
        userId: 'user-123',
        metadata: { ip: '127.0.0.1' },
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
        resource: 'auth',
        result: 'SUCCESS',
      };

      repository.create.mockReturnValue(mockAuditLog);
      repository.save.mockResolvedValue(mockAuditLog);

      const result = await service.logAction(params);

      expect(repository.create).toHaveBeenCalledWith({
        userId: params.userId,
        actionType: params.actionType,
        metadata: params.metadata,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        resource: params.resource,
        result: params.result,
        errorMessage: undefined,
      });
      expect(repository.save).toHaveBeenCalledWith(mockAuditLog);
      expect(result).toEqual(mockAuditLog);
    });

    it('should use default values when optional params are not provided', async () => {
      const params: LogActionParams = {
        actionType: 'USER_LOGIN',
        userId: 'user-123',
      };

      repository.create.mockReturnValue(mockAuditLog);
      repository.save.mockResolvedValue(mockAuditLog);

      await service.logAction(params);

      expect(repository.create).toHaveBeenCalledWith({
        userId: params.userId,
        actionType: params.actionType,
        metadata: {},
        ipAddress: undefined,
        userAgent: undefined,
        resource: undefined,
        result: 'SUCCESS',
        errorMessage: undefined,
      });
    });

    it('should throw error when save fails', async () => {
      const params: LogActionParams = {
        actionType: 'USER_LOGIN',
        userId: 'user-123',
      };

      const error = new Error('Database error');
      repository.create.mockReturnValue(mockAuditLog);
      repository.save.mockRejectedValue(error);

      await expect(service.logAction(params)).rejects.toThrow('Database error');
    });
  });

  describe('findLogs', () => {
    it('should return paginated logs with default filters', async () => {
      const logs = [mockAuditLog];
      const total = 1;

      repository.findAndCount.mockResolvedValue([logs, total]);

      const result = await service.findLogs();

      expect(repository.findAndCount).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: 'DESC' },
        skip: 0,
        take: 50,
      });
      expect(result).toEqual({
        logs,
        total,
        page: 1,
        totalPages: 1,
      });
    });

    it('should apply date range filters correctly', async () => {
      const filters = {
        userId: 'user-123',
        actionType: 'USER_LOGIN',
        result: 'SUCCESS',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-02'),
        page: 2,
        limit: 25,
      };

      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findLogs(filters);

      expect(repository.findAndCount).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          actionType: 'USER_LOGIN',
          result: 'SUCCESS',
          createdAt: Between(filters.startDate, filters.endDate),
        },
        order: { createdAt: 'DESC' },
        skip: 25,
        take: 25,
      });
    });
  });

  describe('getLogById', () => {
    it('returns the matching log', async () => {
      repository.findOne.mockResolvedValue(mockAuditLog);

      const result = await service.getLogById('123');

      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: '123' } });
      expect(result).toEqual(mockAuditLog);
    });

    it('returns null when the log is not found', async () => {
      repository.findOne.mockResolvedValue(null);

      const result = await service.getLogById('nonexistent');

      expect(result).toBeNull();
    });
  });
});
