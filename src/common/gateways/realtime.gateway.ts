import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards } from '@nestjs/common';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { WsSessionIntegrityGuard } from './guards/ws-session-integrity.guard';
import { LoggingService } from '../../logging/logging.service';
import { NotificationDto } from './dto/notification.dto';
import { LeaderboardSubscribeDto } from './dto/leaderboard-subscribe.dto';
import { GameSubscribeDto } from './dto/game-subscribe.dto';
import { validateOrReject, ValidationError } from 'class-validator';

/** Derive WebSocket CORS origins from the same env var as HTTP CORS. */
const wsCorsOrigin = ((): string | string[] | boolean => {
  const corsEnabled = process.env.CORS_ENABLED !== 'false';
  if (!corsEnabled) {
    return false;
  }
  const raw = process.env.ALLOWED_ORIGINS || 'http://localhost:3000';
  const origins = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return origins.length === 1 ? origins[0] : origins;
})();

/**
 * Per-user event rate limiting for WebSocket events.
 * Tracks event counts per userId per event type within a sliding window.
 * Limit: 1 event per second per user per event type.
 */
class WsRateLimiter {
  /** Map of `${userId}:${event}` -> array of timestamps */
  private readonly windows: Map<string, number[]> = new Map();

  /**
   * Returns true if the request is allowed, false if rate-limited.
   * @param userId  The authenticated user ID
   * @param event   The WebSocket event name
   * @param limit   Max events per window
   * @param windowMs Window size in milliseconds
   */
  isAllowed(
    userId: string,
    event: string,
    limit = 60,
    windowMs = 60_000,
  ): boolean {
    const key = `${userId}:${event}`;
    const now = Date.now();
    const timestamps = (this.windows.get(key) ?? []).filter(
      (t) => now - t < windowMs,
    );
    if (timestamps.length >= limit) {
      return false;
    }
    timestamps.push(now);
    this.windows.set(key, timestamps);
    return true;
  }
}

