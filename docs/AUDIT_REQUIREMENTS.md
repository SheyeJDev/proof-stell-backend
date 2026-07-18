# Audit Logging Requirements

## Overview
This document defines the comprehensive audit logging requirements for the Proof-Stell backend application to ensure security, compliance, and accountability for all critical operations.

## Compliance Requirements

### GDPR (General Data Protection Regulation)
- **Data Processing Audit Trail**: All personal data processing operations must be logged
- **Access Logging**: All access to personal data must be recorded with user identity and timestamp
- **Data Retention**: Audit logs must be retained for minimum 2 years (GDPR Article 30)
- **Right to Access**: Users must be able to request their audit trail data

### Financial Regulations
- **Transaction Audit Trail**: All blockchain transactions (mint, transfer, burn) must be logged
- **Immutable Records**: Transaction logs must be immutable and tamper-evident
- **Regulatory Reporting**: Audit logs must support regulatory export formats

### Security Standards
- **ISO 27001**: Comprehensive logging of security-relevant events
- **PCI DSS**: If payment processing is added, specific audit requirements apply

## Audit Log Data Retention Policy

| Operation Type | Retention Period | Rationale |
|---------------|------------------|-----------|
| Authentication events (login, logout, password changes) | 2 years | GDPR requirement for access tracking |
| Blockchain transactions (mint, transfer, burn) | 7 years | Financial transaction retention |
| User management operations (create, update, delete) | 2 years | GDPR data processing records |
| Admin operations (privilege changes, config changes) | 5 years | Extended security audit trail |
| Game session operations | 1 year | Operational audit trail |
| System events (errors, health checks) | 6 months | Operational troubleshooting |
| Failed access attempts | 2 years | Security incident investigation |

## Access Control for Audit Logs

### Role-Based Access
- **Admin Role**: Full access to all audit logs with filtering and export capabilities
- **Auditor Role**: Read-only access to audit logs (if implemented)
- **User Role**: Read-only access to their own audit logs only
- **System Services**: Write-only access for logging purposes

### Data Protection
- Audit logs must be stored in a separate database schema
- Audit log access must be logged (audit the auditor)
- Export of audit logs requires admin approval and logging
- Sensitive data (passwords, tokens) must be redacted before logging

## Operations Requiring Audit Logging

### 1. Authentication & Authorization
- **USER_LOGIN**: Successful user login
- **USER_LOGOUT**: User logout
- **USER_LOGIN_FAILED**: Failed login attempt
- **PASSWORD_CHANGE**: Password change by user
- **PASSWORD_RESET_REQUEST**: Password reset request
- **PASSWORD_RESET_COMPLETE**: Password reset completion
- **TOKEN_REFRESH**: JWT token refresh
- **SESSION_EXPIRED**: Session expiration

### 2. Blockchain Operations (CRITICAL)
- **TOKEN_MINT**: Token minting operation
- **TOKEN_TRANSFER**: Token transfer between users
- **TOKEN_BURN**: Token burning operation
- **BALANCE_QUERY**: Balance check operation
- **TRANSACTION_STATUS**: Transaction status check
- **BLOCKCHAIN_HEALTH**: Blockchain health check

### 3. User Management
- **USER_CREATED**: New user creation (admin only)
- **USER_UPDATED**: User profile update
- **USER_DELETED**: User deletion (admin only)
- **USER_STATUS_CHANGED**: User status modification (active/banned)
- **ROLE_ASSIGNED**: Role assignment to user
- **ROLE_REMOVED**: Role removal from user
- **ADMIN_ROLE_ASSIGNED**: Admin role assignment (critical)
- **ADMIN_ROLE_REMOVED**: Admin role removal (critical)

### 4. Game Session Operations
- **SESSION_STARTED**: Game session started
- **SESSION_REPORTED**: Game session results reported
- **SESSION_VERIFIED**: Session integrity verification
- **SESSION_ANALYTICS_VIEW**: Session analytics accessed
- **SESSION_DATA_EXPORT**: Session data export

### 5. Admin Operations
- **ADMIN_DASHBOARD_VIEW**: Dashboard access
- **ADMIN_EXPORT_CSV**: Data export operation
- **ADMIN_CONFIG_CHANGED**: System configuration change
- **ADMIN_BADGE_CREATED**: Badge creation
- **ADMIN_BADGE_AWARDED**: Badge awarding
- **ADMIN_CHALLENGE_RESET**: Daily challenge reset

### 6. Security Events
- **SUSPICIOUS_ACTIVITY**: Detected suspicious activity
- **SECURITY_BREACH_ATTEMPT**: Attempted security breach
- **ACCESS_DENIED**: Unauthorized access attempt
- **RATE_LIMIT_EXCEEDED**: Rate limit violation
- **INVALID_TOKEN**: Invalid authentication token

## Audit Log Data Requirements

