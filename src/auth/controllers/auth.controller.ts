import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  ValidationPipe,
  Query,
  Get,
  HttpCode,
  HttpStatus,
  Headers,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { Counter, Histogram, register } from 'prom-client';
import { AuthService } from '../providers/auth.service';
import { LocalAuthGuard } from 'src/common/guards/local-auth.guard';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { LoginDto } from '../dto/login.dto';
import { RegisterDto } from '../dto/register.dto';
import {
  LoginResponseDto,
  RegisterResponseDto,
  MessageResponseDto,
} from '../dto/auth-response.dto';
import { TrackMetrics } from 'src/common/metrics/metrics.decorator';

function getOrCreateCounter<T extends string>(
  config: import('prom-client').CounterConfiguration<T>,
): Counter<T> {
  const existing = register.getSingleMetric(config.name);
  if (existing) {
    return existing as Counter<T>;
  }
  return new Counter<T>(config);
}

function getOrCreateHistogram<T extends string>(
  config: import('prom-client').HistogramConfiguration<T>,
): Histogram<T> {
  const existing = register.getSingleMetric(config.name);
  if (existing) {
    return existing as Histogram<T>;
  }
  return new Histogram<T>(config);
}

export const authRequestsCounter = getOrCreateCounter({
  name: 'auth_requests_total',
  help: 'Total number of auth requests by endpoint and status',
  labelNames: ['endpoint', 'status'] as const,
});

export const authRequestDurationHistogram = getOrCreateHistogram({
  name: 'auth_request_duration_ms',
  help: 'Duration of auth requests in milliseconds',
  labelNames: ['endpoint', 'status'] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
});

