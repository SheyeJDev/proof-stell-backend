import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { LeaderboardService } from './Leaderboard.service';
import { CreateLeaderboardDto } from './dto/create-leaderboard.dto';
import {
  LeaderboardResponseDto,
  GlobalLeaderboardResponseDto,
} from './dto/leaderboard-response.dto';
import { RequestWithUser } from '../auth/interfaces/request-with-user';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { plainToClass } from 'class-transformer';
import { CacheInterceptor } from '../cache/interceptors/cache.interceptor';
import { Cacheable, CacheKeys } from '../cache/decorators/cache.decorator';

@ApiTags('Leaderboard')
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @ApiOperation({ summary: 'Get global leaderboard' })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of entries per page (max 100)',
    example: 50,
  })
  @ApiResponse({
    status: 200,
    description: 'Global leaderboard retrieved successfully',
    type: GlobalLeaderboardResponseDto,
  })
  @Get('global')
  @UseInterceptors(CacheInterceptor)
  @Cacheable(CacheKeys.GLOBAL_LEADERBOARD, 300) // 5 minutes TTL
  async getGlobalLeaderboard(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): Promise<GlobalLeaderboardResponseDto> {
    const result = await this.leaderboardService.getGlobalLeaderboard(
      page,
      Math.min(limit, 100),
    );
    return plainToClass(GlobalLeaderboardResponseDto, result, {
      excludeExtraneousValues: true,
    });
  }

  @ApiOperation({ summary: 'Get current user leaderboard position' })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({
    status: 200,
    description: 'User leaderboard position retrieved successfully',
    type: LeaderboardResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Authentication required',
  })
  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.PLAYER, Role.ADMIN)
  @UseInterceptors(CacheInterceptor)
  @Cacheable(CacheKeys.USER_LEADERBOARD, 120) // 2 minutes TTL
  async getUserLeaderboard(
    @Req() req: RequestWithUser,
  ): Promise<LeaderboardResponseDto> {
    const userId = req.user.id;
    const result = await this.leaderboardService.getUserLeaderboard(userId);
    return plainToClass(LeaderboardResponseDto, result, {
      excludeExtraneousValues: true,
    });
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.PLAYER, Role.ADMIN)
  @ApiOperation({ summary: 'Submit a leaderboard score' })
  @ApiResponse({ status: 429, description: 'Score submit rate limit: 1 per second per user' })
  // Leaderboard submit: 1 per second per user to prevent score-spam attacks
  @Throttle({ default: { ttl: 1, limit: 1 } })
  async submitScore(
    @Req() req: RequestWithUser,
    @Body() createLeaderboardDto: CreateLeaderboardDto,
  ): Promise<LeaderboardResponseDto> {
    const userId = req.user.id;
    const result = await this.leaderboardService.submitScore(
      userId,
      createLeaderboardDto,
    );
    return plainToClass(LeaderboardResponseDto, result, {
      excludeExtraneousValues: true,
    });
  }

  @Post('admin/reset')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async resetLeaderboard(): Promise<{ message: string }> {
    await this.leaderboardService.resetLeaderboard();
    return { message: 'Leaderboard reset successfully' };
  }
}