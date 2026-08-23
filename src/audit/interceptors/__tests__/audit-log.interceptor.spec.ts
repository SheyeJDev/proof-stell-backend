import { Test, type TestingModule } from '@nestjs/testing';
import type { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, throwError } from 'rxjs';
import {
  AuditLogInterceptor,
  type AuditLogMetadata,
  AUDIT_LOG_KEY,
} from '../audit-log.interceptor';
import {
  AuditLogService,
  type LogActionParams,
} from '../../services/audit-log.service';
import { jest } from '@jest/globals';

describe('AuditLogInterceptor', () => {
  let interceptor: AuditLogInterceptor;
  let auditLogService: jest.Mocked<Pick<AuditLogService, 'logAction'>>;
  let reflector: { getAllAndOverride: jest.Mock; get: jest.Mock };

  const handler = function namedHandler() {};
  const cls = class SomeClass {};

  const makeContext = (request: unknown) =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
        getNext: () => jest.fn(),
      }),
      getHandler: () => handler,
      getClass: () => cls,
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    const mockAuditLogService: jest.Mocked<Pick<AuditLogService, 'logAction'>> =
      {
        logAction: jest.fn(),
      };

    const mockReflector = {
      getAllAndOverride: jest.fn(),
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogInterceptor,
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    interceptor = module.get<AuditLogInterceptor>(AuditLogInterceptor);
    auditLogService = module.get(AuditLogService);
    reflector = module.get(Reflector);
  });

  it('is defined', () => {
    expect(interceptor).toBeDefined();
  });

  it('passes through when no audit metadata is found at handler or class', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const handlerStub = {
      handle: jest.fn().mockReturnValue(of('response')),
    } as unknown as CallHandler;

    await new Promise<void>((resolve, reject) => {
      interceptor
        .intercept(makeContext({}), handlerStub)
        .subscribe({ next: resolve, error: reject });
    });

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(AUDIT_LOG_KEY, [
      handler,
      cls,
    ]);
    expect(auditLogService.logAction).not.toHaveBeenCalled();
  });

  it('passes through when no authenticated user is on the request', async () => {
    const metadata: AuditLogMetadata = { actionType: 'ADMIN_VIEW' };
    reflector.getAllAndOverride.mockReturnValue(metadata);

    const handlerStub = {
      handle: jest.fn().mockReturnValue(of('response')),
    } as unknown as CallHandler;
    const request = {
      method: 'GET',
      url: '/x',
      originalUrl: '/api/v1/x',
      headers: {},
      user: undefined,
    };

    await new Promise<void>((resolve, reject) => {
      interceptor
        .intercept(makeContext(request), handlerStub)
        .subscribe({ next: resolve, error: reject });
    });

    expect(auditLogService.logAction).not.toHaveBeenCalled();
  });

  it('reads metadata from the class when the handler has no decorator', async () => {
    const metadata: AuditLogMetadata = {
      actionType: 'CLASS_LEVEL',
      resource: 'admin:class',
    };
    reflector.getAllAndOverride.mockReturnValue(metadata);

    const handlerStub = {
      handle: jest.fn().mockReturnValue(of({ ok: true })),
    } as unknown as CallHandler;
    const request = {
      method: 'GET',
      url: '/x',
      originalUrl: '/api/v1/x',
      headers: { 'user-agent': 'jest' },
      user: { id: 'user-123' },
    };

    await new Promise<void>((resolve, reject) => {
      interceptor
        .intercept(makeContext(request), handlerStub)
        .subscribe({ next: resolve, error: reject });
    });

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(AUDIT_LOG_KEY, [
      handler,
      cls,
    ]);

    await new Promise<void>((r) => setImmediate(r));

    expect(auditLogService.logAction).toHaveBeenCalledTimes(1);
    expect(auditLogService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'CLASS_LEVEL',
        resource: 'admin:class',
      }),
    );
  });

  it('logs a SUCCESS entry with sanitized body, params, duration, and response size', async () => {
    const metadata: AuditLogMetadata = {
      actionType: 'ADMIN_DASHBOARD_VIEW',
      resource: 'admin:dashboard',
      includeBody: true,
      includeParams: true,
    };
    reflector.getAllAndOverride.mockReturnValue(metadata);

    const handlerStub = {
      handle: jest.fn().mockReturnValue(of({ ok: true })),
    } as unknown as CallHandler;

    const request = {
      method: 'POST',
      url: '/api/users',
      originalUrl: '/api/v1/api/users',
      params: { id: '123' },
      body: { name: 'John', password: 'secret' },
      headers: { 'user-agent': 'Mozilla/5.0', 'x-forwarded-for': '10.0.0.1' },
      user: { id: 'user-123' },
    };

    await new Promise<void>((resolve, reject) => {
      interceptor
        .intercept(makeContext(request), handlerStub)
        .subscribe({ next: resolve, error: reject });
    });

    await new Promise<void>((r) => setImmediate(r));

    expect(auditLogService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'ADMIN_DASHBOARD_VIEW',
        userId: 'user-123',
        ipAddress: '10.0.0.1',
        userAgent: 'Mozilla/5.0',
        resource: 'admin:dashboard',
        result: 'SUCCESS',
        metadata: expect.objectContaining({
          method: 'POST',
          url: '/api/v1/api/users',
          result: 'SUCCESS',
          duration: expect.any(Number),
          params: { id: '123' },
          requestBody: { name: 'John', password: '[REDACTED]' },
          responseSize: expect.any(Number),
        }),
      }),
    );
  });

  it('awaits an ERROR log before rethrowing the original error (assertion survives)', async () => {
    const metadata: AuditLogMetadata = {
      actionType: 'ADMIN_EXPORT_CSV',
      resource: 'admin:export',
    };
    reflector.getAllAndOverride.mockReturnValue(metadata);

    auditLogService.logAction.mockResolvedValue(undefined as any);

    const boom = new Error('Validation failed');
    const handlerStub = {
      handle: jest.fn().mockReturnValue(throwError(() => boom)),
    } as unknown as CallHandler;

    const request = {
      method: 'POST',
      url: '/admin/export/csv',
      originalUrl: '/api/v1/admin/export/csv',
      headers: { 'user-agent': 'jest' },
      user: { id: 'user-123' },
    };

    let received: unknown = null;
    try {
      await new Promise<void>((resolve, reject) => {
        interceptor
          .intercept(makeContext(request), handlerStub)
          .subscribe({ next: resolve, error: reject });
      });
    } catch (err) {
      received = err;
    }

    await new Promise<void>((r) => setImmediate(r));

    expect(received).toBe(boom);

    expect(auditLogService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'ADMIN_EXPORT_CSV',
        userId: 'user-123',
        result: 'ERROR',
        errorMessage: 'Validation failed',
        metadata: expect.objectContaining({
          method: 'POST',
          url: '/api/v1/admin/export/csv',
          result: 'ERROR',
          duration: expect.any(Number),
        }),
      }),
    );
  });

  it('sanitizes a broader set of sensitive fields', async () => {
    const metadata: AuditLogMetadata = {
      actionType: 'USER_UPDATED',
      includeBody: true,
    };
    reflector.getAllAndOverride.mockReturnValue(metadata);

    const handlerStub = {
      handle: jest.fn().mockReturnValue(of({})),
    } as unknown as CallHandler;

    const request = {
      method: 'PUT',
      url: '/users/me',
      originalUrl: '/api/v1/users/me',
      body: {
        name: 'Jane',
        password: 'p',
        token: 't',
        secret: 's',
        key: 'k',
        authorization: 'Bearer x',
        refreshToken: 'rt',
        accessToken: 'at',
        notes: 'public',
      },
      headers: { 'user-agent': 'jest' },
      user: { id: 'user-123' },
    };

    await new Promise<void>((resolve, reject) => {
      interceptor
        .intercept(makeContext(request), handlerStub)
        .subscribe({ next: resolve, error: reject });
    });

    await new Promise<void>((r) => setImmediate(r));

    expect(auditLogService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          requestBody: {
            name: 'Jane',
            password: '[REDACTED]',
            token: '[REDACTED]',
            secret: '[REDACTED]',
            key: '[REDACTED]',
            authorization: '[REDACTED]',
            refreshToken: '[REDACTED]',
            accessToken: '[REDACTED]',
            notes: 'public',
          },
        }),
      }),
    );
  });
});
