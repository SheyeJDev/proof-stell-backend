import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LoggingService } from '../../logging/logging.service';

/** HTTP headers that must never appear in logs. */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
]);

/** Body keys that must never appear in logs. */
const SENSITIVE_BODY_KEYS = new Set([
  'password',
  'newpassword',
  'oldpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'secret',
  'authorization',
]);

/** Maximum body size to log in characters; larger payloads are truncated. */
const MAX_BODY_LOG_LENGTH = 2_000;

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly loggingService: LoggingService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const error = exception instanceof Error ? exception : undefined;

    this.loggingService.error(
      `HTTP Exception: ${request.method} ${request.url}`,
      error,
      {
        method: request.method,
        route: request.route?.path || request.url,
        statusCode: status,
        metadata: {
          exceptionMessage:
            typeof message === 'string'
              ? message
              : (message as Record<string, unknown>)?.message,
          headers: this.redactHeaders(
            request.headers as Record<string, unknown>,
          ),
          body: this.redactBody(request.body),
        },
      },
    );

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    });
  }

  private redactHeaders(
    headers: Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [
        k,
        SENSITIVE_HEADERS.has(k.toLowerCase()) ? '[REDACTED]' : v,
      ]),
    );
  }

  private redactBody(body: unknown): unknown {
    if (!body || typeof body !== 'object') return body;

    const raw = JSON.stringify(body);
    if (raw.length > MAX_BODY_LOG_LENGTH) return '[BODY_TOO_LARGE]';

    if (Array.isArray(body)) {
      return (body as unknown[]).map((item) => this.redactBody(item));
    }

    return Object.fromEntries(
      Object.entries(body as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE_BODY_KEYS.has(k.toLowerCase())
          ? '[REDACTED]'
          : this.redactBody(v),
      ]),
    );
  }
}
