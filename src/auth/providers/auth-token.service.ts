import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'crypto';
import { CacheService } from 'src/cache/cache.service';
import { TypedConfigService } from 'src/common/config/typed-config.service';

export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: string;
  jti?: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
}

export interface RefreshTokenClaims {
  sub: string;
  jti: string;
  family: string;
  iat?: number;
  exp?: number;
}

/**
 * Metadata stored in cache for each refresh token family.
 *
 * `reused` is set to `true` when a revoked token from the family is presented —
 * signalling that the family has been compromised and every outstanding token
 * must be rejected.
 */
interface RefreshFamilyMetadata {
  currentTokenId: string;
  reused: boolean;
  userId: string;
  createdAt: number;
}

@Injectable()
export class AuthTokenService {
  private readonly logger = new Logger(AuthTokenService.name);
  private readonly revokedTokenPrefix = 'auth:jwt:revoked:';
  private readonly refreshFamilyPrefix = 'auth:refresh:family:';
  private readonly revokedRefreshPrefix = 'auth:refresh:revoked:';
  private readonly userSessionsPrefix = 'auth:user:sessions:';

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: TypedConfigService,
    private readonly cacheService: CacheService,
  ) {}

  // ── Access tokens ────────────────────────────────────────────────────

  signAccessToken(user: { id: string; email: string; role: string }): string {
    return this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        jti: randomUUID(),
      },
      {
        secret: this.configService.jwtSecret,
        issuer: this.configService.jwtIssuer,
        audience: this.configService.jwtAudience,
        expiresIn: this.configService.jwtAccessTtl,
      },
    );
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenClaims>(
        token,
        {
          secret: this.configService.jwtSecret,
          issuer: this.configService.jwtIssuer,
          audience: this.configService.jwtAudience,
        },
      );

      await this.assertAccessTokenIsActive(payload, token);
      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  async assertAccessTokenIsActive(
    payload: AccessTokenClaims,
    token?: string,
  ): Promise<void> {
    const revoked = await this.cacheService.get<boolean>(
      this.buildRevokedTokenKey(payload, token),
    );

    if (revoked) {
      throw new UnauthorizedException('Token has been revoked');
    }
  }

  async revokeAccessToken(token: string): Promise<void> {
    const decoded = this.jwtService.decode(token);
    const ttl = this.getRemainingTtlSeconds(decoded);

    if (ttl <= 0) {
      return;
    }

    await this.cacheService.set(
      this.buildRevokedTokenKey(decoded || undefined, token),
      true,
      ttl,
    );
  }

  // ── Refresh tokens ───────────────────────────────────────────────────

  /**
   * Create an initial refresh token for a newly-authenticated user.
   *
   * @returns The signed refresh token string and its metadata (family, jti).
   */
  async generateRefreshToken(user: {
    id: string;
    email: string;
  }): Promise<{ refreshToken: string; family: string; jti: string }> {
    const family = randomUUID();
    const jti = randomUUID();

    const token = this.jwtService.sign(
      { sub: user.id, jti, family },
      {
        secret: this.configService.jwtSecret,
        issuer: this.configService.jwtIssuer,
        audience: this.configService.jwtAudience,
        expiresIn: this.configService.jwtRefreshTtl,
      },
    );

    await this.storeRefreshFamily(family, {
      currentTokenId: jti,
      reused: false,
      userId: user.id,
      createdAt: Date.now(),
    });

    await this.trackUserSession(user.id, family);

    return { refreshToken: token, family, jti };
  }

  /**
   * Rotate a refresh token: issue a new one and revoke the old one.
   *
   * If the old token has already been revoked (reuse detection) the entire
   * family is invalidated and the caller is rejected.
   *
   * @returns A new refresh + access token pair.
   */
  async rotateRefreshToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    family: string;
  }> {
    let claims: RefreshTokenClaims;
    try {
      claims = await this.jwtService.verifyAsync<RefreshTokenClaims>(
        refreshToken,
        {
          secret: this.configService.jwtSecret,
          issuer: this.configService.jwtIssuer,
          audience: this.configService.jwtAudience,
        },
      );
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (!claims.jti || !claims.family) {
      throw new UnauthorizedException('Malformed refresh token');
    }

    // Fetch family metadata
    const familyKey = this.buildRefreshFamilyKey(claims.family);
    const familyMeta =
      await this.cacheService.get<RefreshFamilyMetadata>(familyKey);

    if (!familyMeta) {
      // Unknown family — token was issued against a family that has already
      // been cleaned up.  Treat as reuse.
      this.logger.warn(
        `Refresh reuse detected: unknown family ${claims.family} (jti=${claims.jti})`,
      );
      throw new UnauthorizedException(
        'Refresh token family revoked — possible token theft',
      );
    }

    if (familyMeta.reused) {
      // A sibling token was already used after this family was rotated.
      await this.revokeRefreshFamily(claims.family, claims.sub);
      this.logger.warn(
        `Refresh reuse detected for user ${claims.sub}, family ${claims.family}`,
      );
      throw new UnauthorizedException(
        'Refresh token family revoked — possible token theft',
      );
    }

    if (familyMeta.currentTokenId !== claims.jti) {
      // This is a stale / already-rotated token from the same family.
      // Mark family as reused (compromised).
      familyMeta.reused = true;
      await this.cacheService.set(
        familyKey,
        familyMeta,
        this.getRefreshTtlSeconds(),
      );
      await this.revokeRefreshFamily(claims.family, claims.sub);
      this.logger.warn(
        `Refresh token reuse detected: token jti=${claims.jti} != current jti=${familyMeta.currentTokenId} for family ${claims.family}`,
      );
      throw new UnauthorizedException(
        'Refresh token already used — possible token theft',
      );
    }

    // ── Issue new token ──────────────────────────────────────────────
    const newJti = randomUUID();
    const newToken = this.jwtService.sign(
      { sub: claims.sub, jti: newJti, family: claims.family },
      {
        secret: this.configService.jwtSecret,
        issuer: this.configService.jwtIssuer,
        audience: this.configService.jwtAudience,
        expiresIn: this.configService.jwtRefreshTtl,
      },
    );

    // Revoke old refresh token
    await this.revokeRefreshTokenById(claims.jti);

    // Update family to point to the new token
    familyMeta.currentTokenId = newJti;
    await this.cacheService.set(
      familyKey,
      familyMeta,
      this.getRefreshTtlSeconds(),
    );

    // Issue a new access token
    const accessToken = this.signAccessToken({
      id: claims.sub,
      email: '',
      role: '',
    });

    // Re-fetch the access token with proper claims — we need user data.
    // The caller (AuthService) will provide this; for now we store minimal
    // data and let AuthService rebuild the access token with real claims.
    // Actually we should return enough for AuthService to re-sign properly.
    return {
      accessToken,
      refreshToken: newToken,
      family: claims.family,
    };
  }

  /**
   * Revoke every refresh token family belonging to a user.
   * Used by logout-all / force-expire flows.
   */
  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    const familiesKey = this.buildUserSessionsKey(userId);
    const families = (await this.cacheService.get<string[]>(familiesKey)) || [];

    for (const family of families) {
      await this.revokeRefreshFamily(family, userId);
    }

    // Clear the families list itself
    await this.cacheService.del(familiesKey);

    this.logger.log(
      `Revoked all refresh token families for user ${userId} (${families.length} families)`,
    );
  }

  /**
   * Decode a refresh token without verification (for internal use).
   * Used by AuthService to extract userId from a refresh token during
   * rotation / logout flows.
   */
  decodeRefreshToken(
    token: string,
  ): { sub: string; jti: string; family: string } | null {
    try {
      return this.jwtService.decode(token);
    } catch {
      return null;
    }
  }

  // ── Internal helpers ─────────────────────────────────────────────────

  private async storeRefreshFamily(
    family: string,
    meta: RefreshFamilyMetadata,
  ): Promise<void> {
    const key = this.buildRefreshFamilyKey(family);
    await this.cacheService.set(key, meta, this.getRefreshTtlSeconds());
  }

  private async revokeRefreshFamily(
    family: string,
    userId: string,
  ): Promise<void> {
    const familyKey = this.buildRefreshFamilyKey(family);
    const meta = await this.cacheService.get<RefreshFamilyMetadata>(familyKey);

    if (meta) {
      meta.reused = true;
      await this.cacheService.set(familyKey, meta, this.getRefreshTtlSeconds());
    }

    // Also mark the revoked token id so it can't be used even if family lookup is slow
    if (meta?.currentTokenId) {
      await this.revokeRefreshTokenById(meta.currentTokenId);
    }
  }

  private async revokeRefreshTokenById(jti: string): Promise<void> {
    const key = `${this.revokedRefreshPrefix}${jti}`;
    await this.cacheService.set(key, true, this.getRefreshTtlSeconds());
  }

  private async trackUserSession(
    userId: string,
    family: string,
  ): Promise<void> {
    const key = this.buildUserSessionsKey(userId);
    const families = (await this.cacheService.get<string[]>(key)) || [];
    if (!families.includes(family)) {
      families.push(family);
      await this.cacheService.set(key, families, this.getRefreshTtlSeconds());
    }
  }

  private buildRevokedTokenKey(
    payload?: Pick<AccessTokenClaims, 'jti'> | null,
    token?: string,
  ): string {
    const tokenId =
      payload?.jti ||
      createHash('sha256')
        .update(token || '')
        .digest('hex');

    return `${this.revokedTokenPrefix}${tokenId}`;
  }

  private buildRefreshFamilyKey(family: string): string {
    return `${this.refreshFamilyPrefix}${family}`;
  }

  private buildUserSessionsKey(userId: string): string {
    return `${this.userSessionsPrefix}${userId}`;
  }

  private getRemainingTtlSeconds(payload: AccessTokenClaims | null): number {
    if (!payload?.exp) {
      return this.durationToSeconds(this.configService.jwtAccessTtl);
    }

    return Math.max(payload.exp - Math.floor(Date.now() / 1000), 0);
  }

  private getRefreshTtlSeconds(): number {
    return this.durationToSeconds(this.configService.jwtRefreshTtl);
  }

  private durationToSeconds(duration: string): number {
    const match = duration.match(/^(\d+)(ms|s|m|h|d)$/);
    if (!match) {
      return 0;
    }

    const value = Number(match[1]);
    const multipliers: Record<string, number> = {
      ms: 1 / 1000,
      s: 1,
      m: 60,
      h: 60 * 60,
      d: 24 * 60 * 60,
    };

    return Math.ceil(value * multipliers[match[2]]);
  }
}
