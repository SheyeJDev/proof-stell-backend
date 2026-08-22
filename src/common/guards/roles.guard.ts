import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Role } from '../enums/role.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AUDIT_ACTIONS } from '../../audit/constants/audit-actions';
import { extractClientIp } from '../utils/extract-client-ip';

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditLogService: AuditLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as { id?: string; role?: Role } | undefined;

    if (!user) {
      void this.recordDenial(request, undefined, requiredRoles, 'NO_AUTH');
      throw new UnauthorizedException('Authentication required');
    }

    if (!user.role || !requiredRoles.includes(user.role)) {
      void this.recordDenial(
        request,
        user.id,
        requiredRoles,
        'INSUFFICIENT_PRIVILEGE',
      );
      throw new ForbiddenException('Insufficient role privileges');
    }

    return true;
  }

  private async recordDenial(
    request: Request,
    userId: string | undefined,
    requiredRoles: Role[],
    reason: 'NO_AUTH' | 'INSUFFICIENT_PRIVILEGE',
  ): Promise<void> {
    try {
      await this.auditLogService.logAction({
        actionType: AUDIT_ACTIONS.ACCESS_DENIED,
        userId: userId ?? 'anonymous',
        metadata: {
          reason,
          requiredRoles,
          method: request.method,
          url: request.originalUrl ?? request.url,
          guard: RolesGuard.name,
        },
        ipAddress: extractClientIp(request),
        userAgent: request.headers['user-agent'],
        resource: 'role-protected',
        result: 'FAILURE',
        errorMessage:
          reason === 'NO_AUTH'
            ? 'Authentication required'
            : 'Insufficient role privileges',
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to record access denial (${reason}): ${err.message}`,
        err.stack,
      );
    }
  }
}