export const authErrorsCounter = getOrCreateCounter({
  name: 'auth_errors_total',
  help: 'Total number of auth errors by endpoint and error type',
  labelNames: ['endpoint', 'error_type'] as const,
});

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Login user' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: 'User logged in successfully',
    type: LoginResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials',
  })
  @ApiResponse({
    status: 429,
    description: 'Too many login attempts. Try again in 5 minutes.',
  })
  // Strict rate limit: 5 attempts per 5 minutes per IP to prevent brute-force
  @Throttle({ default: { ttl: 300, limit: 5 } })
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @TrackMetrics({ category: 'auth', operation: 'login' })
  async login(@Body(ValidationPipe) loginDto: LoginDto, @Request() req) {
    const startTime = Date.now();
    try {
      const result = await this.authService.login(req.user, {
        ip: this.getClientIp(req),
        userAgent: req.get?.('user-agent'),
      });
      const durationMs = Date.now() - startTime;
      authRequestDurationHistogram.observe(
        { endpoint: 'login', status: 'success' },
        durationMs,
      );
      authRequestsCounter.inc({ endpoint: 'login', status: 'success' });
      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      authRequestDurationHistogram.observe(
        { endpoint: 'login', status: 'error' },
        durationMs,
      );
      authRequestsCounter.inc({ endpoint: 'login', status: 'error' });
      authErrorsCounter.inc({
        endpoint: 'login',
        error_type: error?.name || 'Error',
      });
      throw error;
    }
  }

  @ApiOperation({ summary: 'Refresh access token using a valid refresh token' })
  @ApiResponse({
    status: 200,
    description: 'Token pair refreshed successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid, expired, or reused refresh token',
  })
  @Throttle({ default: { ttl: 60, limit: 10 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @TrackMetrics({ category: 'auth', operation: 'refresh' })
  async refresh(
    @Body('refresh_token') refreshToken: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const startTime = Date.now();
    try {
      if (!refreshToken || typeof refreshToken !== 'string') {
        const durationMs = Date.now() - startTime;
        authRequestDurationHistogram.observe(
          { endpoint: 'refresh', status: 'bad_request' },
          durationMs,
        );
        authRequestsCounter.inc({ endpoint: 'refresh', status: 'bad_request' });
        return { access_token: '', refresh_token: '' };
      }
      const result = await this.authService.refreshTokens(refreshToken);
      const durationMs = Date.now() - startTime;
      authRequestDurationHistogram.observe(
        { endpoint: 'refresh', status: 'success' },
        durationMs,
      );
      authRequestsCounter.inc({ endpoint: 'refresh', status: 'success' });
      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      authRequestDurationHistogram.observe(
        { endpoint: 'refresh', status: 'error' },
        durationMs,
      );
      authRequestsCounter.inc({ endpoint: 'refresh', status: 'error' });
      authErrorsCounter.inc({
        endpoint: 'refresh',
        error_type: error?.name || 'Error',
      });
      throw error;
    }
  }

  @ApiOperation({ summary: 'Logout user and revoke current session' })
  @ApiResponse({
    status: 200,
    description: 'User logged out successfully',
    type: MessageResponseDto,
  })
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @TrackMetrics({ category: 'auth', operation: 'logout' })
  async logout(
    @Headers('authorization') authorization?: string,
    @Body('refresh_token') refreshToken?: string,
  ): Promise<MessageResponseDto> {
    const startTime = Date.now();
    try {
      const accessToken = this.extractBearerToken(authorization);
      await this.authService.logout(accessToken, refreshToken);
      const durationMs = Date.now() - startTime;
      authRequestDurationHistogram.observe(
        { endpoint: 'logout', status: 'success' },
        durationMs,
      );
      authRequestsCounter.inc({ endpoint: 'logout', status: 'success' });
      return { message: 'Logged out successfully' };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      authRequestDurationHistogram.observe(
        { endpoint: 'logout', status: 'error' },
        durationMs,
      );
      authRequestsCounter.inc({ endpoint: 'logout', status: 'error' });
      authErrorsCounter.inc({
        endpoint: 'logout',
        error_type: error?.name || 'Error',
      });
      throw error;
    }
  }

  @ApiOperation({ summary: 'Logout from all sessions (force-expire)' })
  @ApiResponse({
    status: 200,
    description: 'All sessions revoked',
    type: MessageResponseDto,
  })
  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @TrackMetrics({ category: 'auth', operation: 'logoutAll' })
  async logoutAll(@Request() req): Promise<MessageResponseDto> {
    const startTime = Date.now();
    try {
      await this.authService.forceExpireAllSessions(req.user.id);
      const durationMs = Date.now() - startTime;
      authRequestDurationHistogram.observe(
        { endpoint: 'logoutAll', status: 'success' },
        durationMs,
      );
      authRequestsCounter.inc({ endpoint: 'logoutAll', status: 'success' });
      return { message: 'All sessions revoked' };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      authRequestDurationHistogram.observe(
        { endpoint: 'logoutAll', status: 'error' },
        durationMs,
      );
      authRequestsCounter.inc({ endpoint: 'logoutAll', status: 'error' });
      authErrorsCounter.inc({
        endpoint: 'logoutAll',
        error_type: error?.name || 'Error',
      });
      throw error;
    }
  }

  @ApiOperation({ summary: 'Register new user' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully',
    type: RegisterResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data or user already exists',
  })
  @ApiResponse({
    status: 429,
    description: 'Too many registration attempts.',
  })
  // Moderate rate limit: 10 registrations per 10 minutes per IP
  @Throttle({ default: { ttl: 600, limit: 10 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @TrackMetrics({ category: 'auth', operation: 'register' })
  async register(@Body(ValidationPipe) registerDto: RegisterDto) {
    const startTime = Date.now();
    try {
      const result = await this.authService.register(registerDto);
      const durationMs = Date.now() - startTime;
      authRequestDurationHistogram.observe(
        { endpoint: 'register', status: 'success' },
        durationMs,
      );
      authRequestsCounter.inc({ endpoint: 'register', status: 'success' });
      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      authRequestDurationHistogram.observe(
        { endpoint: 'register', status: 'error' },
        durationMs,
      );
      authRequestsCounter.inc({ endpoint: 'register', status: 'error' });
      authErrorsCounter.inc({
        endpoint: 'register',
        error_type: error?.name || 'Error',
      });
      throw error;
    }
  }

  @ApiOperation({ summary: 'Resend email verification' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          format: 'email',
          maxLength: 254,
          example: 'user@example.com',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Verification email resent successfully',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid email or user not found',
  })
  @ApiResponse({
    status: 429,
    description: 'Too many resend attempts. Try again later.',
  })
  // Password reset / resend: 3 attempts per hour per IP to prevent email flooding
  @Throttle({ default: { ttl: 3600, limit: 3 } })
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @TrackMetrics({ category: 'auth', operation: 'resendVerification' })
  async resendVerification(
    @Body('email') email: string,
  ): Promise<MessageResponseDto> {
    const startTime = Date.now();
    try {
      // Sanitize: enforce max length and strip surrounding whitespace before processing
      if (!email || typeof email !== 'string' || email.trim().length === 0) {
        const durationMs = Date.now() - startTime;
        authRequestDurationHistogram.observe(
          { endpoint: 'resendVerification', status: 'empty' },
          durationMs,
        );
        authRequestsCounter.inc({
          endpoint: 'resendVerification',
          status: 'empty',
        });
        return { message: 'Verification email resent' }; // Fail silently to avoid user enumeration
      }
      await this.authService.resendVerificationEmail(
        email.trim().slice(0, 254),
      );
      const durationMs = Date.now() - startTime;
      authRequestDurationHistogram.observe(
        { endpoint: 'resendVerification', status: 'success' },
        durationMs,
      );
      authRequestsCounter.inc({
        endpoint: 'resendVerification',
        status: 'success',
      });
      return { message: 'Verification email resent' };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      authRequestDurationHistogram.observe(
        { endpoint: 'resendVerification', status: 'error' },
        durationMs,
      );
      authRequestsCounter.inc({
        endpoint: 'resendVerification',
        status: 'error',
      });
      authErrorsCounter.inc({
        endpoint: 'resendVerification',
        error_type: error?.name || 'Error',
      });
      throw error;
    }
  }

  @ApiOperation({ summary: 'Verify user email' })
  @ApiQuery({
    name: 'token',
    description: 'Email verification token',
    example: 'abc123-def456-ghi789',
  })
  @ApiResponse({
    status: 200,
    description: 'Email verified successfully',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired token',
  })
  @Get('verify-email')
  @HttpCode(HttpStatus.OK)
  @TrackMetrics({ category: 'auth', operation: 'verifyEmail' })
  async verifyEmail(
    @Query('token') token: string,
  ): Promise<MessageResponseDto> {
    const startTime = Date.now();
    try {
      await this.authService.verifyEmail(token);
      const durationMs = Date.now() - startTime;
      authRequestDurationHistogram.observe(
        { endpoint: 'verifyEmail', status: 'success' },
        durationMs,
      );
      authRequestsCounter.inc({ endpoint: 'verifyEmail', status: 'success' });
      return { message: 'Email verified successfully' };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      authRequestDurationHistogram.observe(
        { endpoint: 'verifyEmail', status: 'error' },
        durationMs,
      );
      authRequestsCounter.inc({ endpoint: 'verifyEmail', status: 'error' });
      authErrorsCounter.inc({
        endpoint: 'verifyEmail',
        error_type: error?.name || 'Error',
      });
      throw error;
    }
  }

  private getClientIp(req): string {
    const forwardedFor = req.headers?.['x-forwarded-for'];
    if (typeof forwardedFor === 'string') {
      return forwardedFor.split(',')[0].trim();
    }
    if (Array.isArray(forwardedFor) && forwardedFor[0]) {
      return forwardedFor[0].split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || 'unknown';
  }

  private extractBearerToken(authorization?: string): string {
    const [type, token] = authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : '';
  }
}
