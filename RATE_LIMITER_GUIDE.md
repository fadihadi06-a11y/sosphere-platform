# SOSphere Rate Limiter & API Guard Guide

This document describes the new shared rate-limiting middleware system for SOSphere Supabase Edge Functions.

## Overview

The SOSphere platform now includes a **shared rate-limiting middleware** with a special **SOS Priority Lane** that ensures emergency calls are never blocked.

### Key Features

- **Sliding Window Algorithm**: Accurate per-minute rate limiting
- **SOS Priority Lane**: Emergency requests get 10x higher limits and are NEVER blocked
- **Multiple Tiers**: Different limits for auth, api, webhook, and sos endpoints
- **DDoS Protection**: Detects rapid-fire identical payloads
- **Standardized Headers**: Includes X-RateLimit-* headers in all responses
- **Request Validation**: Checks Content-Type, payload size, and suspicious patterns
- **CORS Ready**: Built-in CORS header support

## Modules

### 1. `supabase/functions/_shared/rate-limiter.ts`

The core rate-limiting engine with sliding window algorithm.

#### Interfaces

```typescript
interface RateLimitConfig {
  windowMs: number;        // Time window in milliseconds
  maxRequests: number;     // Max requests per window
  sosMultiplier: number;   // Multiplier for SOS requests
  burstAllowance: number;  // Short burst allowance per 10s
}

interface RateLimitResult {
  allowed: boolean;        // Whether the request is allowed
  remaining: number;       // Remaining requests in window
  retryAfterMs: number;    // Milliseconds to wait before retry
  priority: "sos" | "high" | "normal" | "throttled";
}
```

#### Rate Limit Tiers

| Tier    | Window | Normal Limit | SOS Multiplier | Burst |
|---------|--------|-------------|----------------|-------|
| sos     | 60s    | 200         | 1x             | 50    |
| auth    | 60s    | 10          | 5x             | 3     |
| api     | 60s    | 60          | 10x            | 15    |
| webhook | 60s    | 30          | 5x             | 10    |

#### Functions

##### `checkRateLimit(key: string, tier: string, isSosRequest: boolean): RateLimitResult`

Check if a request is allowed under the current rate limit.

```typescript
import { checkRateLimit, markSosPriority } from "../_shared/rate-limiter.ts";

// Check normal request
const result = checkRateLimit(userId, "api", false);
if (!result.allowed) {
  // Send 429 Too Many Requests
}

// Check SOS emergency call (NEVER blocks)
markSosPriority(userId);
const sosResult = checkRateLimit(userId, "api", true);
// sosResult.allowed is ALWAYS true
```

##### `markSosPriority(userId: string): void`

Mark a user as being in an active SOS emergency. Their subsequent requests get higher limits.

```typescript
markSosPriority(userId);
```

##### `clearSosPriority(userId: string): void`

Clear SOS priority when emergency is resolved.

```typescript
clearSosPriority(userId);
```

##### `getRateLimitHeaders(result: RateLimitResult): Record<string, string>`

Get standard rate-limit headers to include in the response.

```typescript
const headers = getRateLimitHeaders(result);
// Returns:
// {
//   "X-RateLimit-Limit": "60",
//   "X-RateLimit-Remaining": "42",
//   "X-RateLimit-Reset": "1712604180",
//   "X-RateLimit-Priority": "normal",
//   "Retry-After": "30"  // only if rate limited
// }
```

##### `getRateLimitStats(): { activeWindows: number; sosPriorityUsers: number }`

Get current rate limit statistics for monitoring.

```typescript
const stats = getRateLimitStats();
console.log(`Active windows: ${stats.activeWindows}`);
console.log(`SOS priority users: ${stats.sosPriorityUsers}`);
```

### 2. `supabase/functions/_shared/api-guard.ts`

Request validation and DDoS defense layer.

#### Functions

##### `validateRequest(req: Request, options?: ValidationOptions): Promise<{ valid: boolean; error?: Response }>`

Validate incoming request.

```typescript
import { validateRequest, corsHeaders } from "../_shared/api-guard.ts";

const validation = await validateRequest(req, {
  allowLargeBody: false,      // Max 1MB
  requireContentType: true,
  checkPayloadRepeat: true,   // Detect rapid-fire attacks
});

if (!validation.valid) {
  return validation.error;
}
```

