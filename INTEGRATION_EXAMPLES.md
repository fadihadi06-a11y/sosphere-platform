# SOSphere Rate Limiter - Integration Examples

Quick examples for integrating the shared rate limiter into new edge functions.

## Example 1: Simple API Endpoint with Rate Limiting

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
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  // Validate request
  const validation = await validateRequest(req);
  if (!validation.valid) {
    return validation.error;
  }

  try {
    const userId = extractUserIdFromRequest(req);

    // Check rate limit
    const rateLimitResult = checkRateLimit(userId, "api", false);
    if (!rateLimitResult.allowed) {
      const response = errorResponse(429, "Too many requests");
      const headers = new Headers(response.headers);
      Object.entries(getRateLimitHeaders(rateLimitResult)).forEach(
        ([k, v]) => headers.set(k, v)
      );
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }

    // Process request
    const data = await processRequest(req);

    // Return success with rate limit info
    const responseObj = successResponse(data, 200);
    const headers = new Headers(responseObj.headers);
    Object.entries(getRateLimitHeaders(rateLimitResult)).forEach(
      ([k, v]) => headers.set(k, v)
    );
    return new Response(responseObj.body, {
      status: responseObj.status,
      headers,
    });
  } catch (err) {
    return errorResponse(500, "Internal server error");
  }

  function extractUserIdFromRequest(req: Request): string {
    const auth = req.headers.get("Authorization");
    return auth ? auth.replace("Bearer ", "") : req.headers.get("x-forwarded-for") || "anonymous";
  }

  async function processRequest(req: Request): Promise<unknown> {
    const body = await req.json();
    return { success: true, received: body };
  }
});
```

## Example 2: SMS Endpoint with SOS Support

Update `supabase/functions/twilio-sms/index.ts`:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkRateLimit,
  markSosPriority,
  clearSosPriority,
  getRateLimitHeaders,
} from "../_shared/rate-limiter.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  try {
    const body = await req.json();
    const { to, message, emergencyId, userId } = body;

    // Check if this is an SOS emergency SMS
    const isSos = emergencyId !== undefined;
    if (isSos) {
      markSosPriority(userId);
    }

    // Apply rate limits
    const rateLimitResult = checkRateLimit(userId, "api", isSos);
    if (!rateLimitResult.allowed) {
      const headers = {
        "Access-Control-Allow-Origin": "*",
        ...getRateLimitHeaders(rateLimitResult),
      };
      return new Response(
        JSON.stringify({
          error: "Rate limited",
          remaining: rateLimitResult.remaining,
          retryAfterMs: rateLimitResult.retryAfterMs,
        }),
        { status: 429, headers }
      );
    }

    // Send SMS via Twilio...
    const result = await sendSms(to, message);

    // Clear SOS after successful send
    if (isSos) {
      clearSosPriority(userId);
    }

    const headers = {
      "Access-Control-Allow-Origin": "*",
      ...getRateLimitHeaders(rateLimitResult),
    };
    return new Response(JSON.stringify(result), {
      status: 200,
      headers,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  async function sendSms(to: string, message: string): Promise<unknown> {
    // Implementation...
    return { success: true, sid: "SM_123" };
  }
});
```

## Example 3: Webhook with Strict Rate Limiting

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
} from "../_shared/api-guard.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  // Strict validation for webhooks
  const validation = await validateRequest(req, {
    allowLargeBody: false,      // 1MB max
    requireContentType: true,
    checkPayloadRepeat: true,   // Detect spam
  });

  if (!validation.valid) {
    return validation.error;
  }

  try {
    const clientIp = req.headers.get("x-forwarded-for") || "unknown";

    // Use webhook tier (stricter than api)
    const rateLimitResult = checkRateLimit(clientIp, "webhook", false);
    if (!rateLimitResult.allowed) {
      const headers = {
        ...corsHeaders(),
        ...getRateLimitHeaders(rateLimitResult),
      };
      return errorResponse(429, "Webhook rate limit exceeded");
    }

    // Process webhook...
    const body = await req.json();
    console.log("[webhook] Received:", body);

    return new Response(JSON.stringify({ status: "received" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders(),
        ...getRateLimitHeaders(rateLimitResult),
      },
    });
  } catch (err) {
    return errorResponse(500, "Webhook processing failed");
  }
});
```

## Example 4: Authentication Endpoint with Low Rate Limit

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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  const validation = await validateRequest(req, {
    requireContentType: true,
  });

  if (!validation.valid) {
    return validation.error;
  }

  try {
    const clientIp = req.headers.get("x-forwarded-for") || "unknown";

    // Use auth tier (only 10 req/min to prevent brute force)
    const rateLimitResult = checkRateLimit(clientIp, "auth", false);
    if (!rateLimitResult.allowed) {
      const headers = {
        ...corsHeaders(),
        ...getRateLimitHeaders(rateLimitResult),
      };
      return errorResponse(429, "Too many login attempts");
    }

    const body = await req.json();
    const { email, password } = body;

    // Verify credentials...
    const valid = await verifyCredentials(email, password);

    if (!valid) {
      const response = errorResponse(401, "Invalid credentials");
      const headers = new Headers(response.headers);
      Object.entries(getRateLimitHeaders(rateLimitResult)).forEach(
        ([k, v]) => headers.set(k, v)
      );
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }

    // Generate token...
    const token = await generateToken(email);

    const response = successResponse({ token }, 200);
    const headers = new Headers(response.headers);
    Object.entries(getRateLimitHeaders(rateLimitResult)).forEach(
      ([k, v]) => headers.set(k, v)
    );
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (err) {
    return errorResponse(500, "Authentication failed");
  }

  async function verifyCredentials(
    email: string,
    password: string
  ): Promise<boolean> {
    // Implementation...
    return true;
  }

  async function generateToken(email: string): Promise<string> {
    // Implementation...
    return "token_123";
  }
});
```

