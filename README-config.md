

# ⚙️ Centralized Configuration Management

## 📌 Overview

This project implements a **centralized, type-safe configuration system** built on top of `@nestjs/config`. It ensures all environment variables are:

* ✅ Loaded consistently across environments
* ✅ Validated at startup (fail-fast safety)
* ✅ Strongly typed for developer confidence
* ✅ Accessed through a single injectable service

This approach eliminates scattered `process.env` usage and improves **security, maintainability, and scalability**.

---

## 🧠 Architecture

The configuration system is organized under:

```
src/common/config/
```

### 📁 Core Components

* **`configuration.ts`**

  * Maps environment variables into structured config objects
  * Normalizes raw `.env` values

* **`validation.ts`**

  * Uses **Joi schema validation**
  * Ensures required environment variables exist and are valid

* **`typed-config.service.ts`**

  * Strongly typed, injectable config service
  * Single source of truth for accessing config values

---

## 🌍 Environment Strategy

The application supports **multi-environment configuration**:

| File               | Purpose                       |
| ------------------ | ----------------------------- |
| `.env`             | Shared fallback values        |
| `.env.development` | Local development settings    |
| `.env.production`  | Production-safe configuration |

### 🔄 Loading Priority

1. `.env.<NODE_ENV>` (highest priority)
2. `.env`
3. System environment variables

> If `NODE_ENV=production`, `.env.production` is used automatically.

---

## 🚀 How It Works

1. NestJS loads environment variables via `ConfigModule`
2. Variables are validated using **Joi schema**
3. Raw values are mapped inside `configuration.ts`
4. `TypedConfigService` exposes safe, typed accessors
5. Services inject config instead of using `process.env`

---

## 🧩 Adding a New Configuration Value

To safely add a new environment variable:

### 1. Define it in `.env` files

```env
NEW_FEATURE_FLAG=true
```

### 2. Add validation (`validation.ts`)

```ts
NEW_FEATURE_FLAG: Joi.boolean().required(),
```

### 3. Map it in `configuration.ts`

```ts
newFeatureFlag: process.env.NEW_FEATURE_FLAG === 'true',
```

### 4. Add to config interface

```ts
export interface AppConfig {
  newFeatureFlag: boolean;
}
```

### 5. Expose via service

```ts
get newFeatureFlag(): boolean {
  return this.config.newFeatureFlag;
}
```

### 6. Use anywhere in the app

```ts
this.configService.newFeatureFlag;
```

---

## 📊 Environment Variables Reference

| Variable                             | Description                                                   |
| ------------------------------------ | ------------------------------------------------------------- |
| `NODE_ENV`                           | Application environment (`development`, `production`, `test`) |
| `PORT`                               | HTTP server port                                              |
| `DATABASE_URL`                       | Primary database connection string                            |
| `JWT_SECRET`                         | Secret used for JWT signing & verification                    |
| `BCRYPT_SALT_ROUNDS`                 | Password hashing strength configuration                       |
| `LEADERBOARD_RECALCULATION_STRATEGY` | Strategy for recomputing leaderboard scores                   |
| `REDIS_HOST`                         | Redis cache host                                              |
| `REDIS_PORT`                         | Redis cache port                                              |
| `MAIL_HOST`                          | SMTP server host                                              |
| `MAIL_PORT`                          | SMTP server port                                              |
| `MAIL_USER`                          | SMTP username                                                 |
| `MAIL_PASS`                          | SMTP password or API key                                      |
| `MAIL_FROM`                          | Default sender identity                                       |
| `STARKNET_PRIVATE_KEY`               | StarkNet signer private key                                   |
| `STARKNET_ACCOUNT_ADDRESS`           | StarkNet account address                                      |
| `MINT_CONTRACT_ADDRESS`              | Smart contract address for minting                            |
| `ALLOWED_ORIGINS`                    | Comma-separated list of allowed CORS origins                  |
| `CORS_ENABLED`                       | Enable or disable CORS (default: `true`)                      |

---

## 🔐 Security Best Practices

* ❌ Never commit `.env` files to version control
* ❌ Never hardcode secrets inside codebase
* ✅ Always use `TypedConfigService` for access
* ✅ Validate all environment variables at startup
* ✅ Rotate secrets regularly in production

---

## 💡 Example Usage

### Injectable Config Access

```ts
import { Injectable } from '@nestjs/common';
import { TypedConfigService } from 'src/common/config/typed-config.service';

@Injectable()
export class MyService {
  constructor(private readonly config: TypedConfigService) {}

  getJwtSecret(): string {
    return this.config.jwtSecret;
  }
}
```

---

## 🧱 Why This Approach Matters

This system provides:

* 🔒 **Security** → No unsafe runtime env access
* 🧠 **Type Safety** → Compile-time guarantees
* ⚡ **Developer Experience** → Clean dependency injection
* 🧪 **Testability** → Easy mocking of config service
* 📦 **Scalability** → Works across monorepos & microservices


---

### Additional Auth/Wallet Environment Variables

| Variable | Description |
|---|---|
| `JWT_ACCESS_TOKEN_TTL` | Access token lifetime (default `15m`) |
| `JWT_REFRESH_TOKEN_TTL` | Refresh token lifetime (default `7d`) |
| `JWT_REFRESH_SECRET` | Separate signing secret for refresh tokens (never reuse `JWT_SECRET`) |

## 🔐 Security Caveats

- `JWT_SECRET` / `JWT_REFRESH_SECRET` must be distinct, high-entropy values, rotated on any suspected leak — rotation invalidates all outstanding refresh tokens.
- `BCRYPT_SALT_ROUNDS` below 10 is rejected by validation; 12 is the recommended production default.
- `STARKNET_PRIVATE_KEY` must never be committed or logged — `LoggingInterceptor` redacts it by field name, but any new log call must not interpolate it manually.
- `ALLOWED_ORIGINS` should be an explicit comma-separated allowlist in production; leaving `CORS_ENABLED` on with a wildcard origin defeats the credentialed-cookie/JWT model used by `/auth`.
- Redis (`REDIS_HOST`/`REDIS_PORT`) backs both the response cache and the JWT revocation blacklist — if Redis is unreachable, revoked tokens may be treated as valid until Redis recovers (fails open); `HealthService.assertStartupDependencies()` blocks boot if Redis is unreachable at startup, but does not re-check at runtime.