import {
  IsOptional,
  IsString,
  IsDateString,
  IsNumber,
  Min,
  Max,
  IsEnum,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetAuditLogsDto {
  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filter by action type' })
  @IsOptional()
  @IsString()
  actionType?: string;

  @ApiPropertyOptional({ description: 'Filter by result status' })
  @IsOptional()
  @IsEnum(['SUCCESS', 'FAILURE', 'ERROR'])
  result?: string;

  @ApiPropertyOptional({ description: 'Start date for filtering' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date for filtering' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

export class ExportAuditLogsDto {
  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filter by action type' })
  @IsOptional()
  @IsString()
  actionType?: string;

  @ApiPropertyOptional({ description: 'Filter by result status' })
  @IsOptional()
  @IsEnum(['SUCCESS', 'FAILURE', 'ERROR'])
  result?: string;

  @ApiPropertyOptional({ description: 'Start date for filtering' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date for filtering' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Export format', default: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: string = 'csv';
}

export class AuditLogResponseDto {
  id: string;
  userId: string;
  actionType: string;
  metadata: Record<string, any>;
  createdAt: Date;
  ipAddress?: string;
  userAgent?: string;
  resource?: string;
  result?: string;
}

export class AuditLogsResponseDto {
  logs: AuditLogResponseDto[];
  total: number;
  page: number;
  totalPages: number;
}

export class AuditLogStatsDto {
  totalLogs: number;
  logsByAction: Record<string, number>;
  recentActivity: number;
}
