# Common Workflow Examples

This document provides code examples for common workflows when integrating with the Proof-Stell backend API.

## Table of Contents

- [User Authentication](#user-authentication)
- [Game Session Management](#game-session-management)
- [Score Submission](#score-submission)
- [Leaderboard Queries](#leaderboard-queries)
- [NFT Minting](#nft-minting)
- [Real-time Updates](#real-time-updates)

---

## User Authentication

### Register a New User

```typescript
const API_BASE = 'https://api.proof-stell.example/api/v1';

async function registerUser(userData: {
  email: string;
  username: string;
  password: string;
  walletAddress?: string;
}) {
  const response = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(userData),
  });

  if (!response.ok) {
    throw new Error(`Registration failed: ${response.statusText}`);
  }

  const data = await response.json();
  
  // User is created but email verification is required
  console.log('User registered. Check email for verification link.');
  console.log('User ID:', data.user.id);
  
  return data;
}

// Usage
const newUser = await registerUser({
  email: 'player@example.com',
  username: 'player123',
  password: 'SecurePass123!',
  walletAddress: '0x1234567890abcdef1234567890abcdef12345678'
});
```

### Login

```typescript
async function login(email: string, password: string) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error(`Login failed: ${response.statusText}`);
  }

  const data = await response.json();
  
  // Store the access token for subsequent requests
  const accessToken = data.access_token;
  localStorage.setItem('accessToken', accessToken);
  
  console.log('Logged in successfully');
  console.log('User:', data.user);
  
  return { accessToken, user: data.user };
}

// Usage
const { accessToken, user } = await login('player@example.com', 'SecurePass123!');
```

### Verify Email

```typescript
async function verifyEmail(token: string) {
  const response = await fetch(`${API_BASE}/auth/verify-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    throw new Error(`Verification failed: ${response.statusText}`);
  }

  console.log('Email verified successfully');
  return true;
}

// Usage (typically called from email link)
await verifyEmail('uuid-verification-token');
```

### Logout

```typescript
async function logout(accessToken: string) {
  const response = await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Logout failed: ${response.statusText}`);
  }

  // Clear stored token
  localStorage.removeItem('accessToken');
  
  console.log('Logged out successfully');
  return true;
}

// Usage
await logout(accessToken);
```

---

## Game Session Management

### Start a Game Session

```typescript
async function startGameSession(accessToken: string, challengeId: string) {
  const response = await fetch(`${API_BASE}/game-sessions/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ challengeId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to start session: ${response.statusText}`);
  }

  const data = await response.json();
  
  // Store the nonce for later reporting
  const { sessionId, nonce } = data;
  localStorage.setItem('currentSessionId', sessionId);
  localStorage.setItem('sessionNonce', nonce);
  
  console.log('Game session started:', sessionId);
  return { sessionId, nonce };
}

// Usage
const { sessionId, nonce } = await startGameSession(
  accessToken,
  'challenge-uuid-here'
);
```

### Report Game Session Results

```typescript
async function reportGameSession(
  accessToken: string,
  sessionId: string,
  nonce: string,
  sessionData: {
    challengeId: string;
    score: number;
    duration: number;
    inputs: Array<{
      eventType: string;
      timestamp: number;
      eventData: any;
      clientId: string;
    }>;
  }
) {
  // Calculate HMAC signature (client-side or server-side)
  const signature = await calculateSessionSignature(nonce, sessionData);
  
  const response = await fetch(`${API_BASE}/game-sessions/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      sessionId,
      challengeId: sessionData.challengeId,
      score: sessionData.score,
      duration: sessionData.duration,
      inputs: sessionData.inputs,
      signature,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to report session: ${response.statusText}`);
  }

  const data = await response.json();
  
  // Clear session data
  localStorage.removeItem('currentSessionId');
  localStorage.removeItem('sessionNonce');
  
  console.log('Game session reported successfully');
  return data;
}

// Helper function to calculate signature
async function calculateSessionSignature(nonce: string, sessionData: any): Promise<string> {
  const dataToHash = {
    challengeId: sessionData.challengeId,
    score: sessionData.score,
    duration: sessionData.duration,
    inputCount: sessionData.inputs.length,
    firstInput: sessionData.inputs[0]?.timestamp || 0,
    lastInput: sessionData.inputs[sessionData.inputs.length - 1]?.timestamp || 0,
  };

  // Use crypto.subtle for HMAC-SHA256
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(nonce),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(nonce + JSON.stringify(dataToHash))
  );
  
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Usage
const sessionData = {
  challengeId: 'challenge-uuid-here',
  score: 1500,
  duration: 60000, // 60 seconds in milliseconds
  inputs: [
    {
      eventType: 'keydown',
      timestamp: 0,
      eventData: { key: 'ArrowUp' },
      clientId: 'client-1'
    },
    // ... more inputs
  ]
};

await reportGameSession(accessToken, sessionId, nonce, sessionData);
```

### Get User's Game Sessions

```typescript
async function getUserSessions(accessToken: string, page = 1, limit = 50) {
  const response = await fetch(
    `${API_BASE}/game-sessions/user?page=${page}&limit=${limit}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch sessions: ${response.statusText}`);
  }

  const data = await response.json();
  console.log(`Found ${data.total} sessions`);
  return data;
}

// Usage
const sessions = await getUserSessions(accessToken, 1, 20);
```

---

## Score Submission

### Submit Score to Leaderboard

```typescript
async function submitScore(accessToken: string, score: number) {
  const response = await fetch(`${API_BASE}/leaderboard/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ score }),
  });

  if (!response.ok) {
    throw new Error(`Failed to submit score: ${response.statusText}`);
  }

  const data = await response.json();
  
  console.log('Score submitted successfully');
  console.log('New rank:', data.rank);
  console.log('Score:', data.score);
  
  return data;
}

