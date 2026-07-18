# Database Schema Documentation

## Overview

This document describes the database schema for the Proof-Stell backend, including entity relationships, column constraints, defaults, and indexing strategies.

## Entity Relationship Diagram

```
┌─────────────┐       ┌──────────────┐       ┌─────────────┐
│    User     │───────│ Leaderboard  │       │   Badge     │
│             │ 1   1 │              │       │             │
└─────────────┘       └──────────────┘       └─────────────┘
       │                     │                     │
       │ 1                   │ 1                   │ 1
       │                     │                     │
       │ N                   │ N                   │ N
┌─────────────┐       ┌──────────────┐       ┌─────────────┐
│ GameSession │       │  UserBadge   │       │  Challenge  │
│             │       │              │       │             │
└─────────────┘       └──────────────┘       └─────────────┘
       │
       │ 1
       │
       │ N
┌─────────────┐
│ InputEvent  │
│             │
└─────────────┘
```

## Core Entities

### User

**Table:** `users`

**Description:** Stores user account information, authentication credentials, and game statistics.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| id | UUID | PRIMARY KEY | auto-generated | Unique user identifier |
| email | VARCHAR(254) | UNIQUE, NOT NULL | - | User email address (lowercase) |
| password | VARCHAR | NOT NULL | - | Hashed password (bcrypt) |
| username | VARCHAR(30) | NOT NULL | - | Unique username (alphanumeric + underscore) |
| role | ENUM | NOT NULL | PLAYER | User role (PLAYER, ADMIN, etc.) |
| walletAddress | VARCHAR(255) | NULLABLE | - | Optional StarkNet wallet address |
| isActive | BOOLEAN | - | true | Account active status |
| isEmailVerified | BOOLEAN | - | false | Email verification status |
| emailVerificationToken | VARCHAR(255) | NULLABLE | - | Email verification token |
| emailVerificationExpires | TIMESTAMP | NULLABLE | - | Token expiration timestamp |
| lastLogin | TIMESTAMP | NULLABLE | - | Last successful login timestamp |
| createdAt | TIMESTAMP | - | auto | Account creation timestamp |
| updatedAt | TIMESTAMP | - | auto | Last update timestamp |
| displayName | VARCHAR(50) | NULLABLE | - | Display name for profile |
| avatarUrl | VARCHAR(255) | NULLABLE | - | Avatar image URL |
| emailPreferences | JSONB | NULLABLE | - | Email notification preferences |
| gamesPlayed | INTEGER | - | 0 | Total games played count |
| totalScore | INTEGER | - | 0 | Cumulative score across all games |
| highestScore | INTEGER | - | 0 | Highest single-game score |
| referrals | INTEGER | - | 0 | Number of referrals made |
| currentStreak | INTEGER | - | 0 | Current win streak |
| longestStreak | INTEGER | - | 0 | Longest win streak achieved |

**Indexes:**
- PRIMARY KEY: `id`
- UNIQUE INDEX: `email`
- UNIQUE INDEX: `username`

**Relations:**
- One-to-Many: `gameSessions` → GameSession
- One-to-Many: `userBadges` → UserBadge
- One-to-One: `leaderboard` → Leaderboard

---

### Leaderboard

**Table:** `leaderboard`

**Description:** Stores leaderboard rankings and scores for competitive gameplay.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| id | INTEGER | PRIMARY KEY | auto-generated | Unique entry identifier |
| userId | UUID | UNIQUE, NOT NULL | - | Reference to user |
| score | INTEGER | NOT NULL | 0 | User's current score |
| rank | INTEGER | NOT NULL | 0 | Current ranking position |
| createdAt | TIMESTAMP | - | auto | Entry creation timestamp |
| updatedAt | TIMESTAMP | - | auto | Last update timestamp |

**Indexes:**
- PRIMARY KEY: `id`
- UNIQUE INDEX: `userId`
- INDEX: `score` (for sorting by score)

**Relations:**
- Many-to-One: `user` → User (eager loading enabled)

**Constraints:**
- FOREIGN KEY: `userId` references `users(id)`
- Only higher scores can be submitted (business logic)
- Ranks are recalculated using SQL window functions

---

### GameSession

**Table:** `game_sessions`

**Description:** Stores individual game session data with integrity verification.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| id | UUID | PRIMARY KEY | auto-generated | Unique session identifier |
| userId | UUID | NOT NULL, INDEXED | - | Reference to user |
| challengeId | UUID | NOT NULL, INDEXED | - | Reference to challenge |
| score | INTEGER | - | 0 | Session score |
| duration | INTEGER | - | 0 | Duration in milliseconds |
| metadata | JSONB | NULLABLE | - | Additional session data |
| nonce | VARCHAR(64) | NULLABLE | - | Cryptographic nonce for HMAC verification |
| nonceUsedAt | TIMESTAMP | NULLABLE | - | When nonce was used (prevents replay) |
| isVerified | BOOLEAN | - | false | Session integrity verified status |
| createdAt | TIMESTAMP | - | auto | Session creation timestamp |
| updatedAt | TIMESTAMP | - | auto | Last update timestamp |

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `userId, createdAt` (for user session queries)
- INDEX: `challengeId, createdAt` (for challenge analytics)
- INDEX: `userId` (for foreign key lookups)
- INDEX: `challengeId` (for foreign key lookups)

