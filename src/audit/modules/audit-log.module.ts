import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { AuditLogService } from '../services/audit-log.service';
import { AuditLogInterceptor } from '../interceptors/audit-log.interceptor';
import { AuditLogController } from '../controllers/audit-log.controller';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [AuditLogController],
  providers: [AuditLogService, AuditLogInterceptor, AdminGuard, RolesGuard],
  exports: [AuditLogService, AuditLogInterceptor, AdminGuard, RolesGuard],
})
export class AuditLogModule {}
