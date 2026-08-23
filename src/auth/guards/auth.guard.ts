import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { createHash } from 'crypto';
import { CacheService } from 'src/cache/cache.service';
import { TypedConfigService } from 'src/common/config/typed-config.service';

/**
 * Standalone AuthGuard used by routes that don't go through Passport
 * (e.g. wallet routes).
 *
 * This guard verifies JWT signature, issuer, audience, and checks the
 * revocation cache to reject tokens that have been force-expired or
 * logged out.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private readonly revokedTokenPrefix = 'auth:jwt:revoked:';

  constructor(
    private jwtService: JwtService,
    private readonly cacheService: CacheService,
    private readonly configService: TypedConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Access token not found');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.jwtSecret,
        issuer: this.configService.jwtIssuer,
        audience: this.configService.jwtAudience,
      });

      // Check revocation cache
      const revoked = await this.cacheService.get<boolean>(
        this.buildRevokedTokenKey(payload, token),
      );
      if (revoked) {
        throw new UnauthorizedException('Token has been revoked');
      }

      request.user = payload;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.debug(`JWT verification failed: ${error.message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  private buildRevokedTokenKey(
    payload: { jti?: string } | null,
    token: string,
  ): string {
    const tokenId =
      payload?.jti || createHash('sha256').update(token).digest('hex');

    return `${this.revokedTokenPrefix}${tokenId}`;
  }
}
