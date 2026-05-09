// ═══════════════════════════════════════════════════════════════
// SOSphere — L2-A: Twilio circuit-breaker client (edge-side)
// ─────────────────────────────────────────────────────────────
// Thin wrapper around the public.twilio_breaker_check / record RPCs
// that lives in supabase/functions/twilio-call and twilio-sms. Each
// edge function:
//   1. await checkBreaker(client) before its fetch() to Twilio
//      → if .allow === false, short-circuit with a 503-style response
//        and DO NOT call fetch
//   2. await recordBreaker(client, ok) after the fetch
//      → ok=true on HTTP 2xx, false on anything else (including throw)
//
// SAFETY
//   • Both helpers swallow their own errors. A breaker-DB outage MUST
//     NOT block a real Twilio call — the breaker is a defensive wrapper,
//     not the primary path. On RPC failure we return allow=true and
//     log a warning. Fail-OPEN by design.
//   • The RPCs require service_role; we expect the caller to pass a
//     service-role client.
// ═══════════════════════════════════════════════════════════════

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface BreakerCheckResult {
  /** Current state from the DB. May have been auto-transitioned by check(). */
  state: "closed" | "open" | "half_open";
  /** True iff the caller may proceed with the Twilio fetch. */
  allow: boolean;
  /** When the breaker entered the 'open' state, if applicable. */
  openedAt: string | null;
  /** How many failures are currently tracked in the rolling window. */
  failureCount: number;
}

export interface BreakerRecordResult {
  state: "closed" | "open" | "half_open";
  previousState: "closed" | "open" | "half_open";
  transitioned: boolean;
}

/**
 * Ask the breaker whether we may call Twilio right now.
 *
 * Returns allow=true on any RPC error (fail-open) so a breaker-DB
 * outage cannot itself block emergency dispatch.
 */
export async function checkBreaker(
  client: SupabaseClient,
  key = "global",
): Promise<BreakerCheckResult> {
  try {
    const { data, error } = await client.rpc("twilio_breaker_check", { p_key: key });
    if (error) {
      console.warn("[twilio-breaker] check failed (fail-open):", error.message);
      return { state: "closed", allow: true, openedAt: null, failureCount: 0 };
    }
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      state: (d.state as BreakerCheckResult["state"]) ?? "closed",
      allow: Boolean(d.allow),
      openedAt: (d.opened_at as string | null) ?? null,
      failureCount: Number(d.failure_count ?? 0),
    };
  } catch (err) {
    console.warn("[twilio-breaker] check threw (fail-open):", err);
    return { state: "closed", allow: true, openedAt: null, failureCount: 0 };
  }
}

/**
 * Record the outcome of a Twilio call. Best-effort — never throws.
 */
export async function recordBreaker(
  client: SupabaseClient,
  ok: boolean,
  key = "global",
): Promise<BreakerRecordResult | null> {
  try {
    const { data, error } = await client.rpc("twilio_breaker_record", {
      p_key: key,
      p_success: ok,
    });
    if (error) {
      console.warn("[twilio-breaker] record failed:", error.message);
      return null;
    }
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      state: (d.state as BreakerRecordResult["state"]) ?? "closed",
      previousState: (d.previous_state as BreakerRecordResult["previousState"]) ?? "closed",
      transitioned: Boolean(d.transitioned),
    };
  } catch (err) {
    console.warn("[twilio-breaker] record threw:", err);
    return null;
  }
}

/**
 * Standard short-circuit response when the breaker is open. Used by
 * twilio-call and twilio-sms so callers (and the dashboard's Pipeline
 * Health page) get a consistent shape they can detect.
 */
export function breakerShortCircuitResponse(
  check: BreakerCheckResult,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      error: "twilio_breaker_open",
      message: "Twilio circuit breaker is open — call short-circuited to protect against cascading failure.",
      breaker: {
        state: check.state,
        opened_at: check.openedAt,
        failure_count: check.failureCount,
      },
    }),
    {
      // 503 Service Unavailable is the right code: the upstream is
      // (deemed) unavailable. The caller can decide to fall back.
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
