import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { SessionIntegrityService } from '../services/session-integrity.service';

interface User {
  id: string;
}

interface CustomRequest extends Request {
  user?: User;
  isSuspiciousSession?: boolean;
  suspicionReason?: string;
}

interface SessionData {
  duration: number;
  inputs?: Array<{ timestamp: number; sequence?: number; clientId?: string }>;
  sessionId?: string;
  signature?: string;
}

@Injectable()
export class SessionIntegrityGuard implements CanActivate {
  private readonly logger = new Logger(SessionIntegrityGuard.name);

  constructor(
    private readonly sessionIntegrityService: SessionIntegrityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomRequest>();
    const userId = request.user?.id;

    // Safe request body handling
    if (!request.body) {
      this.logger.warn('Request body is missing or null', { userId });
      throw new BadRequestException('Request body is required');
    }

    const sessionData = request.body as SessionData;

    // Validate required fields
    if (sessionData.duration === undefined || sessionData.duration === null) {
      this.logger.warn('Session duration is missing', { userId });
      throw new BadRequestException('Session duration is required');
    }

    // Session timing validation
    const timingResult =
      this.sessionIntegrityService.validateSessionTiming(sessionData);
    if (!timingResult.isValid) {
      this.logger.warn('Session timing validation failed', {
        userId,
        duration: sessionData.duration,
        inputCount: sessionData.inputs?.length,
        reason: timingResult.reason,
      });
      throw new BadRequestException(
        `Invalid session timing: ${timingResult.reason}`,
      );
    }

    // Input sequence validation
    const sequenceResult = this.sessionIntegrityService.validateInputSequence(
      sessionData.inputs,
    );
    if (!sequenceResult.isValid) {
      this.logger.warn('Input sequence validation failed', {
        userId,
        reason: sequenceResult.reason,
      });
      throw new BadRequestException(
        `Invalid input sequence: ${sequenceResult.reason}`,
      );
    }

    // Replay protection
    const replayResult = await this.sessionIntegrityService.detectReplayAttack(
      sessionData,
      userId,
    );
    if (replayResult.isSuspicious) {
      this.logger.warn('Potential replay attack detected', {
        userId,
        sessionId: sessionData.sessionId,
        reason: replayResult.reason,
        details: replayResult.details,
      });
      // Log for investigation but allow legitimate games to continue
      // Mark session for review instead of blocking
      request.isSuspiciousSession = true;
      request.suspicionReason = replayResult.reason;
    }

    return true;
  }
}
