# API Versioning Strategy

## Overview

The Proof-Stell backend uses URL-based API versioning to ensure backward compatibility and allow for smooth API evolution. This document describes the versioning strategy, current version, and guidelines for managing API changes.

## Versioning Scheme

### URL-Based Versioning

All API endpoints are prefixed with the version number in the URL path:

```
/api/v1/{endpoint}
```

**Example:**
```
GET /api/v1/auth/login
POST /api/v1/users
GET /api/v1/leaderboard
```

### Current Version

- **Current Version:** `v1`
- **Status:** Active and stable
- **Base URL:** `https://api.proof-stell.example/api/v1`

## Version Lifecycle

### Version States

1. **Active:** Current version receiving new features and updates
2. **Stable:** No new features, only bug fixes and security patches
3. **Deprecated:** No longer supported, clients should migrate
4. **Sunset:** No longer available, endpoints return 410 Gone

### Version Support Policy

- **Active versions:** Full support including new features
- **Stable versions:** Security patches and critical bug fixes only
- **Deprecated versions:** Minimum 6 months notice before sunset
- **Sunset versions:** No support, endpoints removed

## Version Transition Process

### When to Create a New Version

Create a new API version when:

1. **Breaking Changes Required**
   - Changing request/response data structures
   - Removing required fields
   - Changing field types
   - Modifying authentication requirements

2. **Major Feature Overhaul**
   - Complete redesign of a module
   - Significant workflow changes
   - New authentication mechanisms

### When to Stay on Current Version

Continue using the current version when:

1. **Non-Breaking Changes**
   - Adding optional fields to responses
   - Adding new endpoints
   - Adding new query parameters with defaults
   - Performance improvements

2. **Backward-Compatible Updates**
   - Adding new enum values
   - Extending existing functionality
   - Bug fixes that don't change behavior

## Implementation Guidelines

### Adding New Endpoints

New endpoints should be added to the current active version:

```typescript
@Controller('users')
export class UsersController {
  @Post()
  @ApiOperation({ summary: 'Create a new user' })
  async createUser(@Body() dto: CreateUserDto): Promise<UserDto> {
    // Implementation
  }
}
```

**Result:** `POST /api/v1/users`

### Modifying Existing Endpoints

#### Non-Breaking Changes

Add optional fields or parameters without version bump:

```typescript
export class GetUserDto {
  id: string;
  // New optional field
  includeStats?: boolean;
}
```

#### Breaking Changes

Create new version endpoint:

```typescript
// v1 endpoint (deprecated)
@Get('profile')
async getProfileV1(@Param('id') id: string): Promise<ProfileDtoV1> {
  // Old implementation
}

// v2 endpoint (new)
@Get('profile-v2')
async getProfileV2(@Param('id') id: string): Promise<ProfileDtoV2> {
  // New implementation
}
```

### Deprecating Endpoints

Mark deprecated endpoints with Swagger annotations:

```typescript
@ApiOperation({ 
  summary: 'Get user profile',
  deprecated: true 
})
@ApiHeader({
  name: 'X-API-Deprecated',
  description: 'This endpoint is deprecated. Use /api/v2/users/profile instead',
  required: false
})
@Get('profile')
async getProfile(@Param('id') id: string): Promise<ProfileDto> {
  // Implementation
}
```

### Sunset Endpoints

Remove deprecated endpoints after the sunset period:

```typescript
// Remove from controller
// @Get('profile')
// async getProfile(@Param('id') id: string): Promise<ProfileDto> {
//   // Removed
// }
```

## Client Migration Guide

### Detecting Version

Clients should use the version prefix in all requests:

```typescript
const API_BASE_URL = 'https://api.proof-stell.example/api/v1';

async function getUser(userId: string) {
  const response = await fetch(`${API_BASE_URL}/users/${userId}`);
  return response.json();
}
```

### Handling Deprecation Warnings

Monitor response headers for deprecation notices:

```typescript
async function apiRequest(endpoint: string) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`);
  
  const deprecatedHeader = response.headers.get('X-API-Deprecated');
  if (deprecatedHeader) {
    console.warn('Endpoint deprecated:', deprecatedHeader);
    // Trigger migration logic
  }
  
  return response.json();
}
```

### Version-Specific Code

Use version-specific DTOs and interfaces:

```typescript
// v1 interfaces
interface UserV1 {
  id: string;
  email: string;
  username: string;
}

// v2 interfaces
interface UserV2 {
  id: string;
  email: string;
  username: string;
  displayName: string; // New field
  avatarUrl: string;   // New field
}

// Migration function
function migrateUserV1ToV2(userV1: UserV1): UserV2 {
  return {
    ...userV1,
    displayName: userV1.username,
    avatarUrl: null
  };
}
```

## Version-Specific Configuration

### Environment Variables

Configure version-specific settings:

```typescript
// configuration.ts
export default () => ({
  app: {
    apiVersion: process.env.API_VERSION || 'v1',
    supportedVersions: ['v1', 'v2'],
    defaultVersion: 'v1',
  },
});
```

### Version Routing

Implement version-specific routing if needed:

```typescript
// main.ts
app.setGlobalPrefix(`api/${configService.apiVersion}`);

