import { Test, type TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AUDIT_ACTIONS } from '../../audit/constants/audit-actions';
import { Role } from '../enums/role.enum';
import type { Request } from 'express';
import { extractClientIp } from '../utils/extract-client-ip';

const buildContext = (request: Partial<Request>): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => request as unknown as Request,
      getResponse: () => ({}),
      getNext: () => jest.fn(),
    }),
    getHandler: () => jest.fn() as unknown as Function,
    getClass: () => jest.fn() as unknown as Function,
  }) as unknown as ExecutionContext;

const req = (overrides: Record<string, unknown>): Partial<Request> =>
  ({
    method: 'GET',
    url: '/admin/dashboard',
    originalUrl: '/api/v1/admin/dashboard',
    headers: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  }) as unknown as Partial<Request>;

describe('AdminGuard', () => {
  let guard: AdminGuard;
  let auditLogService: { logAction: jest.Mock };

  beforeEach(async () => {
    const mockAuditLogService = {
      logAction: jest.fn().mockResolvedValue({} as any),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminGuard,
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    guard = module.get<AdminGuard>(AdminGuard);
    auditLogService = module.get(AuditLogService);
  });

  it('is defined', () => {
    expect(guard).toBeDefined();
  });

  describe('authenticated admin', () => {
    it('allows the request and does not emit an audit entry', async () => {
      const request = req({
        user: { id: 'admin-1', role: Role.ADMIN, email: 'admin@x.com' },
      });

      const result = await guard.canActivate(buildContext(request));

      expect(result).toBe(true);
      expect(auditLogService.logAction).not.toHaveBeenCalled();
    });
  });

  describe('unauthenticated request', () => {
    it('throws UnauthorizedException and records an ACCESS_DENIED audit', async () => {
      const request = req({
        user: undefined,
        headers: { 'user-agent': 'jest' },
      });

      await expect(guard.canActivate(buildContext(request))).rejects.toThrow(
        UnauthorizedException,
      );

      expect(auditLogService.logAction).toHaveBeenCalledTimes(1);
      expect(auditLogService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: AUDIT_ACTIONS.ACCESS_DENIED,
          userId: 'anonymous',
          resource: 'admin',
          result: 'FAILURE',
          errorMessage: 'Authentication required',
          ipAddress: '127.0.0.1',
          userAgent: 'jest',
          metadata: expect.objectContaining({
            reason: 'NO_AUTH',
            method: 'GET',
            url: '/api/v1/admin/dashboard',
          }),
        }),
      );
    });

    it('still throws when AuditLogService.save fails (security first)', async () => {
      auditLogService.logAction.mockRejectedValueOnce(new Error('db down'));

      const request = req({
        user: undefined,
        method: 'POST',
        url: '/admin/metrics',
      });

      await expect(guard.canActivate(buildContext(request))).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('non-admin authenticated user', () => {
    it('throws ForbiddenException and records an ACCESS_DENIED audit with the real user id', async () => {
      const request = req({
        user: { id: 'user-1', role: Role.PLAYER, email: 'p@x.com' },
        method: 'PUT',
        url: '/admin/badges/uuid',
        originalUrl: '/api/v1/admin/badges/uuid',
        headers: { 'user-agent': 'jest', 'x-forwarded-for': '10.0.0.1' },
      });

      await expect(guard.canActivate(buildContext(request))).rejects.toThrow(
        ForbiddenException,
      );

      expect(auditLogService.logAction).toHaveBeenCalledTimes(1);
      expect(auditLogService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: AUDIT_ACTIONS.ACCESS_DENIED,
          userId: 'user-1',
          resource: 'admin',
          result: 'FAILURE',
          errorMessage: 'Admin access required',
          ipAddress: '10.0.0.1',
          userAgent: 'jest',
          metadata: expect.objectContaining({
            reason: 'INSUFFICIENT_PRIVILEGE',
            method: 'PUT',
            url: '/api/v1/admin/badges/uuid',
          }),
        }),
      );
    });
  });

  describe('authenticated user without an id claim', () => {
    it('records the denial with userId="anonymous" rather than undefined', async () => {
      const request = req({
        user: { role: Role.PLAYER },
      });

      await expect(guard.canActivate(buildContext(request))).rejects.toThrow(
        ForbiddenException,
      );

      expect(auditLogService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'anonymous' }),
      );
    });
  });

  describe('IP extraction', () => {
    it('prefers x-forwarded-for over other headers', () => {
      const request = req({
        headers: {
          'x-forwarded-for': '10.0.0.1, 10.0.0.2',
          'x-real-ip': '10.0.0.99',
        },
      });

      expect(extractClientIp(request)).toBe('10.0.0.1');
    });

    it('falls back to x-real-ip when x-forwarded-for is absent', () => {
      const request = req({
        headers: { 'x-real-ip': '10.0.0.5' },
      });

      expect(extractClientIp(request)).toBe('10.0.0.5');
    });
  });
});
