import { Test, type TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UserService } from 'src/users/providers/users.service';
import { Role } from 'src/common/enums/role.enum';
import { MailService } from 'src/mail/mail.service';
import { HashingService } from './hashing.service';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { AuthTokenService } from './auth-token.service';
import { CacheService } from 'src/cache/cache.service';
import { TypedConfigService } from 'src/common/config/typed-config.service';
import { validationSchema } from 'src/common/config/validation';

describe('AuthService', () => {
  let service: AuthService;
  let userService: UserService;
  let cacheStore: Map<string, { value: unknown; expiresAt?: number }>;

  const mockUserService = {
    validateUser: jest.fn(),
    create: jest.fn(),
    findByEmail: jest.fn(),
    updateLastLogin: jest.fn(),
    findByVerificationToken: jest.fn(),
    update: jest.fn(),
    findOne: jest.fn(),
  };

  const mockAuthTokenService = {
    signAccessToken: jest.fn(),
    revokeAccessToken: jest.fn(),
    generateRefreshToken: jest.fn(),
    revokeAllUserRefreshTokens: jest.fn(),
    rotateRefreshToken: jest.fn(),
    decodeRefreshToken: jest.fn(),
  };

  const mockMailService = {
    sendVerificationEmail: jest.fn(),
  };

  const mockHashingService = {
    hashPassword: jest.fn(),
    comparePassword: jest.fn(),
  };

  const mockAnalyticsService = {
    track: jest.fn(),
  };

  const mockConfigService = {
    get authMaxFailedAttempts() {
      return 5;
    },
    get authLockoutDurationSeconds() {
      return 900;
    },
    get authAttemptWindowSeconds() {
      return 900;
    },
  };

  const createCacheServiceMock = () => ({
    get: jest.fn(async (key: string) => {
      const entry = cacheStore.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt && entry.expiresAt <= Date.now()) {
        cacheStore.delete(key);
        return undefined;
      }
      return entry.value;
    }),
    set: jest.fn(async (key: string, value: unknown, ttl?: number) => {
      cacheStore.set(key, {
        value,
        expiresAt: ttl ? Date.now() + ttl * 1000 : undefined,
      });
    }),
    del: jest.fn(async (key: string) => {
      cacheStore.delete(key);
    }),
    increment: jest.fn(async (key: string, ttl?: number) => {
      const entry = cacheStore.get(key);
      const current =
        entry && (!entry.expiresAt || entry.expiresAt > Date.now())
          ? Number(entry.value)
          : 0;
      const next = current + 1;
      cacheStore.set(key, {
        value: next,
        expiresAt:
          entry?.expiresAt && entry.expiresAt > Date.now()
            ? entry.expiresAt
            : ttl
              ? Date.now() + ttl * 1000
              : undefined,
      });
      return next;
    }),
  });

  beforeEach(async () => {
    cacheStore = new Map();
    const cacheServiceMock = createCacheServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UserService,
          useValue: mockUserService,
        },
        {
          provide: JwtService,
          useValue: {},
        },
        {
          provide: AuthTokenService,
          useValue: mockAuthTokenService,
        },
        {
          provide: MailService,
          useValue: mockMailService,
        },
        {
          provide: HashingService,
          useValue: mockHashingService,
        },
        {
          provide: AnalyticsService,
          useValue: mockAnalyticsService,
        },
        {
          provide: CacheService,
          useValue: cacheServiceMock,
        },
        {
          provide: TypedConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userService = module.get<UserService>(UserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('should send verification email and not log in user immediately', async () => {
      const registerDto = {
        email: 'test@example.com',
        username: 'testuser',
        password: 'TestPass123!',
      };
      const user = { ...registerDto, id: '123', isEmailVerified: false };
      mockUserService.create.mockResolvedValue(user);
      mockUserService.findByEmail.mockResolvedValue(user);
      mockMailService.sendVerificationEmail.mockResolvedValue(undefined);
      const result = await service.register(registerDto);
      expect(result.user).toBeDefined();
      expect(result.access_token).toBe('');
      expect(mockUserService.create).toHaveBeenCalledWith(
        expect.objectContaining({ password: registerDto.password }),
      );
      expect(mockHashingService.hashPassword).not.toHaveBeenCalled();
      expect(mockMailService.sendVerificationEmail).toHaveBeenCalled();
    });
  });

  describe('validateUser', () => {
    it('should throw if user is not verified', async () => {
      const email = 'test@example.com';
      const password = 'password123';
      const user = {
        id: '123',
        email,
        password: 'hashed',
        isActive: true,
        isEmailVerified: false,
      };
      mockUserService.findByEmail.mockResolvedValue(user);
      await expect(service.validateUser(email, password)).rejects.toThrow(
        'Please verify your email to log in',
      );
    });
  });

  describe('verifyEmail', () => {
    it('should verify user if token is valid and not expired', async () => {
      const token = 'valid-token';
      const user = {
        id: '123',
        email: 'test@example.com',
        isEmailVerified: false,
        emailVerificationExpires: new Date(Date.now() + 10000),
      };
      mockUserService.findByVerificationToken = jest
        .fn()
        .mockResolvedValue(user);
      mockUserService.update = jest
        .fn()
        .mockResolvedValue({ ...user, isEmailVerified: true });
      const result = await service.verifyEmail(token);
      expect(result).toBe(true);
      expect(mockUserService.update).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({ isEmailVerified: true }),
      );
    });
    it('should throw if token is invalid', async () => {
      mockUserService.findByVerificationToken = jest
        .fn()
        .mockResolvedValue(null);
      await expect(service.verifyEmail('bad-token')).rejects.toThrow(
        'Invalid or expired verification token',
      );
    });
    it('should throw if already verified', async () => {
      const user = { id: '123', isEmailVerified: true };
      mockUserService.findByVerificationToken = jest
        .fn()
        .mockResolvedValue(user);
      await expect(service.verifyEmail('token')).rejects.toThrow(
        'Email already verified',
      );
    });
    it('should throw if token expired', async () => {
      const user = {
        id: '123',
        isEmailVerified: false,
        emailVerificationExpires: new Date(Date.now() - 10000),
      };
      mockUserService.findByVerificationToken = jest
        .fn()
        .mockResolvedValue(user);
      await expect(service.verifyEmail('token')).rejects.toThrow(
        'Verification token expired',
      );
    });
  });

  describe('validateUser', () => {
    it('should return user data without password when credentials are valid', async () => {
      const email = 'test@example.com';
      const password = 'password123';
      const mockUser = {
        id: '123',
        email,
        username: 'testuser',
        role: Role.PLAYER,
        password: 'hashedPassword',
        isActive: true,
        isEmailVerified: true,
      };

      mockUserService.validateUser.mockResolvedValue(mockUser);
      mockUserService.findByEmail.mockResolvedValue(mockUser);
      mockHashingService.comparePassword.mockResolvedValue(true);

      const result = await service.validateUser(email, password);

      expect(result).toBeDefined();
      expect(result.email).toBe(email);
    });

    it('should return null when credentials are invalid', async () => {
      const email = 'test@example.com';
      const password = 'wrongpassword';

      mockUserService.validateUser.mockResolvedValue(null);
      mockUserService.findByEmail.mockResolvedValue({
        id: '123',
        email,
        username: 'testuser',
        role: Role.PLAYER,
        password: 'hashedPassword',
        isActive: true,
        isEmailVerified: true,
      });
      mockHashingService.comparePassword.mockResolvedValue(false);

      await expect(service.validateUser(email, password)).rejects.toThrow(
        'Invalid credentials',
      );
    });
  });

  describe('login', () => {
    it('should return access token, refresh token, and user data', async () => {
      const mockUser = {
        id: '123',
        email: 'test@example.com',
        username: 'testuser',
        role: Role.PLAYER,
      };

      const mockToken = 'jwt.token.here';
      const mockRefreshToken = 'refresh.jwt.token.here';
      mockAuthTokenService.signAccessToken.mockReturnValue(mockToken);
      mockAuthTokenService.generateRefreshToken.mockResolvedValue({
        refreshToken: mockRefreshToken,
        family: 'test-family',
        jti: 'test-jti',
      });
      mockUserService.updateLastLogin.mockResolvedValue(undefined);

      const result = await service.login(mockUser);

      expect(result).toBeDefined();
      expect(result.access_token).toBe(mockToken);
      expect(result.refresh_token).toBe(mockRefreshToken);
      expect(result.user).toBeDefined();
      expect(mockUserService.updateLastLogin).toHaveBeenCalledWith(mockUser.id);
      expect(mockAuthTokenService.signAccessToken).toHaveBeenCalledWith({
        id: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
      });
      expect(mockAuthTokenService.generateRefreshToken).toHaveBeenCalledWith({
        id: mockUser.id,
        email: mockUser.email,
      });
    });

    it('should revoke the current access token on logout', async () => {
      await service.logout('jwt.token.here');

      expect(mockAuthTokenService.revokeAccessToken).toHaveBeenCalledWith(
        'jwt.token.here',
      );
    });

    it('should revoke refresh token family when refresh token is provided on logout', async () => {
      // Mock decodeRefreshToken on the authTokenService mock
      mockAuthTokenService.decodeRefreshToken = jest.fn().mockReturnValue({
        sub: 'user-123',
        family: 'family-abc',
      });

      await service.logout('jwt.token.here', 'refresh.jwt.token.here');

      expect(mockAuthTokenService.revokeAccessToken).toHaveBeenCalledWith(
        'jwt.token.here',
      );
      expect(
        mockAuthTokenService.revokeAllUserRefreshTokens,
      ).toHaveBeenCalledWith('user-123');
    });
  });

  describe('forceExpireAllSessions', () => {
    it('should revoke all refresh token families for a user', async () => {
      await service.forceExpireAllSessions('user-123');

      expect(
        mockAuthTokenService.revokeAllUserRefreshTokens,
      ).toHaveBeenCalledWith('user-123');
    });
  });

  describe('resendVerificationEmail', () => {
    it('should send verification email if user is not verified', async () => {
      const email = 'test@example.com';
      const user = {
        id: '123',
        email,
        username: 'testuser',
        isEmailVerified: false,
      };
      mockUserService.findByEmail.mockResolvedValue(user);
      mockUserService.update.mockResolvedValue(user);
      mockMailService.sendVerificationEmail.mockResolvedValue(undefined);
      const result = await service.resendVerificationEmail(email);
      expect(result).toBe(true);
      expect(mockMailService.sendVerificationEmail).toHaveBeenCalled();
    });
    it('should throw if user not found', async () => {
      mockUserService.findByEmail.mockResolvedValue(null);
      await expect(
        service.resendVerificationEmail('notfound@example.com'),
      ).rejects.toThrow('User not found');
    });
    it('should throw if already verified', async () => {
      const user = {
        id: '123',
        email: 'test@example.com',
        isEmailVerified: true,
      };
      mockUserService.findByEmail.mockResolvedValue(user);
      await expect(service.resendVerificationEmail(user.email)).rejects.toThrow(
        'Email already verified',
      );
    });
  });

  describe('Security Features', () => {
    describe('Account Lockout', () => {
      const ip = '203.0.113.10';
      const userAgent = 'Jest Browser';

      beforeEach(async () => {
        // Reset any existing lockout state
        await service.unlockAccount('test@example.com', ip, userAgent);
      });

      it('should lock account after 5 failed attempts', async () => {
        const email = 'test@example.com';
        mockUserService.findByEmail.mockResolvedValue(null);

        // Attempt 5 failed logins
        for (let i = 0; i < 5; i++) {
          try {
            await service.validateUser(email, 'wrong-password', ip, userAgent);
          } catch (error) {
            expect(error.message).toBe('Invalid credentials');
          }
        }

        // 6th attempt should throw TooManyRequestsException
        await expect(
          service.validateUser(email, 'wrong-password', ip, userAgent),
        ).rejects.toThrow('Account temporarily locked');
      });

      it('should increment failed attempts in shared cache', async () => {
        const email = 'test@example.com';
        mockUserService.findByEmail.mockResolvedValue(null);

        await expect(
          service.validateUser(email, 'wrong-password', ip, userAgent),
        ).rejects.toThrow('Invalid credentials');

        expect(
          Array.from(cacheStore.entries()).some(
            ([key, entry]) =>
              key.startsWith('auth:attempts:test@example.com:203.0.113.10:') &&
              entry.value === 1,
          ),
        ).toBe(true);
      });

      it('should clear failed attempts on successful login', async () => {
        const email = 'test@example.com';
        const user = {
          id: '123',
          email,
          password: 'hashed',
          isEmailVerified: true,
          isActive: true,
        };

        // First, make 3 failed attempts
        mockUserService.findByEmail.mockResolvedValue(null);
        for (let i = 0; i < 3; i++) {
          try {
            await service.validateUser(email, 'wrong-password', ip, userAgent);
          } catch (error) {
            // Expected to fail
          }
        }

        // Then successful login
        mockUserService.findByEmail.mockResolvedValue(user);
        mockHashingService.comparePassword.mockResolvedValue(true);

        const result = await service.validateUser(
          email,
          'correct-password',
          ip,
          userAgent,
        );
        expect(result).toEqual(user);

        // Verify failed attempts were cleared by checking lockout time
        await expect(
          service.getRemainingLockoutTime(email, ip, userAgent),
        ).resolves.toBe(0);
        expect(
          Array.from(cacheStore.keys()).some((key) =>
            key.startsWith('auth:attempts:test@example.com:203.0.113.10:'),
          ),
        ).toBe(false);
      });

      it('should return remaining lockout time', async () => {
        const email = 'locked@example.com';
        mockUserService.findByEmail.mockResolvedValue(null);

        // Lock the account
        for (let i = 0; i < 5; i++) {
          try {
            await service.validateUser(email, 'wrong-password', ip, userAgent);
          } catch (error) {
            // Expected to fail
          }
        }

        const remainingTime = await service.getRemainingLockoutTime(
          email,
          ip,
          userAgent,
        );
        expect(remainingTime).toBeGreaterThan(0);
        expect(remainingTime).toBeLessThanOrEqual(900);
      });

      it('should allow manual account unlock', async () => {
        const email = 'locked@example.com';
        mockUserService.findByEmail.mockResolvedValue(null);

        // Lock the account
        for (let i = 0; i < 5; i++) {
          try {
            await service.validateUser(email, 'wrong-password', ip, userAgent);
          } catch (error) {
            // Expected to fail
          }
        }

        // Verify account is locked
        await expect(
          service.validateUser(email, 'password', ip, userAgent),
        ).rejects.toThrow('Account temporarily locked');

        // Unlock account manually
        await service.unlockAccount(email, ip, userAgent);

        // Verify lockout time is cleared
        await expect(
          service.getRemainingLockoutTime(email, ip, userAgent),
        ).resolves.toBe(0);
      });

      it('should expire lockout state after configured duration', async () => {
        jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
        const email = 'expired@example.com';
        mockUserService.findByEmail.mockResolvedValue(null);

        for (let i = 0; i < 5; i++) {
          await expect(
            service.validateUser(email, 'wrong-password', ip, userAgent),
          ).rejects.toThrow('Invalid credentials');
        }

        jest.advanceTimersByTime(901_000);

        await expect(
          service.getRemainingLockoutTime(email, ip, userAgent),
        ).resolves.toBe(0);

        jest.useRealTimers();
      });

      it('should share lockout state across service instances', async () => {
        const email = 'distributed@example.com';
        mockUserService.findByEmail.mockResolvedValue(null);

        for (let i = 0; i < 5; i++) {
          await expect(
            service.validateUser(email, 'wrong-password', ip, userAgent),
          ).rejects.toThrow('Invalid credentials');
        }

        const cacheServiceMock = createCacheServiceMock();
        const secondService = new AuthService(
          mockUserService as any,
          mockAuthTokenService as any,
          mockHashingService as any,
          mockMailService as any,
          cacheServiceMock as any,
          mockConfigService as any,
          mockAnalyticsService as any,
        );

        await expect(
          secondService.validateUser(email, 'wrong-password', ip, userAgent),
        ).rejects.toThrow('Account temporarily locked');
      });

      it('should isolate different IP and device combinations', async () => {
        const email = 'risk@example.com';
        mockUserService.findByEmail.mockResolvedValue(null);

        for (let i = 0; i < 5; i++) {
          await expect(
            service.validateUser(email, 'wrong-password', ip, userAgent),
          ).rejects.toThrow('Invalid credentials');
        }

        await expect(
          service.validateUser(
            email,
            'wrong-password',
            '198.51.100.77',
            userAgent,
          ),
        ).rejects.toThrow('Invalid credentials');

        await expect(
          service.validateUser(email, 'wrong-password', ip, 'Different Device'),
        ).rejects.toThrow('Invalid credentials');
      });

      it('should prevent lockout bypass attempts before credential validation', async () => {
        const email = 'bypass@example.com';
        mockUserService.findByEmail.mockResolvedValue(null);

        for (let i = 0; i < 5; i++) {
          await expect(
            service.validateUser(email, 'wrong-password', ip, userAgent),
          ).rejects.toThrow('Invalid credentials');
        }
        mockUserService.findByEmail.mockClear();

        await expect(
          service.validateUser(email, 'correct-password', ip, userAgent),
        ).rejects.toThrow('Account temporarily locked');
        expect(mockUserService.findByEmail).not.toHaveBeenCalled();
      });
    });

    describe('Configuration Validation', () => {
      it('should reject invalid auth lockout configuration values', () => {
        const { error } = validationSchema.validate({
          NODE_ENV: 'test',
          DATABASE_URL: 'postgres://localhost/test',
          JWT_SECRET: 'a'.repeat(32),
          AUTH_MAX_FAILED_ATTEMPTS: 0,
          AUTH_LOCKOUT_DURATION_SECONDS: -1,
          AUTH_ATTEMPT_WINDOW_SECONDS: 'abc',
          STARKNET_PRIVATE_KEY: 'private',
          STARKNET_ACCOUNT_ADDRESS: 'account',
          MINT_CONTRACT_ADDRESS: 'mint',
        });

        expect(error).toBeDefined();
      });

      it('should provide reasonable auth lockout defaults', () => {
        const { value, error } = validationSchema.validate({
          NODE_ENV: 'test',
          DATABASE_URL: 'postgres://localhost/test',
          JWT_SECRET: 'a'.repeat(32),
          STARKNET_PRIVATE_KEY: 'private',
          STARKNET_ACCOUNT_ADDRESS: 'account',
          MINT_CONTRACT_ADDRESS: 'mint',
        });

        expect(error).toBeUndefined();
        expect(value.AUTH_MAX_FAILED_ATTEMPTS).toBe(5);
        expect(value.AUTH_LOCKOUT_DURATION_SECONDS).toBe(900);
        expect(value.AUTH_ATTEMPT_WINDOW_SECONDS).toBe(900);
        expect(value.JWT_ISSUER).toBe('proof-stell-backend');
        expect(value.JWT_AUDIENCE).toBe('proof-stell-client');
        expect(value.JWT_ACCESS_TTL).toBe('15m');
        expect(value.JWT_REFRESH_TTL).toBe('7d');
      });
    });

    describe('Input Validation and Normalization', () => {
      it('should normalize email addresses', async () => {
        const email = 'TEST@EXAMPLE.COM';
        const user = {
          id: '123',
          email: 'test@example.com',
          password: 'hashed',
          isEmailVerified: true,
          isActive: true,
        };

        mockUserService.findByEmail.mockResolvedValue(user);
        mockHashingService.comparePassword.mockResolvedValue(true);

        const result = await service.validateUser(email, 'password');
        expect(result).toEqual(user);
        expect(mockUserService.findByEmail).toHaveBeenCalledWith(
          'test@example.com',
        );
      });

      it('should reject inactive users', async () => {
        const email = 'inactive@example.com';
        const user = {
          id: '123',
          email,
          password: 'hashed',
          isEmailVerified: true,
          isActive: false,
        };

        mockUserService.findByEmail.mockResolvedValue(user);

        await expect(service.validateUser(email, 'password')).rejects.toThrow(
          'Account is deactivated',
        );
      });

      it('should reject unverified users', async () => {
        const email = 'unverified@example.com';
        const user = {
          id: '123',
          email,
          password: 'hashed',
          isEmailVerified: false,
          isActive: true,
        };

        mockUserService.findByEmail.mockResolvedValue(user);

        await expect(service.validateUser(email, 'password')).rejects.toThrow(
          'Please verify your email to log in',
        );
      });
    });

    describe('Password Security', () => {
      it('should delegate registration password hashing to UserService', async () => {
        const registerDto = {
          email: 'test@example.com',
          username: 'testuser',
          password: 'SecurePass123!',
        };

        mockUserService.create.mockResolvedValue({
          id: '123',
          email: registerDto.email,
        });
        mockUserService.findByEmail.mockResolvedValue({
          id: '123',
          email: registerDto.email,
          username: registerDto.username,
        });

        await service.register(registerDto);

        expect(mockHashingService.hashPassword).not.toHaveBeenCalled();
        expect(mockUserService.create).toHaveBeenCalledWith(
          expect.objectContaining({ password: registerDto.password }),
        );
      });

      it('should use secure password comparison', async () => {
        const email = 'test@example.com';
        const password = 'test-password';
        const user = {
          id: '123',
          email,
          password: 'hashed-password',
          isEmailVerified: true,
          isActive: true,
        };

        mockUserService.findByEmail.mockResolvedValue(user);
        mockHashingService.comparePassword.mockResolvedValue(true);

        await service.validateUser(email, password);

        expect(mockHashingService.comparePassword).toHaveBeenCalledWith(
          password,
          user.password,
        );
      });
    });
  });
});
