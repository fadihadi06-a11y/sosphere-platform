// ═══════════════════════════════════════════════════════════════
// SOSphere — API Guard & Request Validation
// Validates incoming requests for all edge functions
// - Checks Content-Type
// - Validates request size (max 1MB for normal, 5MB for SOS with evidence)
// - Checks for suspicious patterns (rapid-fire same payload)
// - Returns standardized error responses
// - CORS handling
// ═══════════════════════════════════════════════════════════════

export interface ValidationOptions {
  allowLargeBody?: boolean;     // Allow 5MB instead of 1MB
  requireContentType?: boolean; // Require Content-Type header
  checkPayloadRepeat?: boolean; // Detect rapid-fire identical requests
}

// Track payload hashes to detect rapid-fire attacks
const _payloadHashes = new Map<string, number[]>();
const PAYLOAD_REPEAT_THRESHOLD = 5; // Flag if same payload sent 5+ times in 10s
const PAYLOAD_TRACKING_WINDOW_MS = 10_000;

/**
 * Validate incoming request.
 * Checks Content-Type, request size, suspicious patterns.
 * Returns { valid: true } on success, or { valid: false, error: Response } on failure.
 */
export async function validateRequest(
  req: Request,
  options: ValidationOptions = {}
): Promise<{ valid: boolean; error?: Response }> {
  // Check method
  if (req.method === "OPTIONS") {
    return { valid: true };
  }

  // Check Content-Type if required
  if (options.requireContentType !== false && req.method !== "GET" && req.method !== "HEAD") {
    const contentType = req.headers.get("content-type");
    if (!contentType) {
      return {
        valid: false,
        error: errorResponse(400, "Missing Content-Type header", "INVALID_CONTENT_TYPE"),
      };
    }

    // Only allow JSON for this platform
    if (!contentType.includes("application/json")) {
      return {
        valid: false,
        error: errorResponse(
          415,
          "Content-Type must be application/json",
          "UNSUPPORTED_MEDIA_TYPE"
        ),
      };
    }
  }

  // Check request size
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const maxSizeBytes = options.allowLargeBody ? 5 * 1024 * 1024 : 1 * 1024 * 1024; // 5MB or 1MB
    const sizeBytes = parseInt(contentLength, 10);

    if (isNaN(sizeBytes) || sizeBytes > maxSizeBytes) {
      const maxSizeMb = maxSizeBytes / 1024 / 1024;
      return {
        valid: false,
        error: errorResponse(
          413,
          `Request body exceeds ${maxSizeMb}MB limit`,
          "PAYLOAD_TOO_LARGE"
        ),
      };
    }
  }

  // Optional: detect rapid-fire identical payloads (DDoS pattern)
  if (options.checkPayloadRepeat && req.method !== "GET" && req.method !== "HEAD") {
    try {
      const body = await req.clone().text();
      const hash = await hashPayload(body);
      const clientIp = req.headers.get("x-forwarded-for") || "unknown";
      const key = `${clientIp}:${hash}`;

      const now = Date.now();
      const recentHashes = (_payloadHashes.get(key) || []).filter(
        t => t > now - PAYLOAD_TRACKING_WINDOW_MS
      );

      if (recentHashes.length >= PAYLOAD_REPEAT_THRESHOLD) {
        // Clear tracking to avoid memory leak
        _payloadHashes.delete(key);
        return {
          valid: false,
          error: errorResponse(429, "Too many identical requests", "REPEAT_PAYLOAD_DETECTED"),
        };
      }

      recentHashes.push(now);
      _payloadHashes.set(key, recentHashes);
    } catch (err) {
      // If we can't read the body, continue (streaming, etc)
      console.warn("[api-guard] Could not check payload repeat:", err);
    }
  }

  return { valid: true };
}

/**
 * Get CORS headers for all responses.
 * Currently allows all origins; adjust as needed.
 */
export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Service-Role-Key, X-Request-ID",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * Return standardized error response.
 */
export function errorResponse(
  status: number,
  message: string,
  code?: string
): Response {
  return new Response(
    JSON.stringify({
      error: true,
      status,
      message,
      code: code || getDefaultErrorCode(status),
      timestamp: new Date().toISOString(),
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders(),
      },
    }
  );
}

/**
 * Return standardized success response.
 */
export function successResponse(data: unknown, status: number = 200): Response {
  return new Response(
    JSON.stringify({
      error: false,
      status,
      data,
      timestamp: new Date().toISOString(),
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders(),
      },
    }
  );
}

/**
 * Combine response data with rate limit headers.
 */
export function addRateLimitHeaders(
  response: Response,
  rateLimitHeaders: Record<string, string>
): Response {
  const headers = new Headers(response.headers);
  Object.entries(rateLimitHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Simple payload hash for duplicate detection.
 * Uses SHA-256 for cryptographic security.
 */
async function hashPayload(payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}

/**
 * Get default error code from HTTP status.
 */
function getDefaultErrorCode(status: number): string {
  const codes: Record<number, string> = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    408: "REQUEST_TIMEOUT",
    409: "CONFLICT",
    413: "PAYLOAD_TOO_LARGE",
    415: "UNSUPPORTED_MEDIA_TYPE",
    429: "TOO_MANY_REQUESTS",
    500: "INTERNAL_SERVER_ERROR",
    502: "BAD_GATEWAY",
    503: "SERVICE_UNAVAILABLE",
    504: "GATEWAY_TIMEOUT",
  };
  return codes[status] || "ERROR";
}

/**
 * Clear payload tracking (useful for testing or maintenance).
 */
export function clearPayloadTracking(): void {
  _payloadHashes.clear();
}
