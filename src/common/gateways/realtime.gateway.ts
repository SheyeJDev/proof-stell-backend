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
import { LoggingService } from '../../logging/logging.service';
import { NotificationDto } from './dto/notification.dto';
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
 * WebSocket gateway for real-time communication.
 * 
 * This gateway handles real-time updates for leaderboards, game sessions,
 * and user notifications. It uses Socket.IO with JWT authentication and
 * supports room-based subscriptions for targeted updates.
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

  constructor(private readonly loggingService: LoggingService) {}

  // Track connected users for demonstration
  private connectedUsers: Map<string, string> = new Map();

  /**
   * Handles new WebSocket connections.
   * 
   * This method is called when a client connects to the gateway. It validates
   * the JWT token, adds the user to their personal room, and tracks the connection.
   * 
   * @param client - The connected socket instance
   * @throws Will disconnect the client if authentication fails
   * 
   * @example
   * ```typescript
   * // Client automatically joins room: user:{userId}
   * // Server logs connection with socket ID
   * ```
   */
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

  /**
   * Handles WebSocket disconnections.
   * 
   * This method is called when a client disconnects from the gateway.
   * It logs the disconnection and removes the user from the tracking map.
   * 
   * @param client - The disconnected socket instance
   */
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
   * This method adds the client to a leaderboard-specific room, enabling
   * them to receive real-time updates for that leaderboard.
   * 
   * @param client - The socket instance making the request
   * @param data - Object containing the leaderboard ID
   * @returns Object indicating subscription status or error
   * 
   * @example
   * ```typescript
   * // Client-side
   * socket.emit('leaderboard:subscribe', { leaderboardId: 'daily-123' });
   * 
   * // Server response
   * { event: 'subscribed', leaderboardId: 'daily-123' }
   * ```
   */
  @UseGuards(WsJwtGuard)
  @SubscribeMessage('leaderboard:subscribe')
  handleLeaderboardSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { leaderboardId: string },
  ) {
    try {
      if (
        !data ||
        typeof data.leaderboardId !== 'string' ||
        !data.leaderboardId.trim()
      ) {
        return { error: 'Invalid leaderboardId' };
      }
      client.join(`leaderboard:${data.leaderboardId}`);
      return { event: 'subscribed', leaderboardId: data.leaderboardId };
    } catch (err) {
      this.loggingService.error(
        'Error in leaderboard:subscribe',
        err instanceof Error ? err : new Error(String(err)),
        {
          module: 'realtime',
          action: 'leaderboard:subscribe',
        },
      );
      return { error: 'Subscription failed' };
    }
  }

  /**
   * Subscribes a client to game session updates.
   * 
   * This method adds the client to a game-specific room, enabling
   * them to receive real-time updates for that game session.
   * 
   * @param client - The socket instance making the request
   * @param data - Object containing the game ID
   * @returns Object indicating subscription status or error
   * 
   * @example
   * ```typescript
   * // Client-side
   * socket.emit('game:subscribe', { gameId: 'game-abc-123' });
   * 
   * // Server response
   * { event: 'subscribed', gameId: 'game-abc-123' }
   * ```
   */
  @UseGuards(WsJwtGuard)
  @SubscribeMessage('game:subscribe')
  handleGameSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { gameId: string },
  ) {
    try {
      if (!data || typeof data.gameId !== 'string' || !data.gameId.trim()) {
        return { error: 'Invalid gameId' };
      }
      client.join(`game:${data.gameId}`);
      return { event: 'subscribed', gameId: data.gameId };
    } catch (err) {
      this.loggingService.error(
        'Error in game:subscribe',
        err instanceof Error ? err : new Error(String(err)),
        {
          module: 'realtime',
          action: 'game:subscribe',
        },
      );
      return { error: 'Subscription failed' };
    }
  }

  /**
   * Emits a leaderboard update to all subscribed clients.
   * 
   * This method broadcasts leaderboard updates to all clients subscribed
   * to the specific leaderboard room.
   * 
   * @param leaderboardId - The ID of the leaderboard
   * @param scores - Array of score data to broadcast
   * @param updateType - Type of update (score_change, rank_change, new_entry, reset)
   * 
   * @example
   * ```typescript
   * this.realtimeGateway.emitLeaderboardUpdate(
   *   'daily-123',
   *   [{ userId: 1, score: 100, rank: 1 }],
   *   'score_change'
   * );
   * ```
   */
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

  /**
   * Emits a rank change notification to a specific user.
   * 
   * This method sends a personalized rank change update to a user's
   * personal room.
   * 
   * @param userId - The ID of the user to notify
   * @param oldRank - The user's previous rank
   * @param newRank - The user's new rank
   * @param score - The user's current score
   * 
   * @example
   * ```typescript
   * this.realtimeGateway.emitUserRankChange(123, 5, 3, 1500);
   * ```
   */
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

  /**
   * Emits leaderboard statistics to subscribed clients.
   * 
   * This method broadcasts statistical information about a leaderboard
   * to all subscribed clients.
   * 
   * @param leaderboardId - The ID of the leaderboard
   * @param stats - Object containing leaderboard statistics
   * 
   * @example
   * ```typescript
   * this.realtimeGateway.emitLeaderboardStats('daily-123', {
   *   totalPlayers: 100,
   *   averageScore: 750
   * });
   * ```
   */
  emitLeaderboardStats(leaderboardId: string, stats: any) {
    this.server.to(`leaderboard:${leaderboardId}`).emit('leaderboard:stats', {
      leaderboardId,
      stats,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emits a game state change to subscribed clients.
   * 
   * This method broadcasts game state transitions to all clients
   * subscribed to the specific game room.
   * 
   * @param gameId - The ID of the game
   * @param state - The new game state (started, paused, ended)
   * 
   * @example
   * ```typescript
   * this.realtimeGateway.emitGameStateChange('game-abc-123', 'started');
   * ```
   */
  emitGameStateChange(gameId: string, state: 'started' | 'paused' | 'ended') {
    this.server
      .to(`game:${gameId}`)
      .emit('game:state-change', { gameId, state });
  }

  /**
   * Emits a notification to a specific user.
   * 
   * This method sends a notification to a user's personal room.
   * 
   * @param userId - The ID of the user to notify
   * @param message - The notification message
   * @param type - The notification type (info, success, warning, error)
   * @param icon - Optional icon identifier for the notification
   * 
   * @example
   * ```typescript
   * this.realtimeGateway.emitNotification(
   *   '123',
   *   'You earned a new badge!',
   *   'success',
   *   'trophy'
   * );
   * ```
   */
  emitNotification(
    userId: string,
    message: string,
    type: string,
    icon?: string,
  ) {
    this.server
      .to(`user:${userId}`)
      .emit('notification:alert', { message, type, icon });
  }

  /**
   * Handles notification sending from admin clients.
   * 
   * This method allows admin users to send notifications to specific users.
   * It validates the notification payload and checks for admin role.
   * 
   * @param client - The socket instance making the request
   * @param payload - The notification data to send
   * @returns Object indicating send status or error
   * @throws {ValidationError} If the payload fails validation
   * 
   * @example
   * ```typescript
   * // Client-side (admin only)
   * socket.emit('notification:send', {
   *   userId: '123',
   *   message: 'System maintenance in 1 hour',
   *   type: 'warning'
   * });
   * ```
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
        {
          module: 'realtime',
          action: 'notification:send',
        },
      );
      return { error: 'Notification failed' };
    }
  }
}
