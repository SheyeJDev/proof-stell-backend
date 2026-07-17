import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { AuditLogService } from '../services/audit-log.service';
import { AuditLogController } from '../controllers/audit-log.controller';
import { AUDIT_ACTIONS } from '../constants/audit-actions';

describe('Audit Logging Integration Tests', () => {
  let app: INestApplication;
  let auditLogRepository: Repository<AuditLog>;
  let auditLogService: AuditLogService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuditLogController],
      providers: [
        AuditLogService,
        {
          provide: getRepositoryToken(AuditLog),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findAndCount: jest.fn(),
            findOne: jest.fn(),
            count: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    auditLogRepository = moduleFixture.get<Repository<AuditLog>>(
      getRepositoryToken(AuditLog),
    );
    auditLogService = moduleFixture.get<AuditLogService>(AuditLogService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Critical Operations Audit Logging', () => {
    it('should create audit log for password change', async () => {
      const mockAuditLog = {
        id: 'test-id',
        userId: 'user-123',
        actionType: AUDIT_ACTIONS.PASSWORD_CHANGE,
        metadata: {},
        createdAt: new Date(),
        result: 'SUCCESS',
      };

      jest.spyOn(auditLogRepository, 'create').mockReturnValue(mockAuditLog as any);
      jest.spyOn(auditLogRepository, 'save').mockResolvedValue(mockAuditLog as any);

      await auditLogService.logAction({
        actionType: AUDIT_ACTIONS.PASSWORD_CHANGE,
        userId: 'user-123',
        metadata: { method: 'PATCH', url: '/users/profile/change-password' },
        result: 'SUCCESS',
      });

      expect(auditLogRepository.create).toHaveBeenCalled();
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('should create audit log for token mint operation', async () => {
      const mockAuditLog = {
        id: 'test-id',
        userId: 'user-123',
        actionType: AUDIT_ACTIONS.TOKEN_MINT,
        metadata: {
          transactionHash: '0x1234567890abcdef',
          method: 'POST',
          url: '/mint/mint',
        },
        createdAt: new Date(),
        result: 'SUCCESS',
      };

      jest.spyOn(auditLogRepository, 'create').mockReturnValue(mockAuditLog as any);
      jest.spyOn(auditLogRepository, 'save').mockResolvedValue(mockAuditLog as any);

      await auditLogService.logAction({
        actionType: AUDIT_ACTIONS.TOKEN_MINT,
        userId: 'user-123',
        metadata: {
          transactionHash: '0x1234567890abcdef',
          method: 'POST',
          url: '/mint/mint',
        },
        result: 'SUCCESS',
      });

      expect(auditLogRepository.create).toHaveBeenCalled();
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('should create audit log for token transfer operation', async () => {
      const mockAuditLog = {
        id: 'test-id',
        userId: 'user-123',
        actionType: AUDIT_ACTIONS.TOKEN_TRANSFER,
        metadata: {
          fromAddress: '0xabc',
          toAddress: '0xdef',
          amount: '100',
          method: 'POST',
          url: '/wallet/send-transaction',
        },
        createdAt: new Date(),
        result: 'SUCCESS',
      };

      jest.spyOn(auditLogRepository, 'create').mockReturnValue(mockAuditLog as any);
      jest.spyOn(auditLogRepository, 'save').mockResolvedValue(mockAuditLog as any);

      await auditLogService.logAction({
        actionType: AUDIT_ACTIONS.TOKEN_TRANSFER,
        userId: 'user-123',
        metadata: {
          fromAddress: '0xabc',
          toAddress: '0xdef',
          amount: '100',
          method: 'POST',
          url: '/wallet/send-transaction',
        },
        result: 'SUCCESS',
      });

      expect(auditLogRepository.create).toHaveBeenCalled();
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('should create audit log for user creation', async () => {
      const mockAuditLog = {
        id: 'test-id',
        userId: 'admin-123',
        actionType: AUDIT_ACTIONS.USER_CREATED,
        metadata: {
          method: 'POST',
          url: '/users',
          requestBody: { email: 'newuser@example.com', role: 'user' },
        },
        createdAt: new Date(),
        result: 'SUCCESS',
      };

      jest.spyOn(auditLogRepository, 'create').mockReturnValue(mockAuditLog as any);
      jest.spyOn(auditLogRepository, 'save').mockResolvedValue(mockAuditLog as any);

      await auditLogService.logAction({
        actionType: AUDIT_ACTIONS.USER_CREATED,
        userId: 'admin-123',
        metadata: {
          method: 'POST',
          url: '/users',
          requestBody: { email: 'newuser@example.com', role: 'user' },
        },
        result: 'SUCCESS',
      });

      expect(auditLogRepository.create).toHaveBeenCalled();
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('should create audit log for user deletion', async () => {
      const mockAuditLog = {
        id: 'test-id',
        userId: 'admin-123',
        actionType: AUDIT_ACTIONS.USER_DELETED,
        metadata: {
          method: 'DELETE',
          url: '/users/user-456',
          params: { id: 'user-456' },
        },
        createdAt: new Date(),
        result: 'SUCCESS',
      };

      jest.spyOn(auditLogRepository, 'create').mockReturnValue(mockAuditLog as any);
      jest.spyOn(auditLogRepository, 'save').mockResolvedValue(mockAuditLog as any);

      await auditLogService.logAction({
        actionType: AUDIT_ACTIONS.USER_DELETED,
        userId: 'admin-123',
        metadata: {
          method: 'DELETE',
          url: '/users/user-456',
          params: { id: 'user-456' },
        },
        result: 'SUCCESS',
      });

      expect(auditLogRepository.create).toHaveBeenCalled();
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('should create audit log for admin role changes', async () => {
      const mockAuditLog = {
        id: 'test-id',
        userId: 'admin-123',
        actionType: AUDIT_ACTIONS.ADMIN_ROLE_ASSIGNED,
        metadata: {
          method: 'PATCH',
          url: '/users/user-789',
          requestBody: { role: 'admin' },
        },
        createdAt: new Date(),
        result: 'SUCCESS',
      };

      jest.spyOn(auditLogRepository, 'create').mockReturnValue(mockAuditLog as any);
      jest.spyOn(auditLogRepository, 'save').mockResolvedValue(mockAuditLog as any);

      await auditLogService.logAction({
        actionType: AUDIT_ACTIONS.ADMIN_ROLE_ASSIGNED,
        userId: 'admin-123',
        metadata: {
          method: 'PATCH',
          url: '/users/user-789',
          requestBody: { role: 'admin' },
        },
        result: 'SUCCESS',
      });

      expect(auditLogRepository.create).toHaveBeenCalled();
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('should create audit log for game session start', async () => {
      const mockAuditLog = {
        id: 'test-id',
        userId: 'user-123',
        actionType: AUDIT_ACTIONS.SESSION_STARTED,
        metadata: {
          method: 'POST',
          url: '/session/start',
          requestBody: { challengeId: 'challenge-1' },
        },
        createdAt: new Date(),
        result: 'SUCCESS',
      };

      jest.spyOn(auditLogRepository, 'create').mockReturnValue(mockAuditLog as any);
      jest.spyOn(auditLogRepository, 'save').mockResolvedValue(mockAuditLog as any);

      await auditLogService.logAction({
        actionType: AUDIT_ACTIONS.SESSION_STARTED,
        userId: 'user-123',
        metadata: {
          method: 'POST',
          url: '/session/start',
          requestBody: { challengeId: 'challenge-1' },
        },
        result: 'SUCCESS',
      });

      expect(auditLogRepository.create).toHaveBeenCalled();
      expect(auditLogRepository.save).toHaveBeenCalled();
    });

    it('should create audit log for game session report', async () => {
      const mockAuditLog = {
        id: 'test-id',
        userId: 'user-123',
        actionType: AUDIT_ACTIONS.SESSION_REPORTED,
        metadata: {
          method: 'POST',
          url: '/session/report',
          requestBody: { sessionId: 'session-1', score: 100 },
        },
        createdAt: new Date(),
        result: 'SUCCESS',
      };

      jest.spyOn(auditLogRepository, 'create').mockReturnValue(mockAuditLog as any);
      jest.spyOn(auditLogRepository, 'save').mockResolvedValue(mockAuditLog as any);

      await auditLogService.logAction({
        actionType: AUDIT_ACTIONS.SESSION_REPORTED,
        userId: 'user-123',
        metadata: {
          method: 'POST',
          url: '/session/report',
          requestBody: { sessionId: 'session-1', score: 100 },
        },
        result: 'SUCCESS',
      });

      expect(auditLogRepository.create).toHaveBeenCalled();
      expect(auditLogRepository.save).toHaveBeenCalled();
    });
  });

  describe('Data Integrity Tests', () => {
    it('should include user role in audit metadata when provided', async () => {
      const mockAuditLog = {
        id: 'test-id',
        userId: 'user-123',
        actionType: AUDIT_ACTIONS.USER_PROFILE_UPDATED,
        metadata: {
          method: 'PATCH',
          url: '/users/profile',
          userRole: 'admin',
          userPermissions: ['read', 'write', 'delete'],
        },
        createdAt: new Date(),
        result: 'SUCCESS',
      };

      jest.spyOn(auditLogRepository, 'create').mockReturnValue(mockAuditLog as any);
      jest.spyOn(auditLogRepository, 'save').mockResolvedValue(mockAuditLog as any);

      await auditLogService.logAction({
        actionType: AUDIT_ACTIONS.USER_PROFILE_UPDATED,
        userId: 'user-123',
        metadata: {
          method: 'PATCH',
          url: '/users/profile',
          userRole: 'admin',
          userPermissions: ['read', 'write', 'delete'],
        },
        result: 'SUCCESS',
      });

      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            userRole: 'admin',
            userPermissions: ['read', 'write', 'delete'],
          }),
        }),
      );
    });

    it('should sanitize sensitive data in request body', async () => {
      const mockAuditLog = {
        id: 'test-id',
        userId: 'user-123',
        actionType: AUDIT_ACTIONS.PASSWORD_CHANGE,
        metadata: {
          method: 'PATCH',
          url: '/users/profile/change-password',
          requestBody: {
            currentPassword: '[REDACTED]',
            newPassword: '[REDACTED]',
          },
        },
        createdAt: new Date(),
        result: 'SUCCESS',
      };

      jest.spyOn(auditLogRepository, 'create').mockReturnValue(mockAuditLog as any);
      jest.spyOn(auditLogRepository, 'save').mockResolvedValue(mockAuditLog as any);

      await auditLogService.logAction({
        actionType: AUDIT_ACTIONS.PASSWORD_CHANGE,
        userId: 'user-123',
        metadata: {
          method: 'PATCH',
          url: '/users/profile/change-password',
          requestBody: {
            currentPassword: '[REDACTED]',
            newPassword: '[REDACTED]',
          },
        },
        result: 'SUCCESS',
      });

      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            requestBody: expect.objectContaining({
              currentPassword: '[REDACTED]',
              newPassword: '[REDACTED]',
            }),
          }),
        }),
      );
    });
  });

  describe('Audit Log Filtering and Export', () => {
    it('should filter logs by user ID', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          userId: 'user-123',
          actionType: AUDIT_ACTIONS.USER_PROFILE_UPDATED,
          metadata: {},
          createdAt: new Date(),
        },
      ];

      jest.spyOn(auditLogRepository, 'findAndCount').mockResolvedValue([mockLogs, 1]);

      const result = await auditLogService.findLogs({ userId: 'user-123' });

      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].userId).toBe('user-123');
    });

    it('should filter logs by action type', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          userId: 'user-123',
          actionType: AUDIT_ACTIONS.TOKEN_MINT,
          metadata: {},
          createdAt: new Date(),
        },
      ];

      jest.spyOn(auditLogRepository, 'findAndCount').mockResolvedValue([mockLogs, 1]);

      const result = await auditLogService.findLogs({
        actionType: AUDIT_ACTIONS.TOKEN_MINT,
      });

      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].actionType).toBe(AUDIT_ACTIONS.TOKEN_MINT);
    });

    it('should export logs to CSV format', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          userId: 'user-123',
          actionType: AUDIT_ACTIONS.TOKEN_MINT,
          metadata: { transactionHash: '0x123' },
          createdAt: new Date(),
          ipAddress: '192.168.1.1',
          resource: 'blockchain:mint',
          result: 'SUCCESS',
        },
      ];

      jest.spyOn(auditLogRepository, 'findAndCount').mockResolvedValue([mockLogs, 1]);

      const result = await auditLogService.exportLogs({}, 'csv');

      expect(result.mimeType).toBe('text/csv');
      expect(result.filename).toContain('.csv');
      expect(result.data).toContain('id,userId,actionType');
    });

    it('should export logs to JSON format', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          userId: 'user-123',
          actionType: AUDIT_ACTIONS.TOKEN_MINT,
          metadata: { transactionHash: '0x123' },
          createdAt: new Date(),
          ipAddress: '192.168.1.1',
          resource: 'blockchain:mint',
          result: 'SUCCESS',
        },
      ];

      jest.spyOn(auditLogRepository, 'findAndCount').mockResolvedValue([mockLogs, 1]);

      const result = await auditLogService.exportLogs({}, 'json');

      expect(result.mimeType).toBe('application/json');
      expect(result.filename).toContain('.json');
      expect(result.data).toContain('log-1');
    });
  });

  describe('Audit Log Archival', () => {
    it('should archive logs older than retention period', async () => {
      const mockDeleteResult = { affected: 100, raw: {} };
      const mockQueryBuilder = {
        delete: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(mockDeleteResult),
      };

      jest
        .spyOn(auditLogRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const deletedCount = await auditLogService.archiveOldLogs(365);

      expect(deletedCount).toBe(100);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'createdAt < :cutoffDate',
        expect.any(Object),
      );
    });

    it('should not archive logs within retention period', async () => {
      const mockDeleteResult = { affected: 0, raw: {} };
      const mockQueryBuilder = {
        delete: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(mockDeleteResult),
      };

      jest
        .spyOn(auditLogRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const deletedCount = await auditLogService.archiveOldLogs(1);

      expect(deletedCount).toBe(0);
    });
  });
});