/**
 * WebSocket gateway for real-time communication.
 *
 * This gateway handles real-time updates for leaderboards, game sessions,
 * and user notifications. It uses Socket.IO with JWT authentication and
 * supports room-based subscriptions for targeted updates.
 *
 * All incoming event payloads are validated against typed DTOs before
 * processing. Per-user rate limiting is enforced on all subscriptions
 * to prevent DoS via WebSocket flooding.
 *
 * ## Connection
 * - Namespace: `/realtime`
 * - Authentication: JWT token via query parameter or handshake auth
 * - CORS: Configured via `CORS_ENABLED` and `ALLOWED_ORIGINS` env vars
 *
 * @example
 * ```typescript
 * // Client-side connection
 * const socket = io('http://localhost:3000/realtime', {
 *   auth: { token: 'jwt_token_here' }
 * });
 * ```
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors:
    wsCorsOrigin === false
      ? false
      : {
          origin: wsCorsOrigin,
          credentials: true,
        },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private connectedUsers: Map<string, string> = new Map();

  /** Per-user WebSocket rate limiter */
  private readonly rateLimiter = new WsRateLimiter();

  constructor(private readonly loggingService: LoggingService) {}

  @UseGuards(WsJwtGuard)
  handleConnection(client: Socket) {
    try {
      const user = (client as any).user;
      if (!user || !user.sub) {
        this.loggingService.warn(
          'Connection attempt without valid user payload.',
          {
            module: 'realtime',
            action: 'connection',
            metadata: { socketId: client.id },
          },
        );
        client.disconnect(true);
        return;
      }
      client.join(`user:${user.sub}`);
      this.connectedUsers.set(client.id, user.sub);
      this.loggingService.info(`User ${user.sub} connected`, {
        userId: user.sub,
        module: 'realtime',
        action: 'connection',
        metadata: { socketId: client.id },
      });
    } catch (err) {
      this.loggingService.error(
        'Error in handleConnection',
        err instanceof Error ? err : new Error(String(err)),
        {
          module: 'realtime',
          action: 'connection',
          metadata: { socketId: client.id },
        },
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = this.connectedUsers.get(client.id);
    if (userId) {
      this.loggingService.info(`User ${userId} disconnected`, {
        userId,
        module: 'realtime',
        action: 'disconnection',
        metadata: { socketId: client.id },
      });
      this.connectedUsers.delete(client.id);
    } else {
      this.loggingService.info('Unknown user disconnected', {
        module: 'realtime',
        action: 'disconnection',
        metadata: { socketId: client.id },
      });
    }
  }

  /**
   * Subscribes a client to leaderboard updates.
   *
   * Payload is validated against {@link LeaderboardSubscribeDto}.
   * Rate limited to 60 subscription events per minute per user.
   */
  @UseGuards(WsJwtGuard)
  @SubscribeMessage('leaderboard:subscribe')
  async handleLeaderboardSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    try {
      const userId = this.connectedUsers.get(client.id);
      if (!userId) return { error: 'Not authenticated' };

      // Per-user rate limit: 60 subscription events/min
      if (
        !this.rateLimiter.isAllowed(userId, 'leaderboard:subscribe', 60, 60_000)
      ) {
        return { error: 'Rate limit exceeded. Slow down.' };
      }

      // Validate and sanitize payload via DTO
      const dto = Object.assign(new LeaderboardSubscribeDto(), data ?? {});
      await validateOrReject(dto);

      client.join(`leaderboard:${dto.leaderboardId}`);
      return { event: 'subscribed', leaderboardId: dto.leaderboardId };
    } catch (err) {
      if (Array.isArray(err) && err[0] instanceof ValidationError) {
        return {
          error: 'Invalid payload',
          details: 'leaderboardId must be a non-empty string',
        };
      }
      this.loggingService.error(
        'Error in leaderboard:subscribe',
        err instanceof Error ? err : new Error(String(err)),
        { module: 'realtime', action: 'leaderboard:subscribe' },
      );
      return { error: 'Subscription failed' };
    }
  }

  /**
   * Subscribes a client to game session updates.
   *
   * Payload is validated against {@link GameSubscribeDto}.
   * Rate limited to 60 subscription events per minute per user.
   */
  @UseGuards(WsJwtGuard)
  @SubscribeMessage('game:subscribe')
  async handleGameSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    try {
      const userId = this.connectedUsers.get(client.id);
      if (!userId) return { error: 'Not authenticated' };

      // Per-user rate limit: 60 game subscribe events/min
      if (!this.rateLimiter.isAllowed(userId, 'game:subscribe', 60, 60_000)) {
        return { error: 'Rate limit exceeded. Slow down.' };
      }

      // Validate and sanitize payload via DTO
      const dto = Object.assign(new GameSubscribeDto(), data ?? {});
      await validateOrReject(dto);

      client.join(`game:${dto.gameId}`);
      return { event: 'subscribed', gameId: dto.gameId };
    } catch (err) {
      if (Array.isArray(err) && err[0] instanceof ValidationError) {
        return {
          error: 'Invalid payload',
          details: 'gameId must be a non-empty string',
        };
      }
      this.loggingService.error(
        'Error in game:subscribe',
        err instanceof Error ? err : new Error(String(err)),
        { module: 'realtime', action: 'game:subscribe' },
      );
      return { error: 'Subscription failed' };
    }
  }

  emitLeaderboardUpdate(
    leaderboardId: string,
    scores: any[],
    updateType:
      | 'score_change'
      | 'rank_change'
      | 'new_entry'
      | 'reset' = 'score_change',
  ) {
    const updateData = {
      leaderboardId,
      scores,
      updateType,
      timestamp: new Date().toISOString(),
      totalEntries: scores.length,
    };

    this.server
      .to(`leaderboard:${leaderboardId}`)
      .emit('leaderboard:update', updateData);
    const clientCount =
      this.server.sockets.adapter.rooms.get(`leaderboard:${leaderboardId}`)
        ?.size || 0;
    this.loggingService.info(
      `Emitted leaderboard update for ${leaderboardId} (${updateType})`,
      {
        module: 'realtime',
        action: 'leaderboard:emit',
        metadata: { leaderboardId, updateType, clientCount },
      },
    );
  }

  emitUserRankChange(
    userId: string,
    oldRank: number,
    newRank: number,
    score: number,
  ) {
    this.server.to(`user:${userId}`).emit('leaderboard:rank-change', {
      userId,
      oldRank,
      newRank,
      score,
      timestamp: new Date().toISOString(),
    });
  }

  emitLeaderboardStats(leaderboardId: string, stats: any) {
    this.server.to(`leaderboard:${leaderboardId}`).emit('leaderboard:stats', {
      leaderboardId,
      stats,
      timestamp: new Date().toISOString(),
    });
  }

  emitGameStateChange(gameId: string, state: 'started' | 'paused' | 'ended') {
    this.server
      .to(`game:${gameId}`)
      .emit('game:state-change', { gameId, state });
  }

  emitNotification(
    userId: string,
    message: string,
    type: string,
    icon?: string,
  ) {
    // Escape special characters in admin-generated content before broadcast
    const safeMessage = this.escapeHtml(String(message).slice(0, 1000));
    this.server
      .to(`user:${userId}`)
      .emit('notification:alert', { message: safeMessage, type, icon });
  }

  /**
   * Handles game session reporting via WebSocket.
   *
   * Validates session integrity (timing, sequence, replay protection)
   * before accepting the session report. Uses the same validation rules
   * as HTTP routes for consistency.
   */
  @UseGuards(WsJwtGuard, WsSessionIntegrityGuard)
  @SubscribeMessage('game:report-session')
  async handleGameReportSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ) {
    try {
      const userId = this.connectedUsers.get(client.id);
      if (!userId) return { error: 'Not authenticated' };

      // Rate limit session reports: 10 per minute per user
      if (
        !this.rateLimiter.isAllowed(userId, 'game:report-session', 10, 60_000)
      ) {
        return { error: 'Rate limit exceeded. Slow down.' };
      }

      // Check if session was flagged as suspicious by the integrity guard
      const isSuspicious = (client as any).isSuspiciousSession;
      const suspicionReason = (client as any).suspicionReason;

      if (isSuspicious) {
        this.loggingService.warn('Suspicious session detected via WebSocket', {
          userId,
          module: 'realtime',
          action: 'game:report-session',
          metadata: { reason: suspicionReason },
        });
      }

      // Return success with suspicion status
      return {
        status: 'received',
        isSuspicious: isSuspicious || false,
        suspicionReason: suspicionReason || null,
      };
    } catch (err) {
      this.loggingService.error(
        'Error in game:report-session',
        err instanceof Error ? err : new Error(String(err)),
        { module: 'realtime', action: 'game:report-session' },
      );
      return { error: 'Session report failed' };
    }
  }

  /**
   * Handles notification sending from admin clients.
   *
   * Validates payload, enforces admin-only access, sanitizes message content,
   * and rate-limits to 30 sends per minute per admin user.
   */
  @UseGuards(WsJwtGuard)
  @SubscribeMessage('notification:send')
  async handleSendNotification(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: NotificationDto,
  ) {
    try {
      await validateOrReject(Object.assign(new NotificationDto(), payload));
      const user = (client as any).user;
      if (user.role !== 'admin') return { error: 'Unauthorized' };

      // Rate limit admin notification sends: 30/min
      if (
        !this.rateLimiter.isAllowed(user.sub, 'notification:send', 30, 60_000)
      ) {
        return { error: 'Rate limit exceeded' };
      }

      this.emitNotification(
        payload.userId,
        payload.message,
        payload.type,
        payload.icon,
      );
      return { status: 'sent' };
    } catch (err) {
      if (Array.isArray(err) && err[0] instanceof ValidationError) {
        return { error: 'Validation failed', details: err };
      }
      this.loggingService.error(
        'Error in notification:send',
        err instanceof Error ? err : new Error(String(err)),
        { module: 'realtime', action: 'notification:send' },
      );
      return { error: 'Notification failed' };
    }
  }

  /**
   * Escapes HTML special characters to prevent XSS in admin-generated content.
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }
}
