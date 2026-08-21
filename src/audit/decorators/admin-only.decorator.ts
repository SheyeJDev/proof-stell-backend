import { applyDecorators, UseGuards } from '@nestjs/common';
import { AdminGuard } from 'src/common/guards/admin.guard';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

/**
 * Applies the canonical admin authorization chain in the correct order:
 * authenticate first (JwtAuthGuard), then authorize (AdminGuard).
 * Use this instead of manually composing @UseGuards on admin routes.
 */
export function AdminOnly() {
  return applyDecorators(UseGuards(JwtAuthGuard, AdminGuard));
}