// Usage
const result = await submitScore(accessToken, 1500);
```

### Get Global Leaderboard

```typescript
async function getGlobalLeaderboard(page = 1, limit = 50) {
  const response = await fetch(
    `${API_BASE}/leaderboard?page=${page}&limit=${limit}`,
    {
      method: 'GET',
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch leaderboard: ${response.statusText}`);
  }

  const data = await response.json();
  console.log(`Top ${data.leaderboard.length} players`);
  return data;
}

// Usage
const leaderboard = await getGlobalLeaderboard(1, 10);
leaderboard.leaderboard.forEach((entry, index) => {
  console.log(`${index + 1}. ${entry.user.username} - ${entry.score}`);
});
```

### Get User's Leaderboard Entry

```typescript
async function getUserLeaderboardEntry(accessToken: string) {
  const response = await fetch(`${API_BASE}/leaderboard/user`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch entry: ${response.statusText}`);
  }

  const data = await response.json();
  console.log(`Your rank: ${data.rank}, Score: ${data.score}`);
  return data;
}

// Usage
const entry = await getUserLeaderboardEntry(accessToken);
```

---

## Leaderboard Queries

### Poll for Leaderboard Updates

```typescript
async function pollLeaderboardUpdates(
  leaderboardId: string,
  callback: (data: any) => void,
  interval = 5000
) {
  const poll = async () => {
    try {
      const response = await fetch(
        `${API_BASE}/leaderboard?page=1&limit=100`
      );
      
      if (response.ok) {
        const data = await response.json();
        callback(data);
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  };

  // Initial fetch
  await poll();
  
  // Set up interval
  const intervalId = setInterval(poll, interval);
  
  // Return cleanup function
  return () => clearInterval(intervalId);
}

// Usage
const stopPolling = pollLeaderboardUpdates('global', (data) => {
  console.log('Leaderboard updated:', data.leaderboard);
  // Update UI with new data
});

// Stop polling when done
// stopPolling();
```

---

## NFT Minting

### Mint NFT for Achievement

```typescript
async function mintNFT(
  accessToken: string,
  mintData: {
    recipientAddress: string;
    metadata: {
      name: string;
      description: string;
      image: string;
      attributes: Array<{ trait_type: string; value: string }>;
    };
  }
) {
  const response = await fetch(`${API_BASE}/mint`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(mintData),
  });

  if (!response.ok) {
    throw new Error(`Minting failed: ${response.statusText}`);
  }

  const data = await response.json();
  
  console.log('NFT minted successfully');
  console.log('Transaction hash:', data.transactionHash);
  console.log('Token ID:', data.tokenId);
  
  return data;
}

// Usage
const mintResult = await mintNFT(accessToken, {
  recipientAddress: '0x1234567890abcdef1234567890abcdef12345678',
  metadata: {
    name: 'Champion Badge',
    description: 'Awarded for achieving top 10 on the leaderboard',
    image: 'ipfs://QmHash...',
    attributes: [
      { trait_type: 'Rank', value: 'Top 10' },
      { trait_type: 'Score', value: '1500' },
      { trait_type: 'Date', value: '2025-01-15' }
    ]
  }
});
```

### Check Mint Status

```typescript
async function checkMintStatus(accessToken: string, transactionHash: string) {
  const response = await fetch(
    `${API_BASE}/mint/status/${transactionHash}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to check status: ${response.statusText}`);
  }

  const data = await response.json();
  console.log('Mint status:', data.status);
  console.log('Confirmations:', data.confirmations);
  
  return data;
}