## Example 5: Bulk Operations with Large Payload

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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  // Allow larger payloads (5MB) for bulk operations
  const validation = await validateRequest(req, {
    allowLargeBody: true,  // 5MB instead of 1MB
    requireContentType: true,
    checkPayloadRepeat: false,  // Don't check repeats for bulk
  });

  if (!validation.valid) {
    return validation.error;
  }

  try {
    const userId = extractUserId(req);

    // Bulk operations get lower per-user rate limits
    const rateLimitResult = checkRateLimit(userId, "api", false);
    if (!rateLimitResult.allowed) {
      const headers = {
        ...corsHeaders(),
        ...getRateLimitHeaders(rateLimitResult),
      };
      return errorResponse(429, "Rate limit exceeded for bulk operations");
    }

    const body = await req.json();
    const items = Array.isArray(body) ? body : [body];

    // Process each item...
    const results = await Promise.all(
      items.map(item => processItem(item))
    );

    const response = successResponse(
      { processed: results.length, results },
      200
    );
    const headers = new Headers(response.headers);
    Object.entries(getRateLimitHeaders(rateLimitResult)).forEach(
      ([k, v]) => headers.set(k, v)
    );
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (err) {
    return errorResponse(500, "Bulk processing failed");
  }

  function extractUserId(req: Request): string {
    const auth = req.headers.get("Authorization");
    return auth ? auth.replace("Bearer ", "") : "anonymous";
  }

  async function processItem(item: unknown): Promise<unknown> {
    // Implementation...
    return { success: true };
  }
});
```

## Integration Checklist for Each Endpoint

When adding rate limiting to a new edge function, follow this checklist:

```
☐ Import rate limiter and api-guard modules
☐ Add CORS preflight handler
☐ Validate incoming request (validateRequest)
☐ Extract user ID or IP address
☐ Check rate limit (checkRateLimit)
☐ Return 429 if rate limited
☐ Process the request
☐ Include rate limit headers in response (getRateLimitHeaders)
☐ Handle errors gracefully (errorResponse)
☐ Test with curl/Postman
☐ Verify headers with curl -v
☐ Check health endpoint for stats
☐ Monitor SOS priority users
```

## Quick Reference

### Choose the Right Tier

- **sos**: For SOS-tagged emergency functions (highest limits)
- **auth**: For login/registration endpoints (strict limits)
- **api**: For general API endpoints (moderate limits)
- **webhook**: For external webhooks (moderate limits, spam detection)

### Check Rate Limit

```typescript
const result = checkRateLimit(userId, "api", false);
if (!result.allowed) {
  // Return 429
}
```

### Mark SOS Emergency

```typescript
markSosPriority(userId);
const result = checkRateLimit(userId, "api", true);
// result.allowed === true (never blocked)
```

### Add Headers to Response

```typescript
const headers = getRateLimitHeaders(result);
return new Response(JSON.stringify(data), {
  status: 200,
  headers: { ...corsHeaders(), ...headers },
});
```

### Validate Request

```typescript
const validation = await validateRequest(req, {
  allowLargeBody: false,
  requireContentType: true,
  checkPayloadRepeat: true,
});
if (!validation.valid) {
  return validation.error;
}
```

## Testing Commands

```bash
# Check health
curl -X GET http://localhost:3000/functions/v1/api-health -v

# Test rate limiting (make 61 requests)
for i in {1..61}; do
  curl -X POST http://localhost:3000/functions/v1/api \
    -H "Content-Type: application/json" \
    -d '{"test":true}' -v
  sleep 0.1
done

# Last request should show:
# HTTP/1.1 429 Too Many Requests
# X-RateLimit-Remaining: 0
# X-RateLimit-Reset: <timestamp>

# Test SOS (should always succeed)
curl -X POST http://localhost:3000/functions/v1/twilio-call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+966501234567",
    "emergencyId": "sos-123",
    "callerName": "Test"
  }' -v

# Response should show:
# HTTP/1.1 200 OK
# X-RateLimit-Priority: sos
# X-RateLimit-Remaining: 600
```

## Common Issues

### Rate limit always returns 429

**Cause**: Previous requests still in window
**Fix**: Wait 60 seconds for window to reset

### SOS request still gets blocked

**Cause**: markSosPriority not called before checkRateLimit
**Fix**: Call markSosPriority(userId) before checkRateLimit with isSos=true

### Missing headers in response

**Cause**: Forgot to spread getRateLimitHeaders
**Fix**: Add ...getRateLimitHeaders(result) to headers object

### Import errors

**Cause**: Wrong relative path
**Fix**: Use ../\_shared/rate-limiter.ts (escape underscore in markdown)

## Troubleshooting

View rate limit state:

```typescript
import { getRateLimitStats } from "../_shared/rate-limiter.ts";
const stats = getRateLimitStats();
console.log(stats); // { activeWindows: N, sosPriorityUsers: M }
```

Check headers manually:

```bash
curl -X POST http://localhost:3000/functions/v1/api \
  -H "Content-Type: application/json" \
  -d '{"test":true}' -v 2>&1 | grep -i "x-ratelimit"
```

Monitor health endpoint:

```bash
watch -n 2 'curl -s http://localhost:3000/functions/v1/api-health | jq .rateLimitStats'
```
