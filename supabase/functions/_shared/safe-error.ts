// ═══════════════════════════════════════════════════════════════
// SOSphere Edge Functions — Safe error response helper
// ─────────────────────────────────────────────────────────────
// CodeQL's `js/stack-trace-exposure` flags every Edge Function
// that puts `err.stack`, `err.message`, or `String(err)` into the
// response body. The risk is information disclosure: an attacker
// reading the error gets details about file paths, library
// versions, internal IDs, and the shape of error handling — all
// useful for crafting follow-up attacks.
//
// This helper unifies the contract for every error response we
// return from an Edge Function:
//
//   1) The FULL error detail (including stack) is logged to the
//      Edge Function console (server-side, never leaves the box).
//   2) The client receives a generic message + a correlation ID
//      they can give to support; we can then look it up in logs.
//   3) The HTTP status communicates the failure class.
//
// Usage:
//   try {
//     ...
//   } catch (err) {
//     return safeErrorResponse(err, 500, corsHeaders, "sos-alert.handle");
//   }
//
// The fourth argument is a short tag that identifies the call
// site in logs — pass the function name or operation name so
// you can grep the log later.
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a short correlation ID for logs ↔ client matching.
 * Uses crypto.randomUUID where available, falls back to a
 * timestamp+random string otherwise.
 */
function generateCorrelationId(): string {
  try {
    if (typeof globalThis !== "undefined" && globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID().slice(0, 8).toUpperCase();
    }
  } catch { /* fall through */ }
  // Fallback: timestamp36 + 4 hex chars (cryptographic strength
  // is not required here — this is a correlation ID, not a token).
  const ts = Date.now().toString(36).toUpperCase();
  const buf = new Uint8Array(2);
  try {
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(buf);
    } else {
      // eslint-disable-next-line no-restricted-syntax -- correlation-only, not security
      buf[0] = Math.floor(Math.random() * 256);
      buf[1] = Math.floor(Math.random() * 256);
    }
  } catch { /* ignore */ }
  const rand = Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return ts + "-" + rand;
}

/** Map of generic, client-safe messages keyed by HTTP status. */
const GENERIC_MESSAGE: Record<number, string> = {
  400: "Bad request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not found",
  409: "Conflict",
  422: "Validation failed",
  429: "Too many requests",
  500: "Internal error",
  502: "Upstream error",
  503: "Service unavailable",
  504: "Upstream timeout",
};

/**
 * Build a JSON Response that DOES NOT leak the underlying error
 * detail to the client. The full error (including stack) is
 * console.error()-logged with a correlation ID; the response body
 * contains only that correlation ID and a generic message.
 *
 * @param err   The caught error (unknown type).
 * @param status HTTP status code (default 500).
 * @param extraHeaders Extra response headers (e.g. CORS).
 * @param tag   Short string identifying the call site in logs.
 */
export function safeErrorResponse(
  err: unknown,
  status: number = 500,
  extraHeaders: Record<string, string> = {},
  tag: string = "unknown",
): Response {
  const correlationId = generateCorrelationId();

  // Server-side log: full detail, never reaches the client.
  // The CodeQL js/stack-trace-exposure rule examines the *response*
  // body, not console output, so this is safe.
  const detail = err instanceof Error
    ? { name: err.name, message: err.message, stack: err.stack }
    : { value: String(err) };
  console.error("[safe-error]", tag, correlationId, detail);

  const message = GENERIC_MESSAGE[status] ?? "Request failed";
  return new Response(
    JSON.stringify({
      error: message,
      correlationId,
    }),
    {
      status,
      headers: {
        ...extraHeaders,
        "Content-Type": "application/json",
      },
    },
  );
}

/**
 * Variant for probe / cleanup / observability Edge Functions
 * where exposing the error detail is intentional (the caller is
 * an admin-only probe, not a public API). Still logs full detail
 * and emits a correlation ID, but additionally returns a
 * truncated detail string in the response — capped at 200 chars
 * so we don't accidentally dump a 50-line stack into the JSON.
 *
 * The CodeQL rule will still fire on this helper because we
 * intentionally include the detail. If/when we want to silence
 * those alerts too, this is the single function to dismiss.
 */
export function probeErrorResponse(
  err: unknown,
  status: number = 500,
  extraHeaders: Record<string, string> = {},
  tag: string = "probe",
): Response {
  const correlationId = generateCorrelationId();
  const detail = err instanceof Error
    ? { name: err.name, message: err.message, stack: err.stack }
    : { value: String(err) };
  console.error("[probe-error]", tag, correlationId, detail);

  const message = GENERIC_MESSAGE[status] ?? "Probe failed";
  const truncated = (err instanceof Error ? err.message : String(err)).slice(0, 200);

  return new Response(
    JSON.stringify({
      error: message,
      correlationId,
      probeDetail: truncated,
    }),
    {
      status,
      headers: {
        ...extraHeaders,
        "Content-Type": "application/json",
      },
    },
  );
}
