# Real-Time WebSocket Gateway

> Auth model and security controls: [ARCHITECTURE.md](../../ARCHITECTURE.md) · [SECURITY_CHECKLIST.md](../../SECURITY_CHECKLIST.md)

**Namespace:** `/realtime`  
**Transport:** Socket.IO (ws / wss)  
**Auth:** Pass a valid JWT as `auth.token` in the Socket.IO handshake options. The gateway validates the token on every connection using `JwtWsGuard`.

---

## Overview

The RealtimeGateway provides real-time communication for leaderboards, game sessions, and user notifications using Socket.IO. It supports room-based subscriptions for targeted updates and JWT authentication for secure connections.

### Connection Details

- **Namespace:** `/realtime`
- **Authentication:** JWT token via `auth.token` in handshake
- **CORS:** Configured via `CORS_ENABLED` and `ALLOWED_ORIGINS` environment variables
- **Rooms:** 
  - `user:{userId}` - Personal room for each authenticated user
  - `leaderboard:{leaderboardId}` - Leaderboard-specific updates
  - `game:{gameId}` - Game session-specific updates

---

## Server → Client Events

### `leaderboard:update`

Emitted when leaderboard data changes. Clients subscribed to the leaderboard room receive this event.

**Schema:**
```typescript
{
  leaderboardId: string;
  scores: Array<{
    userId: number;
    username: string;
    score: number;
    rank: number;
  }>;
  updateType: 'score_change' | 'rank_change' | 'new_entry' | 'reset';
  timestamp: string; // ISO 8601
  totalEntries: number;
}
```

**Example Payload:**
```json
{
  "leaderboardId": "daily-123",
  "scores": [
    {
      "userId": 1,
      "username": "player1",
      "score": 1500,
      "rank": 1
    },
    {
      "userId": 2,
      "username": "player2",
      "score": 1400,
      "rank": 2
    }
  ],
  "updateType": "score_change",
  "timestamp": "2026-07-18T09:30:00.000Z",
  "totalEntries": 2
}
```

**Subscription Pattern:**
```typescript
socket.emit('leaderboard:subscribe', { leaderboardId: 'daily-123' });
socket.on('leaderboard:update', (data) => {
  console.log('Leaderboard updated:', data.scores);
});
```

---

### `leaderboard:rank-change`

Emitted to a specific user when their rank changes. Sent to the user's personal room.

**Schema:**
```typescript
{
  userId: string;
  oldRank: number;
  newRank: number;
  score: number;
  timestamp: string; // ISO 8601
}
```

**Example Payload:**
```json
{
  "userId": "123",
  "oldRank": 5,
  "newRank": 3,
  "score": 1500,
  "timestamp": "2026-07-18T09:30:00.000Z"
}
```

**Emission Pattern:**
```typescript
// Automatically received when subscribed to user:{userId} room
socket.on('leaderboard:rank-change', (data) => {
  console.log(`Rank changed from ${data.oldRank} to ${data.newRank}`);
});
```

---

### `leaderboard:stats`

Emitted with leaderboard statistics to subscribed clients.

**Schema:**
```typescript
{
  leaderboardId: string;
  stats: {
    totalPlayers: number;
    averageScore: number;
    topScore: number;
    // Additional stats as needed
  };
  timestamp: string; // ISO 8601
}
```

**Example Payload:**
```json
{
  "leaderboardId": "daily-123",
  "stats": {
    "totalPlayers": 100,
    "averageScore": 750,
    "topScore": 1500
  },
  "timestamp": "2026-07-18T09:30:00.000Z"
}
```

---

### `game:state-change`

Emitted when a game session state changes. Clients subscribed to the game room receive this event.

**Schema:**
```typescript
{
  gameId: string;
  state: 'started' | 'paused' | 'ended';
}
```

**Example Payload:**
```json
{
  "gameId": "game-abc-123",
  "state": "started"
}
```

**Subscription Pattern:**
```typescript
socket.emit('game:subscribe', { gameId: 'game-abc-123' });
socket.on('game:state-change', (data) => {
  console.log(`Game ${data.gameId} is now ${data.state}`);
});
```

---

### `notification:alert`

Emitted to a specific user for in-app notifications. Sent to the user's personal room.

**Schema:**
```typescript
{
  message: string;
  type: string; // 'info' | 'success' | 'warning' | 'error'
  icon?: string;
}
```

**Example Payload:**
```json
{
  "message": "You earned a new badge!",
  "type": "success",
  "icon": "trophy"
}
```

**Emission Pattern:**
```typescript
// Automatically received when subscribed to user:{userId} room
socket.on('notification:alert', (data) => {
  console.log(`[${data.type}] ${data.message}`);
});
```

---

## Client → Server Messages

### `leaderboard:subscribe`

Subscribe to leaderboard updates for a specific leaderboard.

**Request Schema:**
```typescript
{
  leaderboardId: string;
}
```

**Response Schema:**
```typescript
// Success
{
  event: 'subscribed';
  leaderboardId: string;
}

// Error
{
  error: string;
}
```

**Example:**
```typescript
socket.emit('leaderboard:subscribe', { leaderboardId: 'daily-123' });
```

---

### `game:subscribe`

Subscribe to game session updates for a specific game.

**Request Schema:**
```typescript
{
  gameId: string;
}
```

**Response Schema:**
```typescript
// Success
{
  event: 'subscribed';
  gameId: string;
}

// Error
{
  error: string;
}
```

**Example:**
```typescript
socket.emit('game:subscribe', { gameId: 'game-abc-123' });
```

---

### `notification:send` (Admin Only)

Send a notification to a specific user. Only available to users with admin role.

**Request Schema:**
```typescript
{
  userId: string;
  message: string;
  type: string;
  icon?: string;
}
```

**Response Schema:**
```typescript
// Success
{
  status: 'sent';
}

// Error
{
  error: string;
  details?: ValidationError[];
}
```

**Example:**
```typescript
socket.emit('notification:send', {
  userId: '123',
  message: 'System maintenance in 1 hour',
  type: 'warning'
});
```

---

## Sample Client Implementation

```typescript
import { io, Socket } from 'socket.io-client';

class RealtimeClient {
  private socket: Socket;

  constructor(jwtToken: string) {
    this.socket = io('http://localhost:3000/realtime', {
      auth: { token: jwtToken },
      transports: ['websocket'],
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.socket.on('connect', () => {
      console.log('Connected to realtime gateway');
    });

    this.socket.on('connect_error', (err) => {
      console.error('Connection failed:', err.message);
    });

    this.socket.on('leaderboard:update', (data) => {
      console.log('Leaderboard updated:', data);
    });

    this.socket.on('leaderboard:rank-change', (data) => {
      console.log('Your rank changed:', data);
    });

    this.socket.on('game:state-change', (data) => {
      console.log('Game state changed:', data);
    });

    this.socket.on('notification:alert', (data) => {
      console.log('Notification:', data);
    });
  }

  subscribeToLeaderboard(leaderboardId: string) {
    this.socket.emit('leaderboard:subscribe', { leaderboardId });
  }

  subscribeToGame(gameId: string) {
    this.socket.emit('game:subscribe', { gameId });
  }

  disconnect() {
    this.socket.disconnect();
  }
}

// Usage
const client = new RealtimeClient('your_jwt_token');
client.subscribeToLeaderboard('daily-123');
```

---

## Emitting Events from Services

Inject `RealtimeGateway` and call the typed emit helpers:

```typescript
import { RealtimeGateway } from '../common/gateways/realtime.gateway';

@Injectable()
export class LeaderboardService {
  constructor(
    private readonly gateway: RealtimeGateway,
  ) {}

  async submitScore(userId: string, score: number) {
    // ... submit logic ...

    // Emit leaderboard update
    this.gateway.emitLeaderboardUpdate(
      leaderboardId,
      scores,
      'score_change'
    );

    // Emit rank change to specific user
    this.gateway.emitUserRankChange(userId, oldRank, newRank, score);
  }
}
```

**Available Emit Methods:**
- `emitLeaderboardUpdate(leaderboardId, scores, updateType)` - Broadcast to leaderboard room
- `emitUserRankChange(userId, oldRank, newRank, score)` - Send to user's personal room
- `emitLeaderboardStats(leaderboardId, stats)` - Broadcast stats to leaderboard room
- `emitGameStateChange(gameId, state)` - Broadcast to game room
- `emitNotification(userId, message, type, icon)` - Send to user's personal room

---

## Security Considerations

- All connections require valid JWT authentication
- Admin-only messages (e.g., `notification:send`) verify user role
- Room names follow pattern: `user:{userId}`, `leaderboard:{id}`, `game:{id}`
- Never trust client-side data; validate all incoming payloads
- Use `WsJwtGuard` for authentication on all message handlers

---

## Error Handling

Common errors and their meanings:

| Error | Cause | Solution |
|---|---|---|
| `Unauthorized` | Invalid or expired JWT token | Refresh token and reconnect |
| `Invalid leaderboardId` | Missing or invalid leaderboard ID | Ensure leaderboardId is a non-empty string |
| `Invalid gameId` | Missing or invalid game ID | Ensure gameId is a non-empty string |
| `Subscription failed` | Internal server error | Check server logs and retry |

---

## Testing

Use the Socket.IO client tester or Postman to test events:

1. Connect with valid JWT token
2. Subscribe to desired rooms
3. Emit events from server-side services
4. Verify event reception on client

---

## Performance Considerations

- Use room-based subscriptions to minimize broadcast traffic
- Implement debouncing for high-frequency updates (e.g., leaderboard updates)
- Monitor room sizes to prevent memory issues
- Consider implementing rate limiting for subscription requests