**Relations:**
- Many-to-One: `user` → User
- Many-to-One: `challenge` → Challenge
- One-to-Many: `inputs` → InputEvent (cascade delete)

**Security Features:**
- Cryptographic nonce for session integrity
- HMAC signature verification on report
- Nonce can only be used once (nonceUsedAt check)

---

### InputEvent

**Table:** `input_events`

**Description:** Stores individual input events within game sessions for anti-cheat analysis.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| id | UUID | PRIMARY KEY | auto-generated | Unique event identifier |
| gameSessionId | UUID | NOT NULL, INDEXED | - | Reference to game session |
| eventType | VARCHAR(50) | NOT NULL | - | Type of input event |
| timestamp | INTEGER | NOT NULL | - | Event timestamp (milliseconds) |
| eventData | JSONB | NULLABLE | - | Event-specific data |
| clientId | VARCHAR(255) | NULLABLE | - | Client identifier for tracking |

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `gameSessionId` (for session event queries)

**Relations:**
- Many-to-One: `gameSession` → GameSession

---

### Badge

**Table:** `badges`

**Description:** Defines available badges that can be awarded to users.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| id | UUID | PRIMARY KEY | auto-generated | Unique badge identifier |
| name | VARCHAR(100) | NOT NULL | - | Badge name |
| description | TEXT | NULLABLE | - | Badge description |
| icon | VARCHAR(255) | NULLABLE | - | Badge icon URL |
| criteria | JSONB | NULLABLE | - | Badge award criteria |
| createdAt | TIMESTAMP | - | auto | Badge creation timestamp |
| updatedAt | TIMESTAMP | - | auto | Last update timestamp |

**Indexes:**
- PRIMARY KEY: `id`
- UNIQUE INDEX: `name`

---

### UserBadge

**Table:** `user_badges`

**Description:** Junction table tracking badges awarded to users.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| id | UUID | PRIMARY KEY | auto-generated | Unique award identifier |
| userId | UUID | NOT NULL, INDEXED | - | Reference to user |
| badgeId | UUID | NOT NULL, INDEXED | - | Reference to badge |
| awardedAt | TIMESTAMP | - | auto | Award timestamp |

**Indexes:**
- PRIMARY KEY: `id`
- UNIQUE INDEX: `userId, badgeId` (prevents duplicate awards)
- INDEX: `userId` (for user badge queries)
- INDEX: `badgeId` (for badge user queries)

**Relations:**
- Many-to-One: `user` → User
- Many-to-One: `badge` → Badge

---

### Challenge

**Table:** `challenges`

**Description:** Defines game challenges available for play.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| id | UUID | PRIMARY KEY | auto-generated | Unique challenge identifier |
| name | VARCHAR(100) | NOT NULL | - | Challenge name |
| description | TEXT | NULLABLE | - | Challenge description |
| difficulty | ENUM | NOT NULL | - | Challenge difficulty level |
| maxScore | INTEGER | NOT NULL | - | Maximum achievable score |
| duration | INTEGER | NOT NULL | - | Challenge duration in seconds |
| isActive | BOOLEAN | - | true | Challenge active status |
| createdAt | TIMESTAMP | - | auto | Challenge creation timestamp |
| updatedAt | TIMESTAMP | - | auto | Last update timestamp |

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `isActive` (for active challenge queries)

**Relations:**
- One-to-Many: `gameSessions` → GameSession

---

## Indexing Strategy

### User Table
- **Primary Index:** `id` (UUID) - for direct user lookups
- **Unique Index:** `email` - for authentication queries
- **Unique Index:** `username` - for profile lookups

### Leaderboard Table
- **Primary Index:** `id` - for direct entry lookups
- **Unique Index:** `userId` - for user leaderboard lookups
- **Non-Unique Index:** `score` - for score-based sorting

### GameSession Table
- **Primary Index:** `id` (UUID) - for direct session lookups
- **Composite Index:** `userId, createdAt` - for user session history
- **Composite Index:** `challengeId, createdAt` - for challenge analytics
- **Single Index:** `userId` - for foreign key joins
- **Single Index:** `challengeId` - for foreign key joins

### InputEvent Table
- **Primary Index:** `id` (UUID) - for direct event lookups
- **Single Index:** `gameSessionId` - for session event queries

### Badge Tables
- **Primary Index:** `id` (UUID) - for direct lookups
- **Unique Index:** `userId, badgeId` - prevents duplicate awards
- **Single Index:** `userId` - user badge queries
- **Single Index:** `badgeId` - badge user queries

