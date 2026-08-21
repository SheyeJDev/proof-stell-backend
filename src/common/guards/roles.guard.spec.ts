import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Role } from '../enums/role.enum';
import { AuditLogService } from '../../audit/services/audit-log.service';

const buildContext = (user: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        user,
        method: 'GET',
        originalUrl: '/test',
        headers: {},
      }),
    }),
    getHandler: jest.fn(),
    getClass: jest.fn(),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;
  let auditLogService: { logAction: jest.Mock };

  beforeEach(() => {
    reflector = new Reflector();
    auditLogService = { logAction: jest.fn().mockResolvedValue(undefined) };
    guard = new RolesGuard(reflector, auditLogService as unknown as AuditLogService);
  });

  it('allows access when no roles metadata is set', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    await expect(
      guard.canActivate(buildContext({ role: Role.PLAYER })),
    ).resolves.toBe(true);
  });

  it('allows a PLAYER to access a player route', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.PLAYER]);
    await expect(
      guard.canActivate(buildContext({ role: Role.PLAYER })),
    ).resolves.toBe(true);
  });

  it('allows an ADMIN to access a player+admin route', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Role.PLAYER, Role.ADMIN]);
    await expect(
      guard.canActivate(buildContext({ role: Role.ADMIN })),
    ).resolves.toBe(true);
  });

  it('denies a PLAYER from an admin-only route', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
    await expect(
      guard.canActivate(buildContext({ role: Role.PLAYER })),
    ).rejects.toThrow(ForbiddenException);
    expect(auditLogService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'FAILURE' }),
    );
  });

  it('denies an unauthenticated request', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
    await expect(
      guard.canActivate(buildContext(undefined)),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('uses exact enum comparison — does not grant access on partial string match', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
    await expect(
      guard.canActivate(buildContext({ role: 'admin-extra' as Role })),
    ).rejects.toThrow(ForbiddenException);
  });
});