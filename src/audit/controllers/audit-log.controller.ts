import {
  Controller,
  Get,
  Param,
  Query,
  HttpStatus,
  HttpCode,
  UseGuards,
  Post,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuditLogService } from '../services/audit-log.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import {
  type GetAuditLogsDto,
  type ExportAuditLogsDto,
  AuditLogsResponseDto,
  AuditLogResponseDto,
  AuditLogStatsDto,
} from '../dto/audit-log.dto';

@ApiTags('Admin - Audit Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/audit-logs')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @ApiOperation({ summary: 'Get audit logs with filtering' })
  @ApiResponse({
    status: 200,
    description: 'Audit logs retrieved successfully',
    type: AuditLogsResponseDto,
  })
  @HttpCode(HttpStatus.OK)
  async getAuditLogs(query: GetAuditLogsDto): Promise<AuditLogsResponseDto> {
    const filters = {
      ...query,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    };

    return this.auditLogService.findLogs(filters);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get audit log statistics' })
  @ApiResponse({
    status: 200,
    description: 'Audit log statistics retrieved successfully',
    type: AuditLogStatsDto,
  })
  @HttpCode(HttpStatus.OK)
  async getAuditLogStats(): Promise<AuditLogStatsDto> {
    return this.auditLogService.getLogStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get specific audit log by ID' })
  @ApiResponse({
    status: 200,
    description: 'Audit log retrieved successfully',
    type: AuditLogResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Audit log not found',
  })
  @HttpCode(HttpStatus.OK)
  async getAuditLogById(@Param('id') id: string): Promise<AuditLogResponseDto> {
    const log = await this.auditLogService.getLogById(id);

    if (!log) {
      throw new Error('Audit log not found');
    }

    return log;
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get audit logs for specific user' })
  @ApiResponse({
    status: 200,
    description: 'User audit logs retrieved successfully',
    type: [AuditLogResponseDto],
  })
  @HttpCode(HttpStatus.OK)
  async getUserAuditLogs(
    @Param('userId') userId: string,
    limit = 100,
  ): Promise<AuditLogResponseDto[]> {
    return this.auditLogService.getLogsByUser(userId, limit);
  }

  @Get('action/:actionType')
  @ApiOperation({ summary: 'Get audit logs by action type' })
  @ApiResponse({
    status: 200,
    description: 'Action audit logs retrieved successfully',
    type: [AuditLogResponseDto],
  })
  @HttpCode(HttpStatus.OK)
  async getActionAuditLogs(
    @Param('actionType') actionType: string,
    limit = 100,
  ): Promise<AuditLogResponseDto[]> {
    return this.auditLogService.getLogsByActionType(actionType, limit);
  }

  @Post('export')
  @ApiOperation({ summary: 'Export audit logs with filtering' })
  @ApiResponse({
    status: 200,
    description: 'Audit logs exported successfully',
  })
  @HttpCode(HttpStatus.OK)
  async exportAuditLogs(@Query() query: ExportAuditLogsDto) {
    const filters = {
      ...query,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    };

    return this.auditLogService.exportLogs(filters, query.format as 'csv' | 'json');
  }

  @Post('archive')
  @ApiOperation({ summary: 'Archive old audit logs' })
  @ApiResponse({
    status: 200,
    description: 'Audit logs archived successfully',
  })
  @HttpCode(HttpStatus.OK)
  async archiveAuditLogs(@Query('days') days: string = '365') {
    const retentionDays = parseInt(days, 10);
    if (isNaN(retentionDays) || retentionDays < 30) {
      throw new Error('Retention days must be at least 30');
    }
    const deletedCount = await this.auditLogService.archiveOldLogs(retentionDays);
    return {
      message: `Archived ${deletedCount} audit logs older than ${retentionDays} days`,
      deletedCount,
    };
  }
}
