# Operational Runbook

Canonical reference for running, observing, and debugging the ProofStell backend in any environment.

> Related docs: [Architecture](ARCHITECTURE.md) · [Security](SECURITY_CHECKLIST.md) · [Config](README-config.md)

---

## Environment Variables

All variables are validated at startup by `src/common/config/validation.ts`. The app refuses to start if a required variable is missing or malformed.

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | | `development` | `development` \| `production` \| `test` |
| `PORT` | | `3000` | HTTP listen port |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | — | ≥ 32-char secret for JWT signing |
| `JWT_ISSUER` | | `proof-stell-backend` | JWT `iss` claim |
| `JWT_AUDIENCE` | | `proof-stell-client` | JWT `aud` claim |
| `JWT_ACCESS_TTL` | | `15m` | Access token TTL (e.g. `15m`, `1h`) |
| `JWT_REFRESH_TTL` | | `7d` | Refresh token TTL |
| `BCRYPT_SALT_ROUNDS` | | `12` | bcrypt work factor |
| `REDIS_HOST` | | `localhost` | Redis host |
| `REDIS_PORT` | | `6379` | Redis port |
| `MAIL_HOST` | ✅ | — | SMTP host |
| `MAIL_PORT` | | `587` | SMTP port |
| `MAIL_USER` | ✅ | — | SMTP username |
| `MAIL_PASS` | ✅ | — | SMTP password or API key |
| `MAIL_FROM` | ✅ | — | Default sender address |
| `STARKNET_PRIVATE_KEY` | ✅ | — | StarkNet signer private key |
| `STARKNET_ACCOUNT_ADDRESS` | ✅ | — | StarkNet account address |
| `MINT_CONTRACT_ADDRESS` | ✅ | — | NFT mint contract address |
| `ALLOWED_ORIGINS` | | `http://localhost:3000` | Comma-separated CORS origins |
| `CORS_ENABLED` | | `true` | Enable CORS |
| `LEADERBOARD_RECALCULATION_STRATEGY` | | `batch` | `batch` or `realtime` |
| `AUTH_MAX_FAILED_ATTEMPTS` | | `5` | Lockout threshold |
| `AUTH_LOCKOUT_DURATION_SECONDS` | | `900` | Lockout window |
| `AUTH_ATTEMPT_WINDOW_SECONDS` | | `900` | Attempt counting window |
| `CRON_LOCK_TTL_MS` | | `300000` | Distributed cron lock TTL |
| `SCHEDULER_INSTANCE_ID` | | — | Unique ID for multi-instance cron coordination |
| `ANALYTICS_ENABLED` | | `false` | Enable external analytics fan-out |
| `POSTHOG_API_KEY` | | — | PostHog write key |
| `MIXPANEL_TOKEN` | | — | Mixpanel project token |
| `PLAUSIBLE_DOMAIN` | | — | Plausible site domain |
| `GA_MEASUREMENT_ID` | | — | Google Analytics measurement ID |

---

## Database Migrations

The project uses hand-authored SQL migrations stored in `migrations/`.

```bash
# Apply all pending migrations
psql "$DATABASE_URL" -f migrations/20250906_add_indexes.sql

# Never rely on TypeORM synchronize in production
# DB_SYNC must not be set to true outside development
```

- Migrations are sequential and filename-prefixed by date.
- Always create a new migration file — never modify an existing one.
- Test migrations against a copy of the production schema before deploying.

---

## Running the Application

```bash
# Install
npm install

# Development (hot reload)
npm run start:dev

# Production build
npm run build
npm run start:prod

# Tests
npm run test
npm run test:e2e
```

Swagger UI is available at `http://localhost:3000/api/docs` in non-production environments.

---

## Observability Stack

The `docker-compose.observability.yml` file spins up the full observability stack:

```bash
docker compose -f docker-compose.observability.yml up -d
```

| Component | Port | Purpose |
|---|---|---|
| Prometheus | 9090 | Metric scraping (pull from `/metrics`) |
| Loki | 3100 | Log aggregation |
| Promtail | — | Log shipping from Winston output |
| Alertmanager | 9093 | Alert routing (`alertmanager.yml`) |
| Grafana | 3000\* | Dashboards |

\* Adjust if the app also runs on 3000.

**Metrics endpoint:** `GET /metrics` (Prometheus format, exposed by `@willsoto/nestjs-prometheus`).

**Log format:** Winston emits structured JSON. Each log line carries `requestId`, `userId`, `route`, and redacted field list.

**Alert rules:** `alert.rules.yml` — covers high error rate, slow queries, and failed cron jobs.

---

## Scheduled Jobs

All cron jobs use `@nestjs/schedule` with a Redis distributed lock (TTL = `CRON_LOCK_TTL_MS`) to prevent duplicate execution across instances.

| Job | Schedule | Service | Purpose |
|---|---|---|---|
| Daily challenge generation | Midnight UTC | `ChallengeGenerationService` | Creates next day's challenge set |
| Scheduled challenge activation | Configurable | `ScheduledChallengeService` | Activates/deactivates timed challenges |
| Difficulty profile update | Post-session | `DynamicDifficultyService` | Adjusts per-user difficulty |

