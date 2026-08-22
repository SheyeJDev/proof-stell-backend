import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpStatus,
  HttpCode,
  UseInterceptors,
} from '@nestjs/common';
import { GameSessionService } from './game-session.service';
import { ReportSessionDto } from './dto/report-session.dto';
import { StartSessionDto } from './dto/start-session.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { SessionIntegrityGuard } from 'src/common/guards/session-integrity.guard';
import { AuditLog } from '../audit/decorators/audit-log.decorator';
import { AuditLogInterceptor } from '../audit/interceptors/audit-log.interceptor';
import { AUDIT_ACTIONS } from '../audit/constants/audit-actions';

interface RequestWithUser extends Request {
  user: {
    id: string;
    role: string;
  };
  isSuspiciousSession?: boolean;
  suspicionReason?: string;
}

@Controller('session')
@UseGuards(JwtAuthGuard)
@UseInterceptors(AuditLogInterceptor)
export class GameSessionController {
  constructor(private readonly gameSessionService: GameSessionService) {}

  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  @AuditLog({
    actionType: AUDIT_ACTIONS.SESSION_STARTED,
    resource: 'game-session',
    includeBody: true,
  })
  async startSession(
    @Request() req: RequestWithUser,
    @Body() startSessionDto: StartSessionDto,
  ) {
    const userId = req.user.id;
    return this.gameSessionService.startSession(userId, startSessionDto);
  }

  @Post('report')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionIntegrityGuard)
  @AuditLog({
    actionType: AUDIT_ACTIONS.SESSION_REPORTED,
    resource: 'game-session',
    includeBody: true,
  })
  async reportSession(
    @Request() req: RequestWithUser,
    @Body() reportSessionDto: ReportSessionDto,
  ) {
    const userId = req.user.id;
    const session = await this.gameSessionService.reportSession(
      userId,
      reportSessionDto,
      req.isSuspiciousSession || false,
      req.suspicionReason,
    );

    return {
      message: 'Session reported successfully',
      sessionId: session.id,
      timestamp: session.createdAt,
      isSuspicious: session.isSuspicious,
      suspicionReason: session.suspicionReason,
    };
  }

  @Get('analytics/summary')
  async getAnalytics(
    @Query('userId') userId?: string,
    @Query('challengeId') challengeId?: string,
  ) {
    return this.gameSessionService.getSessionAnalytics(userId, challengeId);
  }

  @Get('user/:userId')
  async getUserSessions(
    @Request() req: RequestWithUser,
    @Param('userId') userId: string,
    @Query('limit') limit: number = 50,
    @Query('offset') offset: number = 0,
  ) {
    return this.gameSessionService.findSessionsByUser(
      userId,
      req.user,
      limit,
      offset,
    );
  }

  @Get(':sessionId')
  async getSession(@Param('sessionId') sessionId: string) {
    return this.gameSessionService.findSessionById(sessionId);
  }
}
