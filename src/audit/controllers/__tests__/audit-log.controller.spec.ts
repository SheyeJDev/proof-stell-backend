import { Test, type TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AuditLogController } from '../audit-log.controller';
import { AuditLogService } from '../../services/audit-log.service';
import type { GetAuditLogsDto } from '../../dto/audit-log.dto';
import { jest } from '@jest/globals';

describe('AuditLogController', () => {
  let controller: AuditLogController;
  let service: {
    findLogs: jest.Mock<any>;
    getLogStats: jest.Mock<any>;
    getLogById: jest.Mock<any>;
    getLogsByUser: jest.Mock<any>;
    getLogsByActionType: jest.Mock<any>;
    archiveOldLogs: jest.Mock<any>;
    exportLogs: jest.Mock<any>;
  };

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
  };

  beforeEach(async () => {
    const mockService = {
      logAction: jest.fn(),
      findLogs: jest.fn(),
      getLogById: jest.fn(),
      getLogsByUser: jest.fn(),
      getLogsByActionType: jest.fn(),
      getLogStats: jest.fn(),
      archiveOldLogs: jest.fn(),
      exportLogs: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditLogController],
      providers: [
        {
          provide: AuditLogService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<AuditLogController>(AuditLogController);
    // Pull the mock straight back through NestJS — it's the same object
    // instance since `useValue` is a singleton-per-test.
    const mockAuditLogService = (module.get(AuditLogService) as any) as typeof service;
    service = mockAuditLogService;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAuditLogs', () => {
    it('returns paginated audit logs', async () => {
      const query: GetAuditLogsDto = {
        page: 1,
        limit: 50,
        userId: 'user-123',
        actionType: 'USER_LOGIN',
      };

      const expectedResponse = {
        logs: [mockAuditLog],
        total: 1,
        page: 1,
        totalPages: 1,
      };

      (service.findLogs as jest.Mock<any>).mockResolvedValue(expectedResponse);

      const result = await controller.getAuditLogs(query);

      expect(service.findLogs).toHaveBeenCalledWith({
        page: 1,
        limit: 50,
        userId: 'user-123',
        actionType: 'USER_LOGIN',
        startDate: undefined,
        endDate: undefined,
      });
      expect(result).toEqual(expectedResponse);
    });

    it('handles date filters', async () => {
      const query: GetAuditLogsDto = {
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-01-02T00:00:00Z',
      };

      (service.findLogs as jest.Mock<any>).mockResolvedValue({
        logs: [],
        total: 0,
        page: 1,
        totalPages: 0,
      });

      await controller.getAuditLogs(query);

      expect(service.findLogs).toHaveBeenCalledWith({
        page: 1,
        limit: 50,
        startDate: new Date('2024-01-01T00:00:00Z'),
        endDate: new Date('2024-01-02T00:00:00Z'),
      });
    });
  });

  describe('getAuditLogStats', () => {
    it('returns audit log statistics', async () => {
      const expectedStats = {
        totalLogs: 100,
        logsByAction: {
          USER_LOGIN: 50,
          USER_LOGOUT: 30,
          USER_CREATED: 20,
        },
        recentActivity: 10,
      };

      (service.getLogStats as jest.Mock<any>).mockResolvedValue(expectedStats);

      const result = await controller.getAuditLogStats();

      expect(service.getLogStats).toHaveBeenCalled();
      expect(result).toEqual(expectedStats);
    });
  });

  describe('getAuditLogById', () => {
    it('returns a specific audit log', async () => {
      (service.getLogById as jest.Mock<any>).mockResolvedValue(mockAuditLog);

      const result = await controller.getAuditLogById('123');

      expect(service.getLogById).toHaveBeenCalledWith('123');
      expect(result).toEqual(mockAuditLog);
    });

    it('throws NotFoundException when the log is not found', async () => {
      (service.getLogById as jest.Mock<any>).mockResolvedValue(null);

      await expect(
        controller.getAuditLogById('nonexistent'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        controller.getAuditLogById('nonexistent'),
      ).rejects.toThrow('Audit log with id "nonexistent" not found');
    });
  });

  describe('getUserAuditLogs', () => {
    it('returns logs for a specific user', async () => {
      (service.getLogsByUser as jest.Mock<any>).mockResolvedValue([mockAuditLog]);

      const result = await controller.getUserAuditLogs('user-123');

      expect(service.getLogsByUser).toHaveBeenCalledWith('user-123', 100);
      expect(result).toEqual([mockAuditLog]);
    });

    it('respects limit parameter', async () => {
      (service.getLogsByUser as jest.Mock<any>).mockResolvedValue([]);

      await controller.getUserAuditLogs('user-123', 50);

      expect(service.getLogsByUser).toHaveBeenCalledWith('user-123', 50);
    });
  });

  describe('getActionAuditLogs', () => {
    it('returns logs for a specific action type', async () => {
      (service.getLogsByActionType as jest.Mock<any>).mockResolvedValue([mockAuditLog]);

      const result = await controller.getActionAuditLogs('USER_LOGIN');

      expect(service.getLogsByActionType).toHaveBeenCalledWith(
        'USER_LOGIN',
        100,
      );
      expect(result).toEqual([mockAuditLog]);
    });

    it('respects limit parameter', async () => {
      (service.getLogsByActionType as jest.Mock<any>).mockResolvedValue([]);

      await controller.getActionAuditLogs('USER_LOGIN', 50);

      expect(service.getLogsByActionType).toHaveBeenCalledWith(
        'USER_LOGIN',
        50,
      );
    });
  });

  describe('archiveAuditLogs', () => {
    it('archives logs with a valid retention period', async () => {
      (service.archiveOldLogs as jest.Mock<any>).mockResolvedValue(42);

      const result = await controller.archiveAuditLogs('90');

      expect(service.archiveOldLogs).toHaveBeenCalledWith(90);
      expect(result).toEqual({
        message: 'Archived 42 audit logs older than 90 days',
        deletedCount: 42,
      });
    });

    it('defaults to 365 days when no query param is given', async () => {
      (service.archiveOldLogs as jest.Mock<any>).mockResolvedValue(0);

      await controller.archiveAuditLogs(undefined as unknown as string);

      expect(service.archiveOldLogs).toHaveBeenCalledWith(365);
    });

    it('throws BadRequestException when retention is below 30 days', async () => {
      await expect(controller.archiveAuditLogs('10')).rejects.toThrow(
        BadRequestException,
      );
      await expect(controller.archiveAuditLogs('10')).rejects.toThrow(
        'Retention days must be at least 30',
      );
      expect(service.archiveOldLogs).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when retention is not a number', async () => {
      await expect(controller.archiveAuditLogs('not-a-number')).rejects.toThrow(
        BadRequestException,
      );
      expect(service.archiveOldLogs).not.toHaveBeenCalled();
    });
  });
});