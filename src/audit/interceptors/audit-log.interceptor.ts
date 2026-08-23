import {
  Injectable,
  Logger,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { EMPTY, from, throwError } from 'rxjs';
import { catchError, switchMap, tap, timeout } from 'rxjs/operators';
import type { Request } from 'express';
import { AuditLogService } from '../services/audit-log.service';
import { extractClientIp } from '../../common/utils/extract-client-ip';

export const AUDIT_LOG_KEY = 'auditLog';

/** Hard cap on how long we'll wait for the audit DB to accept a write
 *  before rethrowing the original error. Bounded so a slow / down
 *  audit DB cannot stall every failing response. */
const AUDIT_WRITE_TIMEOUT_MS = 500;

export interface AuditLogMetadata {
  actionType: string;
  resource?: string;
  includeBody?: boolean;
  includeParams?: boolean;
  includeBeforeAfter?: boolean;
  includeExternalRequests?: boolean;
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    private readonly auditLogService: AuditLogService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const auditMetadata = this.reflector.getAllAndOverride<AuditLogMetadata>(
      AUDIT_LOG_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!auditMetadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as
      | { id?: string; role?: string; permissions?: string[] }
      | undefined;

    if (!user?.id) {
      // Without identity we have nothing to attribute the action to.
      // AdminGuard already covers the audit-on-denial case for admin
      // routes; for non-admin routes this is fine — the next guard
      // (or the handler) catches any access concerns itself.
      return next.handle();
    }

    const startTime = Date.now();
    const userId = user.id;
    const userRole = user.role;
    const userPermissions = user.permissions;

    return next.handle().pipe(
      tap((response) => {
        // Fire-and-forget on success: never block the response on the
        // audit DB. Internal try/catch inside `logAction` swallows any
        // failure so this Promise is always safe to discard.
        void this.logAction(
          auditMetadata,
          request,
          userId,
          'SUCCESS',
          response,
          Date.now() - startTime,
          undefined,
          userRole,
          userPermissions,
        );
      }),
      catchError((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error));
        // Await the audit write with a hard timeout, then rethrow the
        // ORIGINAL error so NestJS's exception filter emits the right
        // status. If the audit write hangs/times out/fails, we still
        // rethrow — we never swallow the user-facing error.
        return from(
          this.logAction(
            auditMetadata,
            request,
            userId,
            'ERROR',
            undefined,
            Date.now() - startTime,
            err.message,
            userRole,
            userPermissions,
          ),
        ).pipe(
          timeout({
            first: AUDIT_WRITE_TIMEOUT_MS,
            meta: 'AuditLogInterceptor.error-write',
          }),
          catchError((auditErr: unknown) => {
            const aErr =
              auditErr instanceof Error
                ? auditErr
                : new Error(String(auditErr));
            this.logger.error(
              `Audit log write for ERROR result did not complete in ${AUDIT_WRITE_TIMEOUT_MS}ms (action=${auditMetadata.actionType}): ${aErr.message}`,
            );
            // Continue with the original error regardless.
            return EMPTY;
          }),
          switchMap(() => throwError(() => err)),
        );
      }),
    );
  }

  private async logAction(
    metadata: AuditLogMetadata,
    request: Request,
    userId: string,
    result: 'SUCCESS' | 'ERROR',
    responseData: unknown,
    duration: number,
    errorMessage?: string,
    userRole?: string,
    userPermissions?: string[],
  ): Promise<void> {
    try {
      const logMetadata: Record<string, unknown> = {
        method: request.method,
        url: request.originalUrl ?? request.url,
        duration,
        result,
      };

      if (userRole) {
        logMetadata.userRole = userRole;
      }

      if (userPermissions) {
        logMetadata.userPermissions = userPermissions;
      }

      if (metadata.includeParams && request.params) {
        logMetadata.params = request.params;
      }

      if (metadata.includeBody && request.body) {
        const sanitizedBody = this.sanitizeData(request.body);
        logMetadata.requestBody = sanitizedBody;
      }

      if (result === 'SUCCESS' && responseData) {
        try {
          logMetadata.responseSize = JSON.stringify(responseData).length;
        } catch {
          logMetadata.responseSize = -1;
        }
      }

      await this.auditLogService.logAction({
        actionType: metadata.actionType,
        userId,
        metadata: logMetadata,
        ipAddress: extractClientIp(request),
        userAgent: request.headers['user-agent'],
        resource: metadata.resource,
        result,
        errorMessage,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      // Never let an audit failure break the main request.
      this.logger.error(
        `Failed to create audit log (action=${metadata.actionType}): ${err.message}`,
        err.stack,
      );
    }
  }

  private sanitizeData(data: unknown): unknown {
    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'key',
      'authorization',
      'refreshToken',
      'accessToken',
    ];

    if (typeof data !== 'object' || data === null) {
      return data;
    }

    const sanitized: Record<string, unknown> = {
      ...(data as Record<string, unknown>),
    };

    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }

    return sanitized;
  }
}
