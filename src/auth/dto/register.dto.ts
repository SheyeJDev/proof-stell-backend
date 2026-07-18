import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsOptional,
  IsAlphanumeric,
  IsStrongPassword,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

/**
 * Data transfer object for user registration.
 * 
 * This DTO validates and structures user registration requests,
 * ensuring all required fields are present and properly formatted.
 * It includes email validation, username constraints, and strong password requirements.
 */
export class RegisterDto {
  /**
   * The user's email address.
   * Must be a valid email format and unique across the system.
   * Automatically normalized to lowercase and trimmed.
   * 
   * @example "user@example.com"
   */
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
    format: 'email',
  })
  @Transform(({ value }) => value?.toLowerCase().trim())
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @MaxLength(254, { message: 'Email must not exceed 254 characters' })
  email: string;

  /**
   * The user's unique username.
   * Must be alphanumeric with underscores only, 3-30 characters.
   * Automatically trimmed of whitespace.
   * 
   * @example "player123"
   */
  @ApiProperty({
    description:
      'Unique username for the user (alphanumeric and underscores only)',
    example: 'player123',
    minLength: 3,
    maxLength: 30,
    pattern: '^[a-zA-Z0-9_]+$',
  })
  @Transform(({ value }) => value?.trim())
  @IsString({ message: 'Username must be a string' })
  @IsNotEmpty({ message: 'Username is required' })
  @MinLength(3, { message: 'Username must be at least 3 characters long' })
  @MaxLength(30, { message: 'Username must not exceed 30 characters' })
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'Username can only contain letters, numbers, and underscores',
  })
  username: string;

  /**
   * The user's password.
   * Must be 8-128 characters and contain at least one uppercase letter,
   * one lowercase letter, one number, and one special character.
   * 
   * @example "SecurePass123!"
   */
  @ApiProperty({
    description:
      'User password - must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
    example: 'SecurePass123!',
    minLength: 8,
    maxLength: 128,
  })
  @IsString({ message: 'Password must be a string' })
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  })
  password: string;

  /**
   * Optional StarkNet wallet address for blockchain integration.
   * 
   * @example "0x1234567890abcdef1234567890abcdef12345678"
   */
  @ApiPropertyOptional({
    description: 'Optional StarkNet wallet address',
    example: '0x1234567890abcdef1234567890abcdef12345678',
  })
  @IsOptional()
  @IsString()
  walletAddress?: string;
}