To add a new job:
1. Decorate with `@Cron(...)` in a service.
2. Acquire `DistributedLockService.acquire(lockKey, ttl)` at the top of the handler.
3. Release the lock in a `finally` block.
4. Log job start/end/error via `LoggingService`.

---

## Cache Behavior

Redis is used for two purposes:

1. **Response cache** — `CacheInterceptor` stores serialized HTTP responses keyed by `<module>:<entity>:<id>`. Entries are invalidated explicitly on mutation (not by TTL alone).
2. **Distributed lock** — `DistributedLockService` uses `SET NX PX` for cron and idempotency use cases.

Cache key convention: `<module>:<entity-type>:<identifier>` (e.g. `leaderboard:global:top100`).

To bust the cache manually (incident recovery):
```bash
redis-cli -h $REDIS_HOST -p $REDIS_PORT FLUSHDB  # ⚠️ clears everything
# Prefer targeted deletion:
redis-cli -h $REDIS_HOST -p $REDIS_PORT DEL "leaderboard:global:top100"
```

---

## Incident Checks

### App won't start
- Check all required env vars are set.
- Check `DATABASE_URL` is reachable (`psql "$DATABASE_URL" -c '\l'`).
- Check Redis is reachable (`redis-cli -h $REDIS_HOST ping`).
- Confirm `HealthService.assertStartupDependencies()` logs for details.

### 401 Unauthorized on all requests
- Verify `JWT_SECRET` matches the value used to sign tokens.
- Check token expiry (`JWT_ACCESS_TTL`).
- Verify the token is not in the revocation blacklist (`JwtSecurityService`).

### Rate limit errors (429)
- Default: 10 requests per 60 seconds per IP.
- Adjust via `ThrottlerModule` config in `AppModule`.

### Cron job running on every instance
- Verify `SCHEDULER_INSTANCE_ID` is unique per pod/container.
- Verify Redis lock TTL (`CRON_LOCK_TTL_MS`) exceeds the job's runtime.

### Stale leaderboard data
- Cache entries may need manual invalidation. See Cache Behavior above.
- Check `LEADERBOARD_RECALCULATION_STRATEGY` value.

### High error rate on wallet endpoints
- Check StarkNet RPC endpoint availability.
- Review `WalletErrorInterceptor` logs for provider-specific errors.
- Wallet retries use exponential backoff — check for persistent network partition.

---

## Health Probe

`GET /api/v1/health` — returns 200 when all dependencies are up, 503 otherwise. Use this as a Kubernetes liveness/readiness probe.


---

## JWT Secret Rotation

### Overview

JWT tokens are signed with `JWT_SECRET`. If this secret is compromised, all existing tokens must be invalidated immediately. The app supports a versioned key rotation strategy to allow a zero-downtime rotation window.

### Key Versioning

To support gradual rotation without immediately invalidating all active sessions:

1. **Add a new secret variable** alongside the existing one:
   - `JWT_SECRET` — current signing key (used to sign new tokens)
   - `JWT_SECRET_PREVIOUS` — previous signing key (accepted for verification until the rotation window expires)

2. **Update `JwtModule` configuration** in `src/auth/auth.module.ts` to verify tokens against both keys:
   ```typescript
   // Pseudocode — adapt to your jwt.strategy.ts verify logic
   const verifySecret = (token: string) => {
     try {
       return jwt.verify(token, process.env.JWT_SECRET);
     } catch {
       // Fallback to previous key during rotation window
       return jwt.verify(token, process.env.JWT_SECRET_PREVIOUS);
     }
   };
   ```

3. **Set a rotation window** — run both secrets in parallel for the duration of `JWT_ACCESS_TTL` (default 15 minutes). After the window expires, remove `JWT_SECRET_PREVIOUS`.

### Step-by-Step Rotation Procedure

```bash
# 1. Generate a new secret (minimum 32 characters, cryptographically random)
NEW_SECRET=$(openssl rand -hex 32)

# 2. In your secrets manager / environment config:
#    - Set JWT_SECRET_PREVIOUS = current value of JWT_SECRET
#    - Set JWT_SECRET = $NEW_SECRET

# 3. Deploy the updated environment config (rolling deploy recommended)

# 4. Wait for JWT_ACCESS_TTL (default 15 minutes) — all old tokens will expire
#    or be re-issued using the new secret

# 5. After the rotation window: remove JWT_SECRET_PREVIOUS from config

# 6. Deploy again to remove the previous-key fallback
```

### Emergency Rotation (Secret Compromise)

If `JWT_SECRET` is confirmed compromised:

1. **Immediately** set `JWT_SECRET` to a new value and deploy — this invalidates **all** active tokens.
2. Clear the token revocation blacklist in Redis if populated (`redis-cli DEL jwt:blacklist:*`).
3. Notify users that all sessions have been terminated and they must log in again.
4. Audit `JwtSecurityService` logs for suspicious token usage before the rotation.

### Rotation Checklist

- [ ] New secret is at least 32 characters and generated from a CSPRNG
- [ ] `JWT_SECRET_PREVIOUS` set and deployed before changing `JWT_SECRET`
- [ ] Verified token verification falls back to previous key correctly
- [ ] Rotation window (= `JWT_ACCESS_TTL`) has elapsed before removing `JWT_SECRET_PREVIOUS`
- [ ] Alert rules updated to detect unusual 401 spike post-rotation
- [ ] Rotation event logged in audit trail
