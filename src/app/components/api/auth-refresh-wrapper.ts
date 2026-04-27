// ═══════════════════════════════════════════════════════════════════════════
// auth-refresh-wrapper — A-16 (2026-04-27)
// ─────────────────────────────────────────────────────────────────────────
// SUPABASE auth refresh strategy is PASSIVE: the SDK's `autoRefreshToken:
// true` flag refreshes the token only when an SDK method discovers it is
// expired. Inflight requests that started with a still-fresh token but
// arrived after expiry get a 401 from the server with NO automatic retry.
//
// Without intervention this manifests as a SILENT DROP in safety-critical
// paths:
//   - SOS triggers fail and the user thinks the alert went out
//   - Dispatcher actions (broadcast / forward / mark_reviewed) fail with
//     a generic error toast that doesn't say "your session expired"
//   - Evidence vault uploads queue to IndexedDB and never recover until
//     the user manually retries
//   - Realtime subscribe handshake fails and listeners never fire
//
// This module provides `withAuthRefresh(fn)` — a wrapper that:
//   1. Calls fn() once
//   2. If the result indicates 401 / unauthorized / JWT expired, calls
//      supabase.auth.refreshSession()
//   3. If refresh succeeds, calls fn() once more (max 1 retry)
//   4. If refresh fails OR retry fails, bubbles the ORIGINAL error so
//      the caller still gets honest feedback (no false success)
//
// The wrapper is applied at the call site, not as a global fetch
// interceptor, so each consumer remains self-contained and testable.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, SUPABASE_CONFIG } from "./supabase-client";

// ── 401 detector ────────────────────────────────────────────────
// Supabase errors reach us in several shapes depending on the call site:
//   - HTTP fetch:        { status: 401, statusText: "Unauthorized" }
//   - functions.invoke:  { error: { message: "..." } } where the message
//                        contains "401" or "JWT expired" or "Unauthorized"
//   - PostgREST:         { status: 401, code: "PGRST301", ... } or { code: "42501" }
//   - storage.upload:    { error: { message: "...", statusCode: "401" } }
//   - thrown Error:      .message contains "JWT expired" / "401"
//
// We accept any of these; false positives are cheap (one extra refresh).
export function isAuth401(err: unknown): boolean {
  if (err == null) return false;
  // Direct status code
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (e.status === 401 || e.statusCode === 401 || e.statusCode === "401") return true;
    if (typeof e.code === "string" && (e.code === "PGRST301" || e.code === "42501")) return true;
    // Nested .error.* (functions.invoke shape)
    if (e.error && typeof e.error === "object") {
      const inner = e.error as Record<string, unknown>;
      if (inner.status === 401 || inner.statusCode === 401 || inner.statusCode === "401") return true;
      if (typeof inner.message === "string" && /\b401\b|jwt expired|jwt_expired|invalid jwt|unauthorized/i.test(inner.message)) return true;
    }
    // Top-level message
    if (typeof e.message === "string" && /\b401\b|jwt expired|jwt_expired|invalid jwt|unauthorized/i.test(e.message)) return true;
  }
  if (err instanceof Error) {
    return /\b401\b|jwt expired|jwt_expired|invalid jwt|unauthorized/i.test(err.message);
  }
  return false;
}

// ── Result-shape detector ──────────────────────────────────────
// Many Supabase methods return `{ data, error }` instead of throwing.
// withAuthRefresh handles both: a returned `error` field with a 401
// triggers the same refresh+retry path as a thrown 401.
export function isAuth401Result(result: unknown): boolean {
  if (result && typeof result === "object" && "error" in result) {
    return isAuth401((result as { error: unknown }).error);
  }
  return false;
}

// ── Concurrency guard ──────────────────────────────────────────
// If 50 inflight requests all 401 at once we don't want 50 parallel
// refresh calls. Single in-flight refresh promise is shared.
let _refreshInFlight: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  if (!SUPABASE_CONFIG.isConfigured) return false;
  if (_refreshInFlight) return _refreshInFlight;
  _refreshInFlight = (async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        console.warn("[A-16] auth.refreshSession failed:", error.message);
        return false;
      }
      return Boolean(data?.session);
    } catch (e) {
      console.warn("[A-16] auth.refreshSession threw:", e);
      return false;
    } finally {
      // Hold for a tick to coalesce simultaneous callers, then clear.
      setTimeout(() => { _refreshInFlight = null; }, 0);
    }
  })();
  return _refreshInFlight;
}

// ── Public wrapper ──────────────────────────────────────────────
export interface WithAuthRefreshOptions {
  /** maximum retries on 401 (default 1; never set higher than 2) */
  maxRetries?: number;
  /** label for logs — helps identify which call site is bouncing */
  label?: string;
}

/**
 * Wrap a function call with one-shot 401-detect → refresh → retry.
 *
 * fn must be idempotent — i.e., it can safely be called twice without
 * causing duplicate side effects on the server (the server should
 * dedupe via emergency_id / event_id / similar). All SOSphere
 * server-triggered paths already enforce idempotency (B-C4/B-H1
 * atomic claim, F-D record_stripe_unmapped_event, etc.).
 */
export async function withAuthRefresh<T>(
  fn: () => Promise<T>,
  opts: WithAuthRefreshOptions = {},
): Promise<T> {
  const maxRetries = Math.max(0, Math.min(2, opts.maxRetries ?? 1));
  const label = opts.label ?? "withAuthRefresh";
  let attempt = 0;
  let lastErr: unknown = null;

  while (attempt <= maxRetries) {
    try {
      const result = await fn();
      // If the call completed but the RESULT carries a 401 (functions.invoke /
      // PostgREST shape), treat that as a 401 too.
      if (attempt < maxRetries && isAuth401Result(result)) {
        console.log(`[A-16] ${label} returned 401 result; refreshing...`);
        const ok = await refreshOnce();
        if (!ok) return result;  // refresh failed → return original 401 result honestly
        attempt++;
        continue;
      }
      return result;
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries && isAuth401(e)) {
        console.log(`[A-16] ${label} threw 401; refreshing...`);
        const ok = await refreshOnce();
        if (!ok) throw e;       // refresh failed → bubble original
        attempt++;
        continue;
      }
      throw e;
    }
  }
  // Exhausted retries — bubble last error
  throw lastErr;
}

// ── Convenience: wrap a Supabase functions.invoke ───────────────
// Saves the call-site boilerplate; identical semantics to withAuthRefresh.
export async function invokeWithAuthRefresh<T = unknown>(
  fnName: string,
  body?: unknown,
): Promise<{ data: T | null; error: unknown }> {
  return withAuthRefresh(
    () => supabase.functions.invoke(fnName, body !== undefined ? { body } : {}) as Promise<{ data: T | null; error: unknown }>,
    { label: `invoke:${fnName}` },
  );
}
