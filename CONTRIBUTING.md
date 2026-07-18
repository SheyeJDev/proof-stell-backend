# Contributing to Proof-Stell Backend

Welcome to the Proof-Stell Backend — the decentralized backend service behind Proof-Stell, a competitive whack-a-mole game built on StarkNet. By leveraging smart contracts, on-chain leaderboards, and wallet-based identity, Proof-Stell offers a fair, fun, and verifiable gaming experience for everyone.

Before you code, read the canonical docs:
- [ARCHITECTURE.md](ARCHITECTURE.md) — module map, request lifecycle, cross-module contracts
- [RUNBOOK.md](RUNBOOK.md) — env vars, migrations, observability, scheduled jobs
- [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) — security requirements for every PR
- [README-config.md](README-config.md) — how to add and access config values

---

## Setup

```bash
git clone https://github.com/Proof-Stell/proof-stell-backend
cd proof-stell-backend
npm install
cp .env.example .env   # fill in required vars (see RUNBOOK.md)
npm run start:dev
```

App: `http://localhost:3000` · Swagger: `http://localhost:3000/api/docs`

---

## Git Workflow

**Branches:**

| Prefix | Purpose |
|---|---|
| `main` | Production-ready releases |
| `develop` | Latest tested features |
| `feat/*` | New features |
| `fix/*` | Bug fixes |
| `docs/*` | Documentation only |
| `chore/*` | Maintenance / tooling |

**Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add leaderboard endpoint
fix: resolve wallet auth bug
docs: update architecture guide
chore: update dependencies
```

---

## Code Style

- Idiomatic TypeScript; strict mode enabled.
- NestJS conventions: service → controller → module layering.
- Use `TypedConfigService` for all env access — never `process.env` directly.
- Run `npm run lint` before committing.

---

## TypeScript/JSDoc Style Guide

### JSDoc Requirements

All public service methods, controllers, DTOs, and complex functions must include comprehensive JSDoc comments.

### Class Documentation

Every class should have a class-level JSDoc comment describing its purpose.

```typescript
/**
 * Service for managing user authentication and authorization.
 * 
 * This service handles user registration, login, token generation,
 * and password management. It integrates with JWT for token-based
 * authentication and bcrypt for password hashing.
 * 
 * @example
 * ```typescript
 * const authService = new AuthService(usersRepository, jwtService);
 * const { accessToken } = await authService.login(email, password);
 * ```
 */
@Injectable()
export class AuthService {
  // ...
}
```

### Method Documentation

Every public method must include:

- Description of what the method does
- `@param` tags for all parameters with types and descriptions
- `@returns` tag describing the return value and type
- `@throws` tag for exceptions that may be thrown
- `@example` tag for complex methods

```typescript
/**
 * Authenticates a user with email and password.
 * 
 * This method validates the user's credentials, generates a JWT token,
 * and returns the authentication response with access token and user data.
 * 
 * @param email - The user's email address
 * @param password - The user's plain-text password
 * @returns Promise containing the authentication response with access token
 * @throws {UnauthorizedException} If credentials are invalid
 * @throws {NotFoundException} If user does not exist
 * 
 * @example
 * ```typescript
 * const result = await authService.login('user@example.com', 'password123');
 * console.log(result.accessToken);
 * ```
 */
async login(email: string, password: string): Promise<AuthResponseDto> {
  // ...
}
```

### Parameter Documentation

- Use descriptive parameter names
- Include type information in `@param` tags
- Describe what the parameter represents
- Note any constraints or validation rules

```typescript
/**
 * @param userId - The unique identifier of the user (must be positive integer)
 * @param options - Configuration options for the operation
 * @param options.includeDeleted - Whether to include soft-deleted records
 * @param options.limit - Maximum number of results to return (default: 10)
 */
```

### Return Value Documentation

- Describe the structure of the return value
- Include type information in `@returns` tag
- Note any special cases (e.g., `null` if not found)

```typescript
/**
 * @returns Promise containing the user data or undefined if not found
 * @returns Promise<UserDto> - The user object with profile information
 */
```

### Exception Documentation

- Document all exceptions that may be thrown
- Include the exception type and when it's thrown

```typescript
/**
 * @throws {UnauthorizedException} If the user lacks required permissions
 * @throws {BadRequestException} If the request data is invalid
 * @throws {NotFoundException} If the requested resource does not exist
 */
```

### DTO Documentation

All DTOs should document their purpose and each field.

```typescript
/**
 * Data transfer object for user registration.
 * 
 * This DTO validates and structures user registration requests,
 * ensuring all required fields are present and properly formatted.
 */
export class RegisterDto {
  /**
   * The user's email address.
   * Must be a valid email format and unique across the system.
   * 
   * @example "user@example.com"
   */
  @IsEmail()
  @IsNotEmpty()
  email: string;

