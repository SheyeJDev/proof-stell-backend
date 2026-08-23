import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { CreateUserDto } from '../dto/create-user.dto';
import { ReadUserDto } from '../dto/read-user.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { plainToInstance } from 'class-transformer';
import { InjectRepository } from '@nestjs/typeorm';
import { HashingService } from '../../auth/providers/hashing.service';

/**
 * Service for managing user data and operations.
 *
 * This service handles user CRUD operations, password changes, and user statistics.
 * It provides optimized queries to avoid loading unnecessary data and includes
 * conflict detection for email and username uniqueness.
 *
 * @example
 * ```typescript
 * const userService = new UserService(userRepository, hashingService);
 * const user = await userService.create({
 *   email: 'user@example.com',
 *   username: 'player1',
 *   password: 'SecurePass123'
 * });
 * ```
 */
@Injectable()
export class UserService {
  /**
   * Creates a new UserService instance.
   *
   * @param userRepository - TypeORM repository for User entity
   * @param hashingService - Service for password hashing operations
   */
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly hashingService: HashingService,
  ) {}

  /**
   * Helper utility method to fetch a complete user record for DTO mapping.
   *
   * This method queries only the fields needed for ReadUserDto to avoid
   * loading large JSON fields or unnecessary relations.
   *
   * @param id - The user ID to query
   * @returns Promise containing the user entity or null if not found
   * @private
   */
  private async findCompleteUserForDto(id: string): Promise<User | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.email',
        'user.username',
        'user.displayName',
        'user.firstName',
        'user.lastName',
        'user.isActive',
        'user.isEmailVerified',
        'user.gamesPlayed',
        'user.totalScore',
        'user.highestScore',
        'user.currentStreak',
        'user.longestStreak',
        'user.createdAt',
        'user.updatedAt',
      ])
      .where('user.id = :id', { id })
      .getOne();
  }

  /**
   * Creates a new user account.
   *
   * This method validates email and username uniqueness, hashes the password,
   * creates the user record, and returns the complete user data.
   *
   * @param createUserDto - The user creation data
   * @returns Promise containing the created user as ReadUserDto
   * @throws {ConflictException} If email or username already exists
   *
   * @example
   * ```typescript
   * const user = await userService.create({
   *   email: 'user@example.com',
   *   username: 'player1',
   *   password: 'SecurePass123',
   *   displayName: 'Player One'
   * });
   * ```
   */
  async create(createUserDto: CreateUserDto): Promise<ReadUserDto> {
    // Query only id/email/username to avoid loading the full user entity (large fields/relations)
    const existingUser = await this.userRepository
      .createQueryBuilder('user')
      .select(['user.id', 'user.email', 'user.username'])
      .where('user.email = :email', { email: createUserDto.email })
      .orWhere('user.username = :username', {
        username: createUserDto.username,
      })
      .getOne();

    if (existingUser) {
      if (existingUser.email === createUserDto.email) {
        throw new ConflictException('Email already exists');
      }
      if (existingUser.username === createUserDto.username) {
        throw new ConflictException('Username already exists');
      }
    }

    const hashedPassword = await this.hashingService.hashPassword(
      createUserDto.password,
    );
    const user = this.userRepository.create({
      ...createUserDto,
      password: hashedPassword,
    });
    const savedUser = await this.userRepository.save(user);

    // FIX: Instead of mapping the shallow entity returned by save(),
    // re-query the full record to guarantee all database defaults, hooks, and timestamps are populated.
    const completeUser = await this.findCompleteUserForDto(savedUser.id);
    if (!completeUser) {
      throw new NotFoundException(
        `User record assembly failed for ID ${savedUser.id}`,
      );
    }

    return plainToInstance(ReadUserDto, completeUser, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Retrieves all users with pagination.
   *
   * This method returns a paginated list of users with only summary fields
   * to avoid large payloads. Results are ordered by creation date descending.
   *
   * @param limit - Maximum number of users to return (default: 100)
   * @param offset - Number of users to skip (default: 0)
   * @returns Promise containing array of users as ReadUserDto
   *
   * @example
   * ```typescript
   * const users = await userService.findAll(50, 0);
   * ```
   */
  async findAll(limit = 100, offset = 0): Promise<ReadUserDto[]> {
    const users = await this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.email',
        'user.username',
        'user.displayName',
        'user.createdAt',
      ])
      .orderBy('user.createdAt', 'DESC')
      .limit(limit)
      .offset(offset)
      .getMany();

    return users.map((user) =>
      plainToInstance(ReadUserDto, user, {
        excludeExtraneousValues: true,
      }),
    );
  }

  /**
   * Retrieves a specific user by ID.
   *
   * This method returns complete user data including all statistics and
   * profile information for the specified user ID.
   *
   * @param id - The user ID to retrieve
   * @returns Promise containing the user as ReadUserDto
   * @throws {NotFoundException} If user with the specified ID does not exist
   *
   * @example
   * ```typescript
   * const user = await userService.findOne('user-id-here');
   * ```
   */
  async findOne(id: string): Promise<ReadUserDto> {
    // FIX: Optimized query selection path to pull complete fields needed for a standalone look
    const user = await this.findCompleteUserForDto(id);

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return plainToInstance(ReadUserDto, user, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Retrieves a user by email address.
   *
   * This method is optimized for authentication queries, selecting only
   * the fields required for login and password verification.
   *
   * @param email - The email address to search for
   * @returns Promise containing the user entity or null if not found
   *
   * @example
   * ```typescript
   * const user = await userService.findByEmail('user@example.com');
   * ```
   */
  async findByEmail(email: string): Promise<User | null> {
    // Only select fields required for authentication to avoid loading large JSON fields
    return this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.email',
        'user.password',
        'user.isActive',
        'user.isEmailVerified',
      ])
      .where('user.email = :email', { email })
      .getOne();
  }

  /**
   * Retrieves a user by username.
   *
   * This method is optimized for authentication queries, selecting only
   * the fields required for login and password verification.
   *
   * @param username - The username to search for
   * @returns Promise containing the user entity or null if not found
   *
   * @example
   * ```typescript
   * const user = await userService.findByUsername('player1');
   * ```
   */
  async findByUsername(username: string): Promise<User | null> {
    // Select only authentication/contact fields to keep this lookup light-weight
    return this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.username',
        'user.email',
        'user.password',
        'user.isActive',
        'user.isEmailVerified',
      ])
      .where('user.username = :username', { username })
      .getOne();
  }

  /**
   * Retrieves a user by email verification token.
   *
   * This method is used during email verification to find the user
   * associated with a verification token and check expiration.
   *
   * @param token - The email verification token
   * @returns Promise containing the user entity or null if not found
   *
   * @example
   * ```typescript
   * const user = await userService.findByVerificationToken('uuid-token-here');
   * ```
   */
  async findByVerificationToken(token: string): Promise<User | null> {
    // FIX: Added 'user.emailVerificationExpires' to the selection array.
    // This allows AuthService.verifyEmail() to perform accurate token expiration validation checks.
    return this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.email',
        'user.isEmailVerified',
        'user.emailVerificationToken',
        'user.emailVerificationExpires',
      ])
      .where('user.emailVerificationToken = :token', { token })
      .getOne();
  }

  /**
   * Updates a user's information.
   *
   * This method updates user data while checking for email/username conflicts.
   * It returns the complete updated user profile.
   *
   * @param id - The user ID to update
   * @param updateUserDto - The user data to update
   * @returns Promise containing the updated user as ReadUserDto
   * @throws {NotFoundException} If user with the specified ID does not exist
   * @throws {ConflictException} If email or username conflicts with another user
   *
   * @example
   * ```typescript
   * const updatedUser = await userService.update('user-id', {
   *   displayName: 'New Display Name'
   * });
   * ```
   */
  async update(id: string, updateUserDto: UpdateUserDto): Promise<ReadUserDto> {
    const user = await this.userRepository.findOne({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // Check for email/username conflicts if they're being updated
    // Use safe 'in' checks because UpdateUserDto properties are optional/mapped types
    const hasEmail = 'email' in updateUserDto && (updateUserDto as any).email;
    const hasUsername =
      'username' in updateUserDto && (updateUserDto as any).username;

    if (hasEmail || hasUsername) {
      const whereConditions: any[] = [];
      if (hasEmail) {
        whereConditions.push({ email: (updateUserDto as any).email });
      }
      if (hasUsername) {
        whereConditions.push({ username: (updateUserDto as any).username });
      }

      const existingUser = await this.userRepository.findOne({
        where: whereConditions,
      });

      if (existingUser && existingUser.id !== id) {
        if (hasEmail && existingUser.email === (updateUserDto as any).email) {
          throw new ConflictException('Email already exists');
        }
        if (
          hasUsername &&
          existingUser.username === (updateUserDto as any).username
        ) {
          throw new ConflictException('Username already exists');
        }
      }
    }

    Object.assign(user, updateUserDto);
    await this.userRepository.save(user);

    // FIX: Explicitly fetch the fully aggregated profile after mutating modifications
    const completeUser = await this.findCompleteUserForDto(id);
    if (!completeUser) {
      throw new NotFoundException(
        `User with ID ${id} disappeared during sync update processing`,
      );
    }

    return plainToInstance(ReadUserDto, completeUser, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Changes a user's password.
   *
   * This method verifies the current password before allowing the change,
   * then hashes and stores the new password.
   *
   * @param id - The user ID to update
   * @param changePasswordDto - Object containing current and new passwords
   * @throws {NotFoundException} If user with the specified ID does not exist
   * @throws {UnauthorizedException} If current password is incorrect
   *
   * @example
   * ```typescript
   * await userService.changePassword('user-id', {
   *   currentPassword: 'OldPass123',
   *   newPassword: 'NewPass456'
   * });
   * ```
   */
  async changePassword(
    id: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const isCurrentPasswordValid = await this.hashingService.comparePassword(
      changePasswordDto.currentPassword,
      user.password,
    );

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    user.password = await this.hashingService.hashPassword(
      changePasswordDto.newPassword,
    );
    await this.userRepository.save(user);
  }

  /**
   * Deletes a user account.
   *
   * This method permanently removes a user from the database.
   * Use with caution as this operation cannot be undone.
   *
   * @param id - The user ID to delete
   * @throws {NotFoundException} If user with the specified ID does not exist
   *
   * @example
   * ```typescript
   * await userService.remove('user-id');
   * ```
   */
  async remove(id: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    await this.userRepository.remove(user);
  }

  /**
   * Updates a user's last login timestamp.
   *
   * This method is called after successful authentication to track
   * when the user last logged in.
   *
   * @param id - The user ID to update
   *
   * @example
   * ```typescript
   * await userService.updateLastLogin('user-id');
   * ```
   */
  async updateLastLogin(id: string): Promise<void> {
    await this.userRepository.update(id, {
      lastLogin: new Date(),
    });
  }

  /**
   * Validates a user's credentials.
   *
   * This method checks if the provided email and password match
   * an existing user account.
   *
   * @param email - The user's email address
   * @param password - The user's plain-text password
   * @returns Promise containing the user entity or null if invalid
   *
   * @example
   * ```typescript
   * const user = await userService.validateUser('user@example.com', 'password123');
   * ```
   */
  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.findByEmail(email);

    if (
      user &&
      (await this.hashingService.comparePassword(password, user.password))
    ) {
      return user;
    }

    return null;
  }

  /**
   * Updates a user's game statistics.
   *
   * This method incrementally updates user statistics including games played,
   * total score, highest score, and streak information. It handles both
   * incremental updates and setting new maximum values.
   *
   * @param userId - The user ID to update
   * @param stats - Object containing the statistics to update
   * @throws {NotFoundException} If user with the specified ID does not exist
   *
   * @example
   * ```typescript
   * await userService.updateUserStats('user-id', {
   *   gamesPlayed: 1,
   *   totalScore: 100,
   *   highestScore: 100,
   *   currentStreak: 1,
   *   longestStreak: 1
   * });
   * ```
   */
  async updateUserStats(
    userId: string,
    stats: {
      gamesPlayed?: number;
      totalScore?: number;
      highestScore?: number;
      currentStreak?: number;
      longestStreak?: number;
    },
  ): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Update stats incrementally or set new values
    if (stats.gamesPlayed !== undefined) {
      user.gamesPlayed += stats.gamesPlayed;
    }
    if (stats.totalScore !== undefined) {
      user.totalScore += stats.totalScore;
    }
    if (
      stats.highestScore !== undefined &&
      stats.highestScore > user.highestScore
    ) {
      user.highestScore = stats.highestScore;
    }
    if (stats.currentStreak !== undefined) {
      user.currentStreak = stats.currentStreak;
    }
    if (
      stats.longestStreak !== undefined &&
      stats.longestStreak > user.longestStreak
    ) {
      user.longestStreak = stats.longestStreak;
    }

    await this.userRepository.save(user);
  }
}
