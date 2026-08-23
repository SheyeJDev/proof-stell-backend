import { NestFactory } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { TypedConfigService } from './common/config/typed-config.service';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ThrottlerExceptionFilter } from './throttler-exception.filter';
import { SecurityHeadersMiddleware } from './security/middleware/security-headers.middleware';
import { join } from 'path';
import * as express from 'express';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import * as requestId from 'express-request-id';
import { LoggingInterceptor } from './logging/logging.interceptor';
import { LoggingService } from './logging/logging.service';
import { HealthService } from './health/health.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  app.use(requestId());

  const configService = app.get(TypedConfigService);
  const loggingInterceptor = app.get(LoggingInterceptor);

  // Enable CORS with environment-driven origins
  const allowedOrigins = configService.allowedOrigins
    ? configService.allowedOrigins
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : ['http://localhost:3000'];

  if (configService.corsEnabled) {
    app.enableCors({
      origin: allowedOrigins,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: true,
    });
  }

  // Apply security headers middleware globally
  const securityHeaders = new SecurityHeadersMiddleware();
  app.use(securityHeaders.use.bind(securityHeaders));

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Global exception filters
  app.useGlobalFilters(
    new HttpExceptionFilter(app.get(LoggingService)),
    new ThrottlerExceptionFilter(app.get(LoggingService)),
  );

  // Global logging interceptor
  app.useGlobalInterceptors(loggingInterceptor);

  // Swagger configuration - only in non-production environments
  if (configService.nodeEnv !== 'production') {
    // NEW
    const config = new DocumentBuilder()
      .setTitle('ProofStell API')
      .setDescription(
        'API documentation for the ProofStell backend: authentication, wallet lifecycle, game sessions, leaderboard, and audit logging.',
      )
      .setVersion('1.0')
      .addTag(
        'Authentication',
        'Login, registration, token refresh, and session revocation',
      )
      .addTag(
        'Wallet',
        'Wallet connection, message signing, and on-chain transaction relay',
      )
      .addTag(
        'Admin - Audit Logs',
        'Immutable audit trail for privileged admin actions',
      )
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'JWT-auth',
      )
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // Global prefix for all routes
  app.setGlobalPrefix('api/v1');

  // Serve normalized avatar files only from the public avatar directory
  // with safe content headers and cache policy.
  app.use('/avatars', (req, res, next) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    next();
  });
  app.use('/avatars', express.static(join(process.cwd(), 'public', 'avatars')));

  const healthService = app.get(HealthService);
  try {
    await healthService.assertStartupDependencies();
  } catch (error) {
    const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
    const reason = error instanceof Error ? error.message : 'unknown error';
    logger.error(`Startup dependency validation failed: ${reason}`);
    await app.close();
    throw error;
  }

  await app.listen(configService.port);
}
bootstrap();