// Usage
const status = await checkMintStatus(accessToken, '0xabc123...');
```

---

## Real-time Updates

### Connect to WebSocket Gateway

```typescript
import { io } from 'socket.io-client';

class RealtimeClient {
  private socket: any;

  constructor(accessToken: string) {
    this.socket = io('https://api.proof-stell.example/realtime', {
      auth: { token: accessToken },
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
      // Update UI with new leaderboard data
    });

    this.socket.on('leaderboard:rank-change', (data) => {
      console.log('Your rank changed:', data);
      // Show notification to user
    });

    this.socket.on('game:state-change', (data) => {
      console.log('Game state changed:', data);
      // Update game state in UI
    });

    this.socket.on('notification:alert', (data) => {
      console.log('Notification:', data);
      // Display notification to user
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
const client = new RealtimeClient(accessToken);
client.subscribeToLeaderboard('global');
```

### Handle Leaderboard Updates

```typescript
// In your React component or UI framework
useEffect(() => {
  const client = new RealtimeClient(accessToken);
  
  // Subscribe to leaderboard updates
  client.subscribeToLeaderboard('global');
  
  // Set up custom handler for leaderboard updates
  client.socket.on('leaderboard:update', (data) => {
    setLeaderboard(data.leaderboard);
    setTotalEntries(data.totalEntries);
  });
  
  // Set up handler for rank changes
  client.socket.on('leaderboard:rank-change', (data) => {
    if (data.userId === currentUserId) {
      showNotification(`Your rank changed to ${data.newRank}!`);
    }
  });
  
  // Cleanup on unmount
  return () => {
    client.disconnect();
  };
}, [accessToken, currentUserId]);
```

---

## Complete Workflow Examples

### Complete Game Session Workflow

```typescript
async function completeGameWorkflow(
  email: string,
  password: string,
  challengeId: string
) {
  try {
    // 1. Login
    const { accessToken, user } = await login(email, password);
    console.log('Logged in as:', user.username);

    // 2. Start game session
    const { sessionId, nonce } = await startGameSession(accessToken, challengeId);
    console.log('Session started:', sessionId);

    // 3. Simulate gameplay (collect inputs)
    const inputs = [];
    const startTime = Date.now();
    
    // Simulate 10 seconds of gameplay
    for (let i = 0; i < 10; i++) {
      inputs.push({
        eventType: 'keydown',
        timestamp: Date.now() - startTime,
        eventData: { key: 'ArrowUp' },
        clientId: 'client-1'
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 4. Report session results
    const sessionData = {
      challengeId,
      score: 1500,
      duration: Date.now() - startTime,
      inputs
    };
    
    const sessionResult = await reportGameSession(
      accessToken,
      sessionId,
      nonce,
      sessionData
    );
    console.log('Session reported:', sessionResult);

    // 5. Submit score to leaderboard
    const leaderboardEntry = await submitScore(accessToken, 1500);
    console.log('Leaderboard entry:', leaderboardEntry);

    // 6. Get current rank
    const userEntry = await getUserLeaderboardEntry(accessToken);
    console.log('Final rank:', userEntry.rank);

    // 7. Logout
    await logout(accessToken);
    console.log('Workflow completed successfully');

    return {
      sessionId,
      score: 1500,
      rank: userEntry.rank
    };
  } catch (error) {
    console.error('Workflow failed:', error);
    throw error;
  }
}

// Usage
const result = await completeGameWorkflow(
  'player@example.com',
  'SecurePass123!',
  'challenge-uuid-here'
);
```

### Complete NFT Minting Workflow

```typescript
async function mintAchievementNFT(
  email: string,
  password: string,
  walletAddress: string
) {
  try {
    // 1. Login
    const { accessToken, user } = await login(email, password);
    console.log('Logged in as:', user.username);

    // 2. Submit a high score to qualify for NFT
    const leaderboardEntry = await submitScore(accessToken, 2000);
    console.log('Score submitted:', leaderboardEntry);

    // 3. Check if qualified for NFT (top 10)
    if (leaderboardEntry.rank <= 10) {
      console.log('Qualified for NFT!');

      // 4. Mint NFT
      const mintResult = await mintNFT(accessToken, {
        recipientAddress: walletAddress,
        metadata: {
          name: 'Top 10 Champion',
          description: `Awarded for rank ${leaderboardEntry.rank} on the leaderboard`,
          image: 'ipfs://QmHash...',
          attributes: [
            { trait_type: 'Rank', value: leaderboardEntry.rank.toString() },
            { trait_type: 'Score', value: leaderboardEntry.score.toString() },
            { trait_type: 'Date', value: new Date().toISOString() }
          ]
        }
      });

      console.log('NFT minted:', mintResult.transactionHash);

      // 5. Monitor mint status
      let confirmed = false;
      while (!confirmed) {
        const status = await checkMintStatus(accessToken, mintResult.transactionHash);
        console.log('Mint status:', status.status);
        
        if (status.status === 'confirmed') {
          confirmed = true;
          console.log('NFT confirmed on blockchain!');
        } else {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      return mintResult;
    } else {
      console.log('Not qualified for NFT (rank:', leaderboardEntry.rank, ')');
      return null;
    }
  } catch (error) {
    console.error('NFT workflow failed:', error);
    throw error;
  }
}

// Usage
const nftResult = await mintAchievementNFT(
  'player@example.com',
  'SecurePass123!',
  '0x1234567890abcdef1234567890abcdef12345678'
);
```

---

## Error Handling

### Standard Error Handling

```typescript
async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || `HTTP ${response.status}: ${response.statusText}`
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof Error) {
      console.error('API call failed:', error.message);
      throw error;
    }
    throw new Error('Unknown error occurred');
  }
}

// Usage with error handling
try {
  const user = await apiCall<User>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  console.log('Login successful:', user);
} catch (error) {
  if (error instanceof Error) {
    // Handle specific error types
    if (error.message.includes('401')) {
      console.error('Authentication failed');
    } else if (error.message.includes('429')) {
      console.error('Rate limit exceeded');
    } else {
      console.error('Unexpected error:', error.message);
    }
  }
}
```

### Retry Logic for Transient Errors

```typescript
async function apiCallWithRetry<T>(
  endpoint: string,
  options: RequestInit = {},
  maxRetries = 3,
  delay = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await apiCall<T>(endpoint, options);
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on client errors (4xx)
      if (lastError.message.includes('HTTP 4')) {
        throw lastError;
      }
      
      // Wait before retrying
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
      }
    }
  }

  throw lastError;
}

// Usage
const user = await apiCallWithRetry<User>('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
});
```

---

## TypeScript Types

### Common Type Definitions

```typescript
// API Response Types
interface ApiResponse<T> {
  data: T;
  message?: string;
}

interface User {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  role: string;
  isActive: boolean;
  isEmailVerified: boolean;
  gamesPlayed: number;
  totalScore: number;
  highestScore: number;
  currentStreak: number;
  longestStreak: number;
  createdAt: string;
  updatedAt: string;
}

interface LeaderboardEntry {
  id: number;
  userId: string;
  score: number;
  rank: number;
  user: User;
  createdAt: string;
  updatedAt: string;
}

interface GameSession {
  id: string;
  userId: string;
  challengeId: string;
  score: number;
  duration: number;
  metadata: Record<string, any>;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

interface InputEvent {
  eventType: string;
  timestamp: number;
  eventData: any;
  clientId: string;
}

interface MintResult {
  transactionHash: string;
  tokenId: string;
  contractAddress: string;
  status: 'pending' | 'confirmed' | 'failed';
}
```

---

## Testing Examples

### Testing with Jest

```typescript
describe('User Authentication', () => {
  const API_BASE = 'http://localhost:3000/api/v1';

  test('should register a new user', async () => {
    const userData = {
      email: 'test@example.com',
      username: 'testuser',
      password: 'TestPass123!',
    };

    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.user).toHaveProperty('id');
    expect(data.user.email).toBe(userData.email.toLowerCase());
  });

  test('should login with valid credentials', async () => {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'TestPass123!',
      }),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data).toHaveProperty('access_token');
    expect(data).toHaveProperty('user');
  });
});
```

---

## Notes

- All API endpoints use the `/api/v1` prefix
- Authentication requires a JWT Bearer token in the Authorization header
- WebSocket connections require the JWT token in the auth handshake
- Rate limiting is enforced (10 requests per 60 seconds by default)
- All timestamps are in ISO 8601 format
- IDs are UUID v4 format unless otherwise specified
