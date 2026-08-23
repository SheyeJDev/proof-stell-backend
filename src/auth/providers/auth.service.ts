import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  Inject,
  forwardRef,
  Logger,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { plainToClass } from 'class-transformer';
import { ReadUserDto } from 'src/users/dto/read-user.dto';
import { UserService } from 'src/users/providers/users.service';
import { RegisterDto } from '../dto/register.dto';
import { HashingService } from './hashing.service';
import { v4 as uuidv4 } from 'uuid';
import { MailService } from 'src/mail/mail.service';
import { addHours } from 'date-fns';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { AnalyticsEvent } from 'src/analytics/analytics-event.enum';
import { CacheService } from 'src/cache/cache.service';
import { TypedConfigService } from 'src/common/config/typed-config.service';
import { createHash } from 'crypto';
import { AuthTokenService } from './auth-token.service';

interface LoginContext {
  ip?: string;
  userAgent?: string;
}

/**
 * Metadata for account lockout state.
 */
interface LockoutMetadata {
  lockedUntil: number;
  attempts: number;
}

/**
 * Service for managing user authentication and authorization.
 *
 * This service handles user registration, login, logout, email verification,
 * and account security features including login attempt tracking and account lockout.
 * It integrates with JWT for token-based authentication and bcrypt for password hashing.
 *
 * @example
 * ```typescript
 * const authService = new AuthService(
 *   userService,
 *   authTokenService,
 *   hashingService,
 *   mailService,
 *   cacheService,
 *   configService,
 *   analyticsService
 * );
 * const { access_token, user } = await authService.login(validatedUser);
 * ```
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Creates a new AuthService instance.
   *
   * @param userService - Service for user data operations
   * @param authTokenService - Service for JWT token management
   * @param hashingService - Service for password hashing
   * @param mailService - Service for sending emails
   * @param cacheService - Service for caching operations
   * @param configService - Service for configuration values
   * @param analyticsService - Service for analytics tracking
   */
  constructor(
    private userService: UserService,
    private readonly authTokenService: AuthTokenService,
    private readonly hashingService: HashingService,
    private readonly mailService: MailService,
    private readonly cacheService: CacheService,
    private readonly configService: TypedConfigService,
    @Inject(forwardRef(() => AnalyticsService))
    private readonly analyticsService: AnalyticsService,
  ) {}

  /**
   * Validates user credentials for authentication.
   *
   * This method checks the user's email and password, verifies account status,
   * and enforces account lockout policies for failed login attempts. It tracks
   * failed attempts by email, IP address, and user agent to prevent brute force attacks.
   *
   * @param email - The user's email address
   * @param password - The user's plain-text password
   * @param clientIp - The client's IP address for lockout tracking
   * @param userAgent - The client's user agent for device tracking
   * @returns Promise containing the validated user object
   * @throws {UnauthorizedException} If credentials are invalid, account is inactive,
   *         email is not verified, or account is locked
   *
   * @example
   * ```typescript
   * const user = await authService.validateUser(
   *   'user@example.com',
   *   'password123',
   *   '192.168.1.1',
   *   'Mozilla/5.0...'
   * );
   * ```
   */
  async validateUser(
    email: string,
    password: string,
    clientIp?: string,
    userAgent?: string,
  ): Promise<any> {
    const context = this.buildLoginContext(clientIp, userAgent);
    const normalizedEmail = this.normalizeEmail(email);
    const lockoutKeys = this.buildLockoutKeys(
      normalizedEmail,
      context.ip,
      context.userAgent,
    );

    // Check if account is locked
    await this.checkAccountLockout(normalizedEmail, lockoutKeys, context);

    const user = await this.userService.findByEmail(normalizedEmail);
    if (!user) {
      await this.recordFailedAttempt(normalizedEmail, lockoutKeys, context);
      this.logger.warn(
        `Failed login attempt for non-existent user: ${normalizedEmail} from IP: ${context.ip}`,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.isActive === false) {
      this.logger.warn(`Login attempt for inactive user: ${normalizedEmail}`);
      throw new UnauthorizedException('Account is deactivated');
    }

    if (!user.isEmailVerified) {
      throw new UnauthorizedException('Please verify your email to log in');
    }

    const isMatch = await this.hashingService.comparePassword(
      password,
      user.password,
    );
    if (!isMatch) {
      await this.recordFailedAttempt(normalizedEmail, lockoutKeys, context);
      this.logger.warn(
        `Failed login attempt for user: ${normalizedEmail} from IP: ${context.ip}`,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    // Clear failed attempts on successful login
    await this.clearFailedAttempts(normalizedEmail, lockoutKeys, context);
    this.logger.log(`Successful login for user: ${normalizedEmail}`);

    return user;
  }

  /**
   * Authenticates a user and generates an access + refresh token pair.
   *
   * This method updates the user's last login timestamp, tracks the login event
   * in analytics, and generates a JWT access token and a rotating refresh token.
   *
   * @param user - The validated user object
   * @param context - Optional login context (IP, user agent)
   * @returns Object containing the access token, refresh token, and user data
   *
   * @example
   * ```typescript
   * const { access_token, refresh_token, user } = await authService.login(validatedUser, {
   *   ip: '192.168.1.1',
   *   userAgent: 'Mozilla/5.0...'
   * });
   * ```
   */
  async login(user: any, context?: LoginContext) {
    // Update last login
    await this.userService.updateLastLogin(user.id);

    // Track login event
    if (this.analyticsService) {
      await this.analyticsService.track(AnalyticsEvent.UserLoggedIn, {
        userId: user.id,
      });
    }

    const access_token = this.authTokenService.signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    // Generate rotating refresh token
    const { refreshToken: refresh_token } =
      await this.authTokenService.generateRefreshToken({
        id: user.id,
        email: user.email,
      });

    return {
      access_token,
      refresh_token,
      user: plainToClass(ReadUserDto, user, {
        excludeExtraneousValues: true,
      }),
    };
  }

  /**
   * Rotate a refresh token pair: revoke the old refresh token, issue new
   * access + refresh tokens.
   *
   * @param refreshToken - The current refresh token
   * @returns New token pair
   * @throws {UnauthorizedException} If the token is invalid or reuse is detected
   */
  async refreshTokens(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
  }> {
    // Decode the original refresh token to get the userId,
    // then fetch the user and sign a proper access token.
    const decoded = this.authTokenService.decodeRefreshToken(refreshToken);

    if (!decoded?.sub) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // rotateRefreshToken validates, rotates, and issues new tokens
    const {
      accessToken,
      refreshToken: newRefreshToken,
      family,
    } = await this.authTokenService.rotateRefreshToken(refreshToken);

    const user = await this.userService.findOne(decoded.sub);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const access_token = this.authTokenService.signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      access_token,
      refresh_token: newRefreshToken,
    };
  }

  /**
   * Logs out a user by revoking their access token and, optionally, their
   * refresh token family.
   *
   * @param accessToken - The JWT access token to revoke
   * @param refreshToken - Optional refresh token to revoke its family
   *
   * @example
   * ```typescript
   * await authService.logout(accessToken);
   * ```
   */
  async logout(accessToken: string, refreshToken?: string): Promise<void> {
    await this.authTokenService.revokeAccessToken(accessToken);

    // If a refresh token is provided, revoke its entire family
    if (refreshToken) {
      try {
        const decoded = this.authTokenService.decodeRefreshToken(refreshToken);
        if (decoded?.sub) {
          await this.authTokenService.revokeAllUserRefreshTokens(decoded.sub);
        }
      } catch {
        // Best-effort: don't fail the logout if refresh revocation fails
        this.logger.warn('Failed to revoke refresh tokens during logout');
      }
    }
  }

  /**
   * Force-expire ALL sessions for a user: revoke every access token jti in
   * the cache and invalidate all refresh token families.
   *
   * @param userId - The user whose sessions should be revoked
   */
  async forceExpireAllSessions(userId: string): Promise<void> {
    // Revoke all refresh token families
    await this.authTokenService.revokeAllUserRefreshTokens(userId);

    this.logger.log(`Force-expired all sessions for user ${userId}`);
  }

  /**
   * Registers a new user account.
   *
   * This method creates a new user with the provided credentials, generates
   * an email verification token, and sends a verification email to the user.
   * The account is created in an unverified state and cannot be used until
   * the email is verified.
   *
   * @param registerDto - The registration data containing email, username, and password
   * @returns Promise containing the access token (empty until verified) and user data
   * @throws {ConflictException} If email or username already exists
   * @throws {Error} If registration fails for other reasons
   *
   * @example
   * ```typescript
   * const { user } = await authService.register({
   *   email: 'user@example.com',
   *   username: 'player1',
   *   password: 'SecurePass123'
   * });
   * ```
   */
  async register(
    registerDto: RegisterDto,
  ): Promise<{ access_token: string; user: ReadUserDto }> {
    try {
      const emailVerificationToken = uuidv4();
      const emailVerificationExpires = addHours(new Date(), 24);
      const user = await this.userService.create({
        ...registerDto,
        isEmailVerified: false,
        emailVerificationToken,
        emailVerificationExpires,
        role: undefined,
      });
      const fullUser = await this.userService.findByEmail(user.email);
      const verificationUrl = `https://yourapp.com/verify-email?token=${emailVerificationToken}`;
      await this.mailService.sendVerificationEmail(
        fullUser.email,
        fullUser.username,
        verificationUrl,
      );
      // Track registration event
      if (this.analyticsService) {
        await this.analyticsService.track(AnalyticsEvent.UserRegistered, {
          userId: fullUser.id,
        });
      }
      return {
        access_token: '',
        user: fullUser,
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new Error('Registration failed');
    }
  }

  /**
   * Verifies a user's email address using a verification token.
   *
   * This method validates the email verification token, checks if it has expired,
   * and marks the user's email as verified if the token is valid.
   *
   * @param token - The email verification token sent to the user
   * @returns Promise containing true if verification was successful
   * @throws {UnauthorizedException} If token is invalid or expired
   * @throws {ConflictException} If email is already verified
   *
   * @example
   * ```typescript
   * const verified = await authService.verifyEmail('uuid-token-here');
   * ```
   */
  async verifyEmail(token: string): Promise<boolean> {
    const user = await this.userService.findByVerificationToken(token);
    if (!user)
      throw new UnauthorizedException('Invalid or expired verification token');
    if (user.isEmailVerified)
      throw new ConflictException('Email already verified');
    if (
      !user.emailVerificationExpires ||
      user.emailVerificationExpires < new Date()
    ) {
      throw new UnauthorizedException('Verification token expired');
    }
    await this.userService.update(user.id, {
      isEmailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null,
    });
    return true;
  }

  /**
   * Resends the email verification token to a user.
   *
   * This method generates a new verification token for an unverified user
   * and sends it via email. Useful if the previous token expired or was lost.
   *
   * @param email - The user's email address
   * @returns Promise containing true if the email was sent successfully
   * @throws {UnauthorizedException} If user is not found
   * @throws {ConflictException} If email is already verified
   *
   * @example
   * ```typescript
   * await authService.resendVerificationEmail('user@example.com');
   * ```
   */
  async resendVerificationEmail(email: string): Promise<any> {
    const user = await this.userService.findByEmail(email);
    if (!user) throw new UnauthorizedException('User not found');
    if (user.isEmailVerified)
      throw new ConflictException('Email already verified');
    const emailVerificationToken = uuidv4();
    const emailVerificationExpires = addHours(new Date(), 24);
    await this.userService.update(user.id, {
      emailVerificationToken,
      emailVerificationExpires,
    });
    const verificationUrl = `https://yourapp.com/verify-email?token=${emailVerificationToken}`;
    await this.mailService.sendVerificationEmail(
      user.email,
      user.username,
      verificationUrl,
    );
    return true;
  }

  private async checkAccountLockout(
    email: string,
    keys: { attemptsKey: string; lockoutKey: string },
    context: Required<LoginContext>,
  ): Promise<void> {
    const lockout = await this.cacheService.get<LockoutMetadata>(
      keys.lockoutKey,
    );

    if (lockout?.lockedUntil && lockout.lockedUntil > Date.now()) {
      const remainingSeconds = Math.ceil(
        (lockout.lockedUntil - Date.now()) / 1000,
      );
      this.logger.warn(
        `Lockout bypass attempt for user: ${email} from IP: ${context.ip}. Remaining: ${remainingSeconds} seconds`,
      );
      throw new HttpException(
        `Account temporarily locked due to too many failed login attempts. Try again in ${Math.ceil(
          remainingSeconds / 60,
        )} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (lockout) {
      await this.cacheService.del(keys.lockoutKey);
      await this.cacheService.del(keys.attemptsKey);
      this.logger.log(
        `Lockout expiration for user: ${email} from IP: ${context.ip}`,
      );
    }
  }

  private async recordFailedAttempt(
    email: string,
    keys: { attemptsKey: string; lockoutKey: string },
    context: Required<LoginContext>,
  ): Promise<void> {
    const attempts = await this.cacheService.increment(
      keys.attemptsKey,
      this.configService.authAttemptWindowSeconds,
    );

    this.logger.warn(
      `Failed login attempt recorded for user: ${email} from IP: ${context.ip}. Attempts: ${attempts}`,
    );

    if (attempts >= this.configService.authMaxFailedAttempts) {
      const lockout: LockoutMetadata = {
        attempts,
        lockedUntil:
          Date.now() + this.configService.authLockoutDurationSeconds * 1000,
      };

      await this.cacheService.set(
        keys.lockoutKey,
        lockout,
        this.getLockoutMetadataTtlSeconds(),
      );
      this.logger.warn(
        `Lockout triggered for user: ${email} from IP: ${context.ip} after ${attempts} failed attempts`,
      );
    }
  }

  private async clearFailedAttempts(
    email: string,
    keys: { attemptsKey: string; lockoutKey: string },
    context: Required<LoginContext>,
  ): Promise<void> {
    await Promise.all([
      this.cacheService.del(keys.attemptsKey),
      this.cacheService.del(keys.lockoutKey),
    ]);
    this.logger.log(
      `Successful reset of failed login attempts for user: ${email} from IP: ${context.ip}`,
    );
  }

  /**
   * Gets the remaining lockout time for a user's account.
   *
   * This method checks if an account is currently locked due to too many
   * failed login attempts and returns the remaining time in seconds.
   *
   * @param email - The user's email address
   * @param clientIp - The client's IP address for lockout lookup
   * @param userAgent - The client's user agent for device-specific lookup
   * @returns Promise containing the remaining lockout time in seconds (0 if not locked)
   *
   * @example
   * ```typescript
   * const remainingSeconds = await authService.getRemainingLockoutTime(
   *   'user@example.com',
   *   '192.168.1.1'
   * );
   * if (remainingSeconds > 0) {
   *   console.log(`Account locked for ${remainingSeconds} seconds`);
   * }
   * ```
   */
  async getRemainingLockoutTime(
    email: string,
    clientIp?: string,
    userAgent?: string,
  ): Promise<number> {
    const context = this.buildLoginContext(clientIp, userAgent);
    const keys = this.buildLockoutKeys(
      this.normalizeEmail(email),
      context.ip,
      context.userAgent,
    );
    const lockout = await this.cacheService.get<LockoutMetadata>(
      keys.lockoutKey,
    );
    if (lockout?.lockedUntil && lockout.lockedUntil > Date.now()) {
      return Math.ceil((lockout.lockedUntil - Date.now()) / 1000);
    }
    if (lockout) {
      await this.cacheService.del(keys.lockoutKey);
      await this.cacheService.del(keys.attemptsKey);
      this.logger.log(
        `Lockout expiration for user: ${this.normalizeEmail(email)} from IP: ${
          context.ip
        }`,
      );
    }
    return 0;
  }

  /**
   * Manually unlocks a user's account (admin function).
   *
   * This method clears failed login attempts and removes account lockout
   * for a specific user. This is typically used by administrators to unlock
   * accounts that were locked due to suspicious activity.
   *
   * @param email - The user's email address
   * @param clientIp - The IP address to clear lockout for
   * @param userAgent - The user agent to clear lockout for
   *
   * @example
   * ```typescript
   * await authService.unlockAccount('user@example.com');
   * ```
   */
  async unlockAccount(
    email: string,
    clientIp?: string,
    userAgent?: string,
  ): Promise<void> {
    const context = this.buildLoginContext(clientIp, userAgent);
    const normalizedEmail = this.normalizeEmail(email);
    const keys = this.buildLockoutKeys(
      normalizedEmail,
      context.ip,
      context.userAgent,
    );
    await this.clearFailedAttempts(normalizedEmail, keys, context);
    this.logger.log(`Account manually unlocked for user: ${normalizedEmail}`);
  }

  private normalizeEmail(email: string): string {
    return email.toLowerCase().trim();
  }

  private buildLoginContext(
    ip?: string,
    userAgent?: string,
  ): Required<LoginContext> {
    return {
      ip: (ip || 'unknown').trim() || 'unknown',
      userAgent: (userAgent || 'unknown').trim() || 'unknown',
    };
  }

  private buildLockoutKeys(email: string, ip: string, userAgent?: string) {
    const deviceHash = this.hashDeviceMetadata(userAgent);
    return {
      attemptsKey: `auth:attempts:${email}:${ip}:${deviceHash}`,
      lockoutKey: `auth:lockout:${email}:${ip}:${deviceHash}`,
    };
  }

  private hashDeviceMetadata(userAgent?: string): string {
    return createHash('sha256')
      .update((userAgent || 'unknown').trim().toLowerCase())
      .digest('hex')
      .slice(0, 16);
  }

  private getLockoutMetadataTtlSeconds(): number {
    return (
      this.configService.authLockoutDurationSeconds +
      this.configService.authAttemptWindowSeconds
    );
  }
}