// Or support multiple versions
app.use('/api/v1', v1Router);
app.use('/api/v2', v2Router);
```

## Documentation Updates

### Swagger Documentation

Update Swagger version information for each version:

```typescript
const config = new DocumentBuilder()
  .setTitle('Stark Insured API')
  .setDescription('API Documentation for v1')
  .setVersion('1.0')
  .addTag('v1', 'Version 1 endpoints')
  .build();
```

### Changelog

Maintain a changelog for each version:

```markdown
# API Changelog

## [v1.2.0] - 2025-01-15
### Added
- New endpoint: GET /api/v1/users/:id/stats
- Optional field `includeStats` to GET /api/v1/users

### Changed
- Improved performance of leaderboard queries

### Deprecated
- GET /api/v1/leaderboard/simple (use GET /api/v1/leaderboard instead)

## [v1.1.0] - 2024-12-01
### Added
- WebSocket support for real-time updates
- New endpoint: POST /api/v1/game-sessions/start
```

## Testing Strategy

### Version-Specific Tests

Maintain separate test suites for each version:

```typescript
// v1/auth.spec.ts
describe('Auth API v1', () => {
  it('should login with email and password', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'password' });
    
    expect(response.status).toBe(201);
  });
});
```

### Backward Compatibility Tests

Ensure new versions don't break existing clients:

```typescript
describe('API Version Compatibility', () => {
  it('v1 endpoints should still work after v2 release', async () => {
    const v1Response = await request(app.getHttpServer())
      .get('/api/v1/users/123');
    
    expect(v1Response.status).toBe(200);
  });
});
```

## Monitoring and Metrics

### Version Usage Metrics

Track usage of each API version:

```typescript
// metrics.ts
const apiVersionUsage = new Counter({
  name: 'api_version_usage',
  help: 'API version usage count',
  labelNames: ['version', 'endpoint'],
});

// middleware
app.use((req, res, next) => {
  const version = req.path.match(/\/api\/(v\d+)/)?.[1] || 'unknown';
  apiVersionUsage.inc({ version, endpoint: req.path });
  next();
});
```

### Deprecation Monitoring

Monitor deprecated endpoint usage:

```typescript
const deprecatedEndpointUsage = new Counter({
  name: 'deprecated_endpoint_usage',
  help: 'Deprecated endpoint usage count',
  labelNames: ['endpoint'],
});

// Alert when usage exceeds threshold
if (deprecatedEndpointUsage.get('endpoint').value > 1000) {
  alert('High deprecated endpoint usage - may need extension');
}
```

## Best Practices

### DO

- Use semantic versioning for API versions (v1, v2, v3)
- Provide at least 6 months notice before deprecation
- Document all breaking changes in changelog
- Maintain backward compatibility when possible
- Use feature flags for gradual rollouts
- Test new versions with existing clients

### DON'T

- Break existing endpoints without creating new version
- Remove deprecated endpoints without notice
- Change version numbers for non-breaking changes
- Mix version-specific logic in shared code
- Skip documentation updates for version changes
- Deprecate versions without migration guide

## Rollback Strategy

### Quick Rollback

If a new version has critical issues:

1. Revert to previous version in load balancer
2. Redirect traffic to stable version
3. Fix issues in new version
4. Test thoroughly
5. Gradually roll out again

### Database Rollback

If version changes require database migrations:

```sql
-- Rollback migration
-- migrations/rollback_20250106_add_user_display_name.sql
ALTER TABLE users DROP COLUMN display_name;
```

## Communication

### Deprecation Notices

Send deprecation notices through multiple channels:

1. **API Response Headers**
   ```
   X-API-Deprecated: true
   X-API-Sunset-Date: 2025-07-01
   X-API-Migration-Guide: https://docs.example.com/migration-v1-to-v2
   ```

2. **Email Notifications**
   - Notify registered API users
   - Include migration guide
   - Provide timeline

3. **Documentation Updates**
   - Update API documentation
   - Add deprecation banners
   - Provide code examples

## Version Roadmap

### Planned Versions

**v1 (Current)**
- Status: Active
- Focus: Feature additions and optimizations
- Sunset: Not planned

**v2 (Future)**
- Status: Planning
- Focus: Major architecture improvements
- Timeline: Q2 2025

**v3 (Future)**
- Status: Concept
- Focus: GraphQL support
- Timeline: Q4 2025

## References

- [Semantic Versioning](https://semver.org/)
- [REST API Versioning Best Practices](https://restfulapi.net/versioning/)
- [NestJS Versioning Guide](https://docs.nestjs.com/techniques/versioning)
