import { Controller, Get, Query, UseInterceptors } from '@nestjs/common';
import { AdminService } from './admin.service';
import { MetricsService } from './services/metrics.service';
import { AuditLog } from '../audit/decorators/audit-log.decorator';
import { AuditLogInterceptor } from '../audit/interceptors/audit-log.interceptor';
import { AUDIT_ACTIONS } from '../audit/constants/audit-actions';
import { AdminOnly } from 'src/audit/decorators/admin-only.decorator';

@Controller('admin')
@AdminOnly()
@UseInterceptors(AuditLogInterceptor)
export class AdminController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly adminService: AdminService,
  ) {}

  @Get('dashboard')
  @AuditLog({
    actionType: AUDIT_ACTIONS.ADMIN_DASHBOARD_VIEW,
    resource: 'admin:dashboard',
  })
  async getDashboard() {
    return this.adminService.getDashboardData();
  }

  @Get('metrics/users/active')
  @AuditLog({
    actionType: AUDIT_ACTIONS.ADMIN_ACTIVE_USERS_VIEW,
    resource: 'admin:metrics:users',
  })
  async getActiveUsers(@Query('hours') hours: string = '24') {
    return this.metricsService.getActiveUsers(parseInt(hours, 10));
  }

  @Get('metrics/games/summary')
  @AuditLog({
    actionType: AUDIT_ACTIONS.ADMIN_GAMES_SUMMARY_VIEW,
    resource: 'admin:metrics:games',
  })
  async getGamesSummary(@Query('days') days: string = '7') {
    return this.metricsService.getGamesSummary(parseInt(days, 10));
  }

  @Get('metrics/system/health')
  @AuditLog({
    actionType: AUDIT_ACTIONS.ADMIN_SYSTEM_HEALTH_VIEW,
    resource: 'admin:metrics:system',
  })
  async getSystemHealth() {
    return this.metricsService.getSystemHealth();
  }

  @Get('export/csv')
  @AuditLog({
    actionType: AUDIT_ACTIONS.ADMIN_EXPORT_CSV,
    resource: 'admin:export',
  })
  async exportDataCsv(
    @Query('type') type: string,
    @Query('days') days: string = '30',
  ) {
    return this.adminService.exportToCsv(type, parseInt(days, 10));
  }
}