## Column Constraints

### NOT NULL Constraints
Critical fields that cannot be empty:
- User: `id`, `email`, `password`, `username`, `role`
- Leaderboard: `id`, `userId`, `score`, `rank`
- GameSession: `id`, `userId`, `challengeId`
- InputEvent: `id`, `gameSessionId`, `eventType`, `timestamp`

### UNIQUE Constraints
Fields that must be unique across the table:
- User: `email`, `username`
- Leaderboard: `userId`
- Badge: `name`
- UserBadge: `userId, badgeId` (composite)

### DEFAULT VALUES
Fields with automatic defaults:
- User: `role` = PLAYER, `isActive` = true, `isEmailVerified` = false, all stats = 0
- Leaderboard: `score` = 0, `rank` = 0
- GameSession: `score` = 0, `duration` = 0, `isVerified` = false

### FOREIGN KEY Constraints
Referential integrity enforced at database level:
- Leaderboard.userId → User.id
- GameSession.userId → User.id
- GameSession.challengeId → Challenge.id
- InputEvent.gameSessionId → GameSession.id
- UserBadge.userId → User.id
- UserBadge.badgeId → Badge.id

## Data Types

### UUID
Used for primary keys and foreign keys:
- Advantages: Globally unique, non-sequential (prevents enumeration)
- Used in: User.id, GameSession.id, InputEvent.id, Badge.id

### INTEGER
Used for numeric data:
- Leaderboard scores and ranks
- Game session scores and durations
- User statistics (gamesPlayed, totalScore, etc.)

### VARCHAR
Used for variable-length strings:
- User email, username, displayName
- Badge names and descriptions
- Challenge names

### JSONB
Used for flexible, structured data:
- User.emailPreferences
- GameSession.metadata
- InputEvent.eventData
- Badge.criteria

### TIMESTAMP
Used for temporal data:
- createdAt, updatedAt (automatic)
- lastLogin, emailVerificationExpires
- nonceUsedAt

### ENUM
Used for fixed sets of values:
- User.role (PLAYER, ADMIN, etc.)
- Challenge.difficulty (EASY, MEDIUM, HARD, etc.)

## Migration Strategy

### Schema Changes
1. Create migration file in `migrations/` directory
2. Use descriptive migration names: `YYYYMMDD_description.sql`
3. Include both UP and DOWN migrations
4. Test migrations on development database first

### Example Migration
```sql
-- migrations/20250106_add_user_avatar_index.sql

-- UP
CREATE INDEX idx_users_avatar_url ON users(avatarUrl) WHERE avatarUrl IS NOT NULL;

-- DOWN
DROP INDEX idx_users_avatar_url;
```

### Index Creation
- Create indexes for frequently queried columns
- Use partial indexes for nullable columns
- Consider composite indexes for multi-column queries
- Monitor index usage and remove unused indexes

## Performance Considerations

### Query Optimization
- Use indexed columns in WHERE clauses
- Avoid SELECT * - specify only needed columns
- Use JOINs instead of subqueries when possible
- Consider denormalization for frequently accessed data

### Caching Strategy
- Cache user profiles (TTL: 1 hour)
- Cache leaderboard rankings (TTL: 5 minutes)
- Cache challenge data (TTL: 1 hour)
- Invalidate cache on data updates

### Connection Pooling
- Configure appropriate pool size based on load
- Monitor connection pool metrics
- Use read replicas for read-heavy workloads

## Security Considerations

### Data Protection
- Passwords hashed with bcrypt (never stored in plain text)
- Email verification tokens expire after 24 hours
- Nonces for session integrity prevent replay attacks
- Sensitive fields excluded from API responses (@Exclude decorator)

### Access Control
- Row-level security via application logic
- Role-based access control (RBAC, @RolesGuard)
- Audit logging for sensitive operations
- Rate limiting on authentication endpoints

### Backup Strategy
- Daily database backups
- Point-in-time recovery enabled
- Backup retention: 30 days
- Regular backup restoration testing

## Monitoring

### Key Metrics
- Database connection pool utilization
- Query execution time (slow query log)
- Index hit ratio
- Table bloat (vacuum analysis)
- Lock contention

### Alerts
- High connection pool usage (>80%)
- Slow queries (>1 second)
- Failed transactions
- Replication lag (if using replicas)

## Maintenance

### Regular Tasks
- Weekly: ANALYZE tables for query optimization
- Monthly: VACUUM to reclaim storage
- Quarterly: Review and optimize indexes
- As needed: Update statistics after bulk operations

### Cleanup Tasks
- Archive old game sessions (>90 days)
- Clean up expired email verification tokens
- Remove soft-deleted records (>6 months)
- Compact JSONB columns

## Notes

- The database uses PostgreSQL as the primary RDBMS
- TypeORM is used as the ORM for entity management
- All timestamps are stored in UTC
- JSONB columns are indexed using GIN indexes for complex queries
- Foreign key constraints are enforced at the database level
