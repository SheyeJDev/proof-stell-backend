# 🖥️ ProofStell Backend API

Backend services for the ProofStell decentralized competitive gaming platform — a whack-a-mole game on StarkNet with on-chain leaderboards and wallet-based identity.

---

## 🌍 Overview

The backend is a NestJS REST + WebSocket API that:

- Manages game sessions, scores, badges, and challenges
- Integrates with StarkNet smart contracts for minting and on-chain actions
- Handles JWT-based authentication, role-based access control, and token revocation
- Provides real-time leaderboard and game-state updates over Socket.IO
- Emits analytics events to external providers (PostHog, Mixpanel, Plausible, GA)

---

## 📚 Documentation

| Document | Contents |
|---|---|
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | Module map, request lifecycle, cross-module contracts, data flows |
| **[RUNBOOK.md](RUNBOOK.md)** | Env vars, migrations, observability, scheduled jobs, cache, incident checks |
| **[README-config.md](README-config.md)** | Centralized config system, `TypedConfigService` usage |
| **[SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md)** | Auth, API, data-storage, and dependency security checklist |
| **[SECURITY_AUDIT_REPORT.md](SECURITY_AUDIT_REPORT.md)** | Findings from the last security audit |
| **[CONTRIBUTING.md](CONTRIBUTING.md)** | Branching strategy, commit conventions, contributor checklist |

---

## 🏗️ Architecture Summary

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full module map and data flows.

```
HTTP / WebSocket Clients
        ↓
NestJS (ThrottlerGuard → AuthGuard → ValidationPipe → Controller → Service)
        ↓                    ↓                    ↓
    PostgreSQL            Redis               StarkNet
    (TypeORM)           (Cache +          (BlockchainService,
                       Dist. Lock)          MintService,
                                           WalletProviders)
```

Observability: Winston → Loki · Prometheus → Grafana · alert.rules.yml → Alertmanager

---

## 🛠️ Tech Stack

- NestJS · TypeScript
- PostgreSQL + TypeORM
- Redis (cache + distributed locks)
- Socket.IO (real-time gateway)
- StarkNet SDK · Soroban SDK
- Passport JWT + bcrypt
- Winston + Prometheus + Loki
- Swagger (`/api/docs` in non-production)

---

## 🚀 Getting Started

```bash
npm install

# Copy and fill in required env vars
cp .env.example .env

npm run start:dev
```

See [RUNBOOK.md](RUNBOOK.md) for the full environment variable reference and production startup guide.

---

## 🔐 Security

See [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) and [SECURITY_AUDIT_REPORT.md](SECURITY_AUDIT_REPORT.md).

Key controls:
- JWT access tokens (15 min) with refresh tokens (7 days) and server-side revocation
- bcrypt password hashing (12 rounds by default)
- Global `ThrottlerGuard` (10 req / 60 s per IP); stricter limits on auth endpoints
- `SecurityHeadersMiddleware` applies CSP, HSTS, X-Frame-Options, etc. globally
- CORS origins are env-driven (`ALLOWED_ORIGINS`) — no hardcoded values
- `ValidationPipe` with `whitelist: true` on all endpoints
- Sensitive fields stripped by `ClassSerializerInterceptor` (`@Exclude`)
- Logging redacts passwords, tokens, and other PII fields automatically

---

## 🌐 Supported Locales

The translation module provides first-class locale support with consistent fallback behaviour.

- **Default locale:** Configured by marking exactly one language record with `isDefault = true` in the `languages` table.
- **Validation:** Endpoints that opt in via `LanguageValidationPipe` or `LanguageGuard` reject unknown or inactive locale codes with HTTP 400.
- **Lenient endpoints:** `TranslationInterceptor` and `LanguageMiddleware` silently fall back to the configured default.
- **Coverage check:** `GET /api/v1/translations/:languageCode/missing-translations`
- **Adding a new locale:** Insert a `languages` row, then add translations via `POST /api/v1/translations/bulk`.

---

**ProofStell Backend — Powering decentralized gaming.**


## 🔑 API Flows

- **Login/session** — `POST /auth/login` → `access_token` (15m) + `refresh_token` (7d) → `POST /auth/refresh` before expiry → `POST /auth/logout` or `/auth/logout-all` to revoke. See [ARCHITECTURE.md](ARCHITECTURE.md#api-contract-auth) for the full contract and error payload shape.
- **Wallet** — `connect` → `sign-message` / `send-transaction` (idempotent via `requestId`, chain-validated) → `disconnect`. See [ARCHITECTURE.md](ARCHITECTURE.md#api-contract-wallet).
- **Audit logs** — every `@AuditLog()`-decorated mutation is recorded immutably and queryable at `admin/audit-logs/*` (admin-only). See [ARCHITECTURE.md](ARCHITECTURE.md#api-contract-audit-logs-admin).

## 🧪 Developer Quick-Start: Validating Auth & Wallet Flows

\`\`\`bash
npm install
cp .env.example .env   # fill in JWT_SECRET, JWT_REFRESH_SECRET, DATABASE_URL, REDIS_HOST
npm run start:dev

# 1. Register + verify (dev mail catcher / logs show the token)
curl -X POST localhost:3000/api/v1/auth/register -d '{"email":"a@b.com","password":"..."}' -H 'Content-Type: application/json'

# 2. Login
curl -X POST localhost:3000/api/v1/auth/login -d '{"email":"a@b.com","password":"..."}' -H 'Content-Type: application/json'
# → { access_token, refresh_token }

# 3. Connect a wallet (Bearer token from step 2)
curl -X POST localhost:3000/api/v1/wallet/connect -H 'Authorization: Bearer <access_token>' -d '{"providerName":"argentx"}' -H 'Content-Type: application/json'

# 4. Refresh before the 15m access token expires
curl -X POST localhost:3000/api/v1/auth/refresh -d '{"refresh_token":"<refresh_token>"}' -H 'Content-Type: application/json'
\`\`\`

Full interactive Swagger docs (non-production only): `GET /api/docs`.