##### `corsHeaders(): Record<string, string>`

Get CORS headers for all responses.

```typescript
return new Response(JSON.stringify(data), {
  status: 200,
  headers: {
    "Content-Type": "application/json",
    ...corsHeaders(),
  },
});
```

##### `errorResponse(status: number, message: string, code?: string): Response`

Return standardized error response.

```typescript
return errorResponse(400, "Invalid request", "INVALID_REQUEST");
// Returns JSON with error, status, message, code, and timestamp
```

##### `successResponse(data: unknown, status?: number): Response`

Return standardized success response.

```typescript
return successResponse({ userId: "123", name: "John" }, 200);
// Returns JSON with error: false, status, data, and timestamp
```

## Usage Examples

### Example 1: Update twilio-call to use shared rate limiter

**Before:**
```typescript
const rateLimitMap = new Map<string, number[]>();
function checkRateLimit(userId: string): boolean { ... }
```

**After:**
```typescript
import { checkRateLimit, markSosPriority, getRateLimitHeaders } from "../_shared/rate-limiter.ts";

// Mark as SOS call
const isSosCall = emergencyId !== undefined;
if (isSosCall) {
  markSosPriority(userId);
}

// Check rate limit
const rateLimitResult = checkRateLimit(userId, "api", isSosCall);
if (!rateLimitResult.allowed) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    ...getRateLimitHeaders(rateLimitResult),
  };
  return new Response(JSON.stringify({ error: "Rate limited" }), {
    status: 429,
    headers,
  });
}
```

### Example 2: Add rate limiting to a new endpoint

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  checkRateLimit,
  getRateLimitHeaders,
} from "../_shared/rate-limiter.ts";
import {
  validateRequest,
  corsHeaders,
  errorResponse,
  successResponse,
} from "../_shared/api-guard.ts";

serve(async (req: Request) => {
  // Validate request
  const validation = await validateRequest(req);
  if (!validation.valid) {
    return validation.error;
  }

  // Get user ID (from JWT, IP, etc)
  const userId = extractUserId(req);

  // Check rate limit (api tier, not SOS)
  const rateLimitResult = checkRateLimit(userId, "api", false);
  if (!rateLimitResult.allowed) {
    const response = errorResponse(429, "Too many requests");
    const headers = new Headers(response.headers);
    Object.entries(getRateLimitHeaders(rateLimitResult)).forEach(
      ([key, value]) => headers.set(key, value)
    );
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  }

  // Process request
  const data = await processRequest(req);

  // Return success with rate limit headers
  const response = successResponse(data, 200);
  const headers = new Headers(response.headers);
  Object.entries(getRateLimitHeaders(rateLimitResult)).forEach(
    ([key, value]) => headers.set(key, value)
  );
  return new Response(response.body, {
    status: response.status,
    headers,
  });
});
```

### Example 3: Health check endpoint

```typescript
import { getRateLimitStats } from "../_shared/rate-limiter.ts";

// In api-health/index.ts
const stats = getRateLimitStats();
const response = {
  status: "ok",
  rateLimitStats: {
    activeWindows: stats.activeWindows,
    sosPriorityUsers: stats.sosPriorityUsers,
  },
};
```

## SOS Priority Lane Behavior

### How It Works

1. **SOS calls are marked as priority**: When `emergencyId` is detected, the request is marked as an SOS emergency.
2. **User gets priority boost**: `markSosPriority(userId)` adds the user to the SOS priority set.
3. **Higher limits applied**: SOS users get `sosMultiplier × maxRequests` limit (normally 10x higher).
4. **Never blocked**: SOS requests always return `allowed: true`.
5. **Priority tracked**: Rate limit headers show `X-RateLimit-Priority: sos` or `X-RateLimit-Priority: high`.

### Example Flow

```
User makes emergency call (SOS):
  ↓
markSosPriority("user-123")
  ↓
checkRateLimit("user-123", "api", true)
  ↓
Returns { allowed: true, remaining: 600, priority: "sos" }
  ↓