### Standard Fields (All Logs)
- `id`: Unique identifier (UUID)
- `userId`: User who performed the action
- `actionType`: Type of action performed
- `timestamp`: When the action occurred
- `ipAddress`: IP address of the requester
- `userAgent`: User agent string
- `result`: SUCCESS, FAILURE, or ERROR
- `errorMessage`: Error message if applicable

### Enhanced Fields (Data Modifications)
- `beforeState`: State of data before modification
- `afterState`: State of data after modification
- `resource`: Resource being operated on
- `resourceId`: ID of the resource

### Enhanced Fields (Blockchain Operations)
- `transactionHash`: Blockchain transaction hash
- `contractAddress`: Smart contract address
- `fromAddress`: Source wallet address
- `toAddress`: Destination wallet address
- `amount`: Transaction amount
- `blockNumber`: Block number (when available)
- `gasUsed`: Gas consumed by transaction

### Enhanced Fields (User Context)
- `userRole`: User's role at time of action
- `userPermissions`: User's permissions at time of action
- `sessionId`: Session identifier

## Audit Log Interceptor Enhancements

### Current Capabilities
- Basic action logging with metadata
- IP address and user agent capture
- Error handling with timeout
- Sensitive data sanitization

### Required Enhancements
1. **Before/After State Logging**: Capture data state before and after modifications
2. **External Request Logging**: Log blockchain API calls and responses
3. **User Role Capture**: Log user's role and permissions at time of action
4. **Session Context**: Include session ID in audit logs
5. **Correlation IDs**: Add request correlation IDs for traceability

## Audit Log Viewing & Export

### Filtering Capabilities
- Filter by user ID
- Filter by action type
- Filter by date range
- Filter by result (SUCCESS/FAILURE/ERROR)
- Filter by resource type
- Filter by IP address

### Export Capabilities
- CSV export for compliance reporting
- JSON export for system integration
- PDF export for human-readable reports
- Date range selection for exports
- Export approval workflow for sensitive data

### Audit Log Statistics
- Total log count
- Logs by action type
- Recent activity trends
- Failed operation rate
- Geographic distribution (by IP)

## Audit Log Archival Strategy

### Archival Triggers
- Age-based archival (logs older than retention period)
- Volume-based archival (when log count exceeds threshold)
- Manual archival (admin-initiated)

### Archival Process
1. Move old logs to cold storage (compressed format)
2. Create index for archived logs
3. Maintain metadata in hot storage
4. Implement retrieval mechanism for archived logs

### Storage Considerations
- Hot storage: Recent logs (last 30 days) - fast access
- Warm storage: Medium age logs (30 days - 1 year) - moderate access
- Cold storage: Old logs (1+ years) - slow access, compressed

## Integration Testing Requirements

### Critical Operation Tests
- Verify audit log creation for password changes
- Verify audit log creation for blockchain mint operations
- Verify audit log creation for blockchain transfer operations
- Verify audit log creation for admin role changes
- Verify audit log creation for user deletion

### Data Integrity Tests
- Verify before/after state logging
- Verify sensitive data redaction
- Verify user role capture
- Verify correlation ID propagation

### Access Control Tests
- Verify admin-only access to audit endpoints
- Verify user access to own audit logs only
- Verify audit log access is itself logged

### Performance Tests
- Verify audit logging doesn't significantly impact response time
- Verify bulk operation logging performance
- Verify concurrent logging performance

## Implementation Priority

### Phase 1: Critical Security (Immediate)
1. Add audit logging to blockchain operations (mint, transfer, burn)
2. Add audit logging to password changes
3. Add audit logging to admin role changes
4. Enhance audit interceptor with user role capture

### Phase 2: Compliance (Within 1 week)
1. Add audit logging to all user management operations
2. Add audit logging to game session operations
3. Implement audit log export functionality
4. Create audit requirements documentation

### Phase 3: Enhanced Features (Within 2 weeks)
1. Implement before/after state logging
2. Implement audit log archival strategy
3. Add comprehensive integration tests
4. Implement audit log statistics dashboard

## Monitoring & Alerting

### Audit Log Health Monitoring
- Monitor audit log service availability
- Monitor audit log write latency
- Monitor audit log storage growth
- Alert on audit log service failures

### Security Alerting
- Alert on suspicious patterns (multiple failed logins)
- Alert on privilege escalation attempts
- Alert on unusual blockchain transaction patterns
- Alert on audit log access attempts

## Review & Maintenance

### Regular Review
- Quarterly review of audit log retention policy
- Annual review of audit requirements for compliance changes
- Monthly review of audit log storage capacity

### Documentation Updates
- Update this document when new operations are added
- Update when compliance requirements change
- Update when audit infrastructure changes

## References
- GDPR Article 30: Records of processing activities
- ISO 27001 A.12.3: Backup and logging
- NIST SP 800-92: Guide to Computer Security Log Management
