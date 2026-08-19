import { ApiProperty } from '@nestjs/swagger';
import { ReadUserDto } from '../../users/dto/read-user.dto';

export class LoginResponseDto {
  @ApiProperty({
    description: 'JWT access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  access_token: string;

  @ApiProperty({
    description: 'Rotating refresh token for obtaining new access tokens',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  refresh_token: string;

  @ApiProperty({
    description: 'User information',
    type: ReadUserDto,
  })
  user: ReadUserDto;
}

export class RegisterResponseDto {
  @ApiProperty({
    description: 'JWT access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  access_token: string;

  @ApiProperty({
    description: 'User information',
    type: ReadUserDto,
  })
  user: ReadUserDto;
}

export class MessageResponseDto {
  @ApiProperty({
    description: 'Response message',
    example: 'Email verified successfully',
  })
  message: string;
}
