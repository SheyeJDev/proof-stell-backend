import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { UserService } from '../providers/users.service';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/role.enum';
import { CreateUserDto } from '../dto/create-user.dto';
import { ReadUserDto } from '../dto/read-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { CacheInterceptor } from '../../cache/interceptors/cache.interceptor';
import { Cacheable, CacheKeys } from '../../cache/decorators/cache.decorator';
import { AvatarService } from '../avatar/avatar.service';
import { AvatarUploadInterceptor } from '../avatar/avatar-upload.interceptor';
import { AuditLog } from '../../audit/decorators/audit-log.decorator';
import { AuditLogInterceptor } from '../../audit/interceptors/audit-log.interceptor';
import { AUDIT_ACTIONS } from '../../audit/constants/audit-actions';

@ApiTags('Users')
@ApiBearerAuth('JWT-auth')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditLogInterceptor)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly avatarService: AvatarService,
  ) {}

  @ApiOperation({ summary: 'Create new user (Admin only)' })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({
    status: 201,
    description: 'User created successfully',
    type: ReadUserDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin role required',
  })
  @Post()
  @Roles(Role.ADMIN)
  @AuditLog({
    actionType: AUDIT_ACTIONS.USER_CREATED,
    resource: 'user',
    includeBody: true,
  })
  async create(@Body() createUserDto: CreateUserDto): Promise<ReadUserDto> {
    return this.userService.create(createUserDto);
  }

  @ApiOperation({ summary: 'Get all users (Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Users retrieved successfully',
    type: [ReadUserDto],
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin role required',
  })
  @Get()
  @Roles(Role.ADMIN)
  async findAll(): Promise<ReadUserDto[]> {
    return this.userService.findAll();
  }

  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    type: ReadUserDto,
  })
  @Get('profile')
  @UseInterceptors(CacheInterceptor)
  @Cacheable(CacheKeys.USER_PROFILE, 300) // 5 minutes TTL
  async getProfile(@Request() req): Promise<ReadUserDto> {
    return this.userService.findOne(req.user.id);
  }

  @ApiOperation({ summary: 'Get user by ID (Admin only)' })
  @ApiParam({
    name: 'id',
    description: 'User UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'User retrieved successfully',
    type: ReadUserDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin role required',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  @Get(':id')
  @Roles(Role.ADMIN)
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ReadUserDto> {
    return this.userService.findOne(id);
  }

  @ApiOperation({ summary: 'Update current user profile' })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({
    status: 200,
    description: 'Profile updated successfully',
    type: ReadUserDto,
  })
  @Patch('profile')
  @AuditLog({
    actionType: AUDIT_ACTIONS.USER_PROFILE_UPDATED,
    resource: 'user:profile',
    includeBody: true,
  })
  async updateProfile(
    @Request() req,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<ReadUserDto> {
    return this.userService.update(req.user.id, updateUserDto);
  }

  @ApiOperation({ summary: 'Update user by ID (Admin only)' })
  @ApiParam({
    name: 'id',
    description: 'User UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({
    status: 200,
    description: 'User updated successfully',
    type: ReadUserDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin role required',
  })
  @Patch(':id')
  @Roles(Role.ADMIN)
  @AuditLog({
    actionType: AUDIT_ACTIONS.USER_UPDATED,
    resource: 'user',
    includeBody: true,
    includeParams: true,
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<ReadUserDto> {
    return this.userService.update(id, updateUserDto);
  }

  @ApiOperation({ summary: 'Change user password' })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({
    status: 204,
    description: 'Password changed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid current password',
  })
  @Patch('profile/change-password')
  @AuditLog({
    actionType: AUDIT_ACTIONS.PASSWORD_CHANGE,
    resource: 'user:password',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Request() req,
    @Body() changePasswordDto: ChangePasswordDto,
  ): Promise<void> {
    return this.userService.changePassword(req.user.id, changePasswordDto);
  }

  @ApiOperation({ summary: 'Delete user (Admin only)' })
  @ApiParam({
    name: 'id',
    description: 'User UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 204,
    description: 'User deleted successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin role required',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  @Delete(':id')
  @Roles(Role.ADMIN)
  @AuditLog({
    actionType: AUDIT_ACTIONS.USER_DELETED,
    resource: 'user',
    includeParams: true,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.userService.remove(id);
  }

  @ApiOperation({ summary: 'Upload user avatar' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Avatar image file (JPEG, PNG, GIF, JPG - max 2MB)',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Avatar uploaded successfully',
    schema: {
      type: 'object',
      properties: {
        avatarUrl: {
          type: 'string',
          example: '/avatars/1234567890-avatar.webp',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid file type or no file uploaded',
  })
  @Post('profile/avatar')
  @UseInterceptors(AvatarUploadInterceptor())
  async uploadAvatar(
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.avatarService.uploadAndSaveAvatar(req.user.id, file);
  }
}
