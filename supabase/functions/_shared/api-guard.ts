// ═══════════════════════════════════════════════════════════════
// SOSphere — Shared API Guard (request validation + DDoS defence)
// ─────────────────────────────────────────────────────────────
// Complements rate-limiter.ts. Where the limiter counts requests,
// this module rejects obviously-bad ones at the door so they never
// reach business logic:
//   • Wrong Content-Type on POSTs (signals scraping / probes)
//   • Oversized payloads (anti-OOM)
//   • Rapid-fire identical payloads from the same IP (replay /
//     amplification attacks)
//
// The functions here are composable helpers, not middleware. Edge
// Functions compose them in the order their threat model demands.
// Nothing here calls Supabase, so the module is cheap to import and
// safe to use on the SOS hot path.
// ═══════════════════════════════════════════════════════════════

// B-M1: origin allowlist via ALLOWED_ORIGINS env
export const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://sosphere-platform.vercel.app")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function getCorsOrigin(req: Request): string {
  const origin = req.headers.get("origin") || "";
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

// B-M1: origin allowlist via ALLOWED_ORIGINS env
// The exported `corsHeaders` is kept for backwards compat with callers
// that don't have a Request in scope when they build headers. It uses
// the first allow-listed origin as a safe default. Callers WITH access
// to the Request MUST prefer `buildCorsHeaders(req)` for per-request
// origin reflection so same-origin browsers can read responses.
export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS[0],
  "Vary": "Origin",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// B-M1: origin allowlist via ALLOWED_ORIGINS env
export function buildCorsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getCorsOrigin(req),
    "Vary": "Origin",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, idempotency-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export interface ValidationOptions {
  allowLargeBody?: boolean;      // if false, caps body at 1MB
  requireContentType?: boolean;  // if true, POSTs must be application/json
  checkPayloadRepeat?: boolean;  // if true, detect rapid-fire dup payloads
  maxBodyBytes?: number;         // override default 1MB cap
}

const DEFAULT_MAX_BODY = 1 * 1024 * 1024;         // 1 MB
const REPEAT_WINDOW_MS = 10_000;                  // 10s
const REPEAT_THRESHOLD = 5;                       // 5 identical in 10s = suspicious

// ip → (payload hash → array of ms timestamps). Pruned on every
// access; bounded by REPEAT_WINDOW_MS.
const repeatTracker = new Map<string, Map<string, number[]>>();

/**
 * Validate an incoming request. Returns { valid: true } if the
 * request passes; { valid: false, error: Response } otherwise — the
 * Response is ready to return straight from the handler.
 *
 * This function reads the body IF checkPayloadRepeat is true, so
 * callers must not read it again. Pass the already-buffered text to
 * your JSON.parse on success (see `consumeBody` helper below).
 */
export async function validateRequest(
  req: Request,
  options: ValidationOptions = {},
): Promise<
  | { valid: true; body: string | null }
  | { valid: false; error: Response }
> {
  const {
    allowLargeBody = false,
    requireContentType = true,
    checkPayloadRepeat = false,
    maxBodyBytes = DEFAULT_MAX_BODY,
  } = options;

  // Content-Type check (POST only; OPTIONS handled by caller).
  if (requireContentType && req.method === "POST") {
    const ct = req.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("application/json")) {
      return {
        valid: false,
        error: errorResponse(415, "Unsupported Content-Type — application/json required", "BAD_CONTENT_TYPE"),
      };
    }
  }

  // Content-Length quick check — some clients omit it; we still cap
  // during body read below.
  const cl = req.headers.get("content-length");
  if (!allowLargeBody && cl) {
    const size = Number(cl);
    if (Number.isFinite(size) && size > maxBodyBytes) {
      return {
        valid: false,
        error: errorResponse(413, "Payload too large", "PAYLOAD_TOO_LARGE"),
      };
    }
  }

  // Optional: read body once to both enforce size and detect repeats.
  let bodyText: string | null = null;
  if (checkPayloadRepeat && req.method === "POST") {
    try {
      bodyText = await req.text();
      if (!allowLargeBody && bodyText.length > maxBodyBytes) {
        return {
          valid: false,
          error: errorResponse(413, "Payload too large", "PAYLOAD_TOO_LARGE"),
        };
      }
      const ip = clientIp(req);
      const repeatHit = await detectPayloadRepeat(ip, bodyText);
      if (repeatHit) {
        return {
          valid: false,
          error: errorResponse(429, "Too many identical requests", "REPEAT_PAYLOAD"),
        };
      }
    } catch {
      return {
        valid: false,
        error: errorResponse(400, "Invalid request body", "BAD_BODY"),
      };
    }
  }

  return { valid: true, body: bodyText };
}

/**
 * Extract best-effort client IP from request headers. Edge Functions
 * sit behind a proxy, so we prefer X-Forwarded-For. Falls back to a
 * per-instance "unknown" bucket — not great, but fails closed: an
 * attacker spoofing X-Forwarded-For to bypass rate-limiting lands in
 * the bucket of their own chosen fake IP, so they still get throttled.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

/**
 * Cheap content-addressed hash for payload-repeat detection. We use
 * a 32-bit FNV-1a rather than SHA-256 — the collision risk is
 * irrelevant (we just want "same body sent 5 times in 10 seconds")
 * and FNV-1a runs in microseconds, not milliseconds, on 100KB payloads.
 */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // toString(16) — unsigned
  return (h >>> 0).toString(16);
}

async function detectPayloadRepeat(ip: string, body: string): Promise<boolean> {
  const now = Date.now();
  const cutoff = now - REPEAT_WINDOW_MS;
  const hash = fnv1a(body);

  let byHash = repeatTracker.get(ip);
  if (!byHash) {
    byHash = new Map();
    repeatTracker.set(ip, byHash);
  }

  // Prune old entries for this IP.
  for (const [h, times] of byHash) {
    const live = times.filter(t => t > cutoff);
    if (live.length === 0) byHash.delete(h);
    else byHash.set(h, live);
  }

  const hits = byHash.get(hash) ?? [];
  hits.push(now);
  byHash.set(hash, hits);

  if (hits.length >= REPEAT_THRESHOLD) {
    console.warn(
      `[api-guard] Payload repeat detected: ${hits.length} instances in ${REPEAT_WINDOW_MS / 1000}s from ${ip}`
    );
    return true;
  }
  return false;
}

// ── Standardised response helpers ──────────────────────────────

export function errorResponse(
  status: number,
  message: string,
  code?: string,
): Response {
  const body = JSON.stringify({
    error: true,
    status,
    message,
    code: code || `ERR_${status}`,
    timestamp: new Date().toISOString(),
  });
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function successResponse(data: unknown, status = 200): Response {
  const body = JSON.stringify({
    error: false,
    status,
    data,
    timestamp: new Date().toISOString(),
  });
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Merge rate-limit headers into an existing Response without rebuilding
 * the body. Useful because the body has already been JSON-serialised
 * and we don't want to re-parse just to re-attach headers.
 */
export function attachHeaders(
  response: Response,
  extra: Record<string, string>,
): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * TEST-ONLY. Drops the payload-repeat tracker state.
 */
export function _resetForTests(): void {
  repeatTracker.clear();
}
