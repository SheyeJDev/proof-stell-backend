import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AUDIT_ACTIONS } from '../../audit/constants/audit-actions';
import { Role } from '../enums/role.enum';
import { extractClientIp } from '../utils/extract-client-ip';

/**
 * Single, tested admin gate.
 *
 * Behaviour:
 *  - Requires an authenticated user. The canonical way to populate
 *    `request.user` is `@UseGuards(JwtAuthGuard, AdminGuard)` (NestJS
 *    runs guards in order). Standalone, the guard also refuses
 *    unauthenticated requests with 401 so callers always get a clear
 *    security response.
 *  - Checks `user.role === Role.ADMIN` against the canonical Role
 *    enum — no stringly-typed comparisons, no array-based role
 *    lookups, no duplicated JWT verification.
 *  - On every denial, asynchronously records an `ACCESS_DENIED` audit
 *    entry. The write is fire-and-forget (best-effort) with an
 *    internal try/catch so a slow / unavailable audit database cannot
 *    be weaponised to delay the security response on every blocked
 *    request.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(private readonly auditLogService: AuditLogService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as { id?: string; role?: Role } | undefined;

    if (!user) {
      void this.recordDenial(request, 'NO_AUTH', 'Authentication required');
      throw new UnauthorizedException('Authentication required');
    }

    if (user.role !== Role.ADMIN) {
      void this.recordDenial(
        request,
        'INSUFFICIENT_PRIVILEGE',
        'Admin access required',
      );
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }

  private async recordDenial(
    request: Request,
    reason: 'NO_AUTH' | 'INSUFFICIENT_PRIVILEGE',
    message: string,
  ): Promise<void> {
    const user = request.user as { id?: string } | undefined;

    try {
      await this.auditLogService.logAction({
        actionType: AUDIT_ACTIONS.ACCESS_DENIED,
        userId: user?.id ?? 'anonymous',
        metadata: {
          reason,
          method: request.method,
          url: request.originalUrl ?? request.url,
          guard: AdminGuard.name,
        },
        ipAddress: extractClientIp(request),
        userAgent: request.headers['user-agent'],
        resource: 'admin',
        result: 'FAILURE',
        errorMessage: message,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to record admin access denial (${reason}): ${err.message}`,
        err.stack,
      );
    }
  }
}