Always succeeds, even if normal requests would be blocked
```

### Clearing SOS Priority

When the emergency is resolved:

```typescript
clearSosPriority(userId);
```

This should be called when:
- Emergency is marked as resolved in the database
- Emergency times out (24 hours)
- Admin manually clears the status

## Response Headers

All responses include rate limit information:

```
X-RateLimit-Limit: 60           # Max requests per window
X-RateLimit-Remaining: 42       # Requests left in current window
X-RateLimit-Reset: 1712604180   # Unix timestamp when window resets
X-RateLimit-Priority: normal    # sos | high | normal | throttled
Retry-After: 30                 # Seconds to wait (only if rate limited)
```

## DDoS Protection

The API Guard detects rapid-fire attacks by:

1. **Payload hashing**: SHA-256 hash of request body
2. **Duplicate detection**: Flags if same payload sent 5+ times in 10 seconds
3. **Per-client tracking**: Tracked by IP (X-Forwarded-For header)
4. **Auto-cleanup**: Tracking window clears old entries automatically

```typescript
// Enable in validateRequest
const validation = await validateRequest(req, {
  checkPayloadRepeat: true,
});
```

## Monitoring & Observability

### Health Check Endpoint

```bash
curl http://localhost:3000/functions/v1/api-health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2026-04-08T14:58:00Z",
  "version": "1.0.0",
  "startupTime": "2026-04-08T12:00:00Z",
  "uptimeMs": 10800000,
  "rateLimitStats": {
    "activeWindows": 152,
    "sosPriorityUsers": 3
  },
  "environment": {
    "region": "us-east-1",
    "runtime": "Deno"
  }
}
```

### Logging

Rate limiter logs to console:

```typescript
// Rate limited (429 response shown in headers)
[api-guard] Payload repeat detected: 6 instances in 10s

// SOS priority marked
[twilio-call] Marked SOS priority for user-123

// Rate limit check passed
[api-health] Rate limit stats: 152 active windows, 3 SOS users
```

## Testing

### Test Normal Rate Limiting

```bash
# Make 61 requests to trigger rate limit (api tier = 60/min)
for i in {1..61}; do
  curl -X POST http://localhost:3000/functions/v1/api \
    -H "Content-Type: application/json" \
    -d '{"test": true}'
  sleep 0.5
done
# Last request should return 429 Too Many Requests
```

### Test SOS Priority

```bash
# Emergency call (SOS) - should NOT be rate limited
curl -X POST http://localhost:3000/functions/v1/twilio-call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+966501234567",
    "emergencyId": "sos-123",
    "callerName": "Test User"
  }'

# Response includes SOS headers:
# X-RateLimit-Priority: sos
# X-RateLimit-Remaining: 600 (10x higher limit)
```

## Configuration

To adjust rate limits, modify `TIERS` in `rate-limiter.ts`:

```typescript
export const TIERS: Record<string, RateLimitConfig> = {
  sos: { windowMs: 60_000, maxRequests: 200, sosMultiplier: 1, burstAllowance: 50 },
  auth: { windowMs: 60_000, maxRequests: 10, sosMultiplier: 5, burstAllowance: 3 },
  api: { windowMs: 60_000, maxRequests: 60, sosMultiplier: 10, burstAllowance: 15 },
  webhook: { windowMs: 60_000, maxRequests: 30, sosMultiplier: 5, burstAllowance: 10 },
};
```

Then restart the function for changes to take effect.

## Architecture Diagram

```
Request
  ↓
api-guard.validateRequest()
  ├─ Check Content-Type
  ├─ Check request size
  └─ Check for payload repeats
  ↓
  If invalid → errorResponse(400+)
  ↓
Extract user/IP
  ↓
rate-limiter.checkRateLimit()
  ├─ Check if SOS priority active
  ├─ Apply sliding window algorithm
  └─ Return allowed + metadata
  ↓
  If not allowed → errorResponse(429)
  ↓
Process request
  ↓
successResponse(data) + getRateLimitHeaders()
```

## Integration Checklist

- [ ] Import `checkRateLimit`, `markSosPriority`, `getRateLimitHeaders` from `_shared/rate-limiter.ts`
- [ ] Import `validateRequest`, `corsHeaders`, `errorResponse`, `successResponse` from `_shared/api-guard.ts`
- [ ] Add validation before processing
- [ ] Check rate l