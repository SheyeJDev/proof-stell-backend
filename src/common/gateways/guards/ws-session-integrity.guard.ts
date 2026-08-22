import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Socket } from 'socket.io';
import { SessionIntegrityService } from '../../services/session-integrity.service';

interface SessionData {
  duration: number;
  inputs?: Array<{ timestamp: number; sequence?: number; clientId?: string }>;
  sessionId?: string;
  signature?: string;
}

interface CustomSocket extends Socket {
  user?: { id: string; email: string; role: string };
}

@Injectable()
export class WsSessionIntegrityGuard implements CanActivate {
  private readonly logger = new Logger(WsSessionIntegrityGuard.name);

  constructor(
    private readonly sessionIntegrityService: SessionIntegrityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<CustomSocket>();
    const payload = context.switchToWs().getData();
    const userId = client.user?.id;

    // Safe payload handling
    if (!payload) {
      this.logger.warn('WebSocket payload is missing or null', { userId });
      throw new BadRequestException('Payload is required');
    }

    const sessionData = payload as SessionData;

    // Validate required fields
    if (sessionData.duration === undefined || sessionData.duration === null) {
      this.logger.warn('Session duration is missing', { userId });
      throw new BadRequestException('Session duration is required');
    }

    // Session timing validation
    const timingResult = this.sessionIntegrityService.validateSessionTiming(
      sessionData,
      userId,
    );
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
      userId,
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
      (client as any).isSuspiciousSession = true;
      (client as any).suspicionReason = replayResult.reason;
    }

    return true;
  }
}