  /**
   * The user's password.
   * Must be at least 8 characters long and contain at least
   * one uppercase letter, one lowercase letter, and one number.
   * 
   * @example "SecurePass123"
   */
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  password: string;
}
```

### Interface Documentation

Interfaces should document their purpose and all members.

```typescript
/**
 * Interface for leaderboard data providers.
 * 
 * Implementations of this interface provide leaderboard data
 * from various sources (database, cache, external API).
 */
export interface ILeaderboardProvider {
  /**
   * Retrieves the current leaderboard rankings.
   * 
   * @param leaderboardId - The ID of the leaderboard to query
   * @param limit - Maximum number of entries to return
   * @returns Promise containing array of leaderboard entries
   */
  getRankings(leaderboardId: string, limit?: number): Promise<LeaderboardEntry[]>;

  /**
   * Submits a new score to the leaderboard.
   * 
   * @param userId - The ID of the user submitting the score
   * @param score - The score value to submit
   * @returns Promise containing the new rank
   */
  submitScore(userId: number, score: number): Promise<number>;
}
```

### Documentation Best Practices

1. **Be Concise but Complete**
   - Provide enough information for developers to understand usage
   - Avoid unnecessary verbosity
   - Focus on what developers need to know

2. **Use Active Voice**
   - "Validates the user's credentials" (good)
   - "The user's credentials are validated" (avoid)

3. **Include Examples**
   - Add examples for complex methods
   - Show common usage patterns
   - Demonstrate edge cases

4. **Keep Examples Current**
   - Ensure examples compile and run
   - Use realistic data in examples
   - Update examples when code changes

5. **Document Edge Cases**
   - What happens if a parameter is null/undefined?
   - What are the performance implications?
   - Are there any side effects?

6. **Use Standard JSDoc Tags**
   - `@param` - Parameters
   - `@returns` - Return value
   - `@throws` - Exceptions
   - `@example` - Usage examples
   - `@deprecated` - Deprecated items
   - `@see` - Related references
   - `@since` - Version when introduced

7. **Type Safety**
   - Include TypeScript types in documentation
   - Use generic types where appropriate
   - Document type constraints

### Documentation Checklist

Before committing code, ensure:

- [ ] All public classes have class-level JSDoc
- [ ] All public methods have complete JSDoc
- [ ] All parameters are documented with `@param`
- [ ] Return values are documented with `@returns`
- [ ] Exceptions are documented with `@throws`
- [ ] Complex methods include `@example`
- [ ] All DTO fields have JSDoc comments
- [ ] All interface members are documented
- [ ] Examples are current and accurate
- [ ] Documentation is consistent with code

---

## Testing

```bash
npm run test          # unit tests
npm run test:e2e      # end-to-end tests
npm run test:cov      # coverage report
```

- Unit tests live alongside their subjects (`*.spec.ts`).
- E2E tests live in `test/`.
- New features and bug fixes must include corresponding tests.

---

## Contributor Checklist

Use this when your change touches **more than one module**:

### Implementation
- [ ] New module added to `AppModule` imports.
- [ ] Entities have a corresponding migration in `migrations/`; `DB_SYNC` is **not** relied on.
- [ ] `TypedConfigService` used for all env access; new vars added to `validation.ts` and `configuration.ts`.
- [ ] `ValidationPipe`-compatible DTOs (class-validator decorators, `whitelist: true`).
- [ ] Sensitive response fields decorated with `@Exclude()`.

### Security
- [ ] Auth guards applied to all non-public endpoints (`@Public()` used intentionally).
- [ ] Role checks use the canonical `Role` enum, not string literals.
- [ ] No secrets, credentials, or PII committed to source.
- [ ] Cross-module contracts (JWT payload shape, cache key format, realtime event names) respected — see [ARCHITECTURE.md](ARCHITECTURE.md).

### Observability
- [ ] Mutation endpoints decorated with `@AuditLog()`.
- [ ] New cron jobs acquire a `DistributedLockService` lock before running.
- [ ] Errors are logged with enough context to diagnose in production.

### Documentation
- [ ] `ARCHITECTURE.md` updated if module responsibilities or data flows changed.
- [ ] Feature-level README updated (or created) linking to the canonical docs above.
- [ ] `RUNBOOK.md` updated for new env vars, scheduled jobs, or operational considerations.

---

## Opening a Pull Request

1. Create a branch from `develop` (not `main`).
2. Follow the PR template at `.github/pull_request_template.md`.
3. Ensure `npm run lint` and `npm run test` pass locally.
4. Reference the issue number in the PR description (`Closes #N`).

---

**ProofStell Backend — Powering decentralized gaming.**
