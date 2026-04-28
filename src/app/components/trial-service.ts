/**
 * Individual Trial Service
 * ═══════════════════════════
 * One-time 7-day trial of the Elite tier for new individual users.
 * Opt-in (user must tap "Start Trial") and strictly one-shot — once
 * started, cannot be restarted whether it expired, was cancelled, or
 * the user switched devices within the same browser storage.
 *
 * Design contract
 *   • This module is the *single source of truth* for trial state.
 *     subscription-service.ts reads it through getEffectiveTier()
 *     and does NOT mutate the user's stored tier: when the trial
 *     expires, the user's original stored tier (typically "free")
 *     is unchanged and automatically back in effect.
 *   • No side effects outside localStorage writes. Never throws.
 *   • Timing is millisecond-based via Date.now(); callers get either
 *     an active status or a clean "expired / never-started" signal.
 *
 * Storage
 *   sosphere_trial_state  → { startedAt: number, durationMs: number,
 *                             status: "active" | "expired" | "cancelled",
 *                             tier: "elite" }
 *   (Absent = never started. Status field lets us distinguish
 *    "expired naturally" vs. "user cancelled early" for future
 *    analytics without another flag.)
 */

import type { SubscriptionTier } from "./subscription-service";

const TRIAL_KEY = "sosphere_trial_state";
const DEFAULT_TRIAL_DAYS = 7;

export interface TrialState {
  startedAt: number;   // ms since epoch
  durationMs: number;  // fixed at start time
  status: "active" | "expired" | "cancelled";
  tier: SubscriptionTier; // always "elite" in current release
}

export interface TrialStatus {
  /** True only while the trial is running (not expired, not cancelled). */
  active: boolean;
  /** True if the user has ever started a trial (active or past). */
  started: boolean;
  /** True if the trial ended naturally or was cancelled. */
  expired: boolean;
  /** Remaining time in ms. 0 when inactive. */
  remainingMs: number;
  /** Human-friendly remaining days (rounded up). 0 when inactive. */
  remainingDays: number;
  /** Which tier the trial grants (currently always "elite"). */
  tier: SubscriptionTier;
}

/* ──────────────────────────────────────────────────────────────── */
/*  Internals                                                       */
/* ──────────────────────────────────────────────────────────────── */

function readState(): TrialState | null {
  try {
    const raw = localStorage.getItem(TRIAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TrialState;
    // Sanity: reject malformed payloads
    if (typeof parsed?.startedAt !== "number") return null;
    if (typeof parsed?.durationMs !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeState(state: TrialState): void {
  try {
    localStorage.setItem(TRIAL_KEY, JSON.stringify(state));
  } catch {
    /* non-fatal */
  }
}

/* ──────────────────────────────────────────────────────────────── */
/*  Public API                                                      */
/* ──────────────────────────────────────────────────────────────── */

export function getTrialStatus(): TrialStatus {
  const s = readState();
  if (!s) {
    return {
      active: false,
      started: false,
      expired: false,
      remainingMs: 0,
      remainingDays: 0,
      tier: "elite",
    };
  }

  const now = Date.now();
  const elapsed = now - s.startedAt;
  const remainingMs = Math.max(0, s.durationMs - elapsed);
  const naturallyExpired = remainingMs === 0;

  // Auto-promote active→expired once the clock runs out, so repeated
  // reads converge on a single truth.
  if (s.status === "active" && naturallyExpired) {
    writeState({ ...s, status: "expired" });
  }

  const active = s.status === "active" && !naturallyExpired;
  const expired = s.status !== "active" || naturallyExpired;

  return {
    active,
    started: true,
    expired,
    remainingMs: active ? remainingMs : 0,
    remainingDays: active ? Math.max(1, Math.ceil(remainingMs / 86_400_000)) : 0,
    tier: s.tier,
  };
}

/** True when the Elite tier should be granted via the trial. */
export function isTrialActive(): boolean {
  return getTrialStatus().active;
}

/** True if the user has ever started a trial (regardless of outcome). */
export function hasEverStartedTrial(): boolean {
  return readState() !== null;
}

/**
 * @deprecated CRIT-#12: localStorage-only trial starter is exploitable —
 * a user wiping browser storage can re-arm the trial indefinitely.
 * Use `startTrialAsync()` instead, which calls the server-side RPC
 * `start_civilian_trial` first and only writes localStorage on approval.
 *
 * Kept for backward-compat with offline / pre-auth call sites that
 * cannot await an RPC. SHOULD NOT be called from new code.
 */
export function startTrial(days: number = DEFAULT_TRIAL_DAYS): boolean {
  if (readState()) return false;
  writeState({
    startedAt: Date.now(),
    durationMs: Math.max(1, days) * 86_400_000,
    status: "active",
    tier: "elite",
  });
  return true;
}

/* ──────────────────────────────────────────────────────────────── */
/* ──────────────────────────────────────────────────────────────── */
/*  CRIT-#12 (2026-04-28) — server-side anti-replay trial start   */
/* ──────────────────────────────────────────────────────────────── */

export interface StartTrialResult {
  success: boolean;
  /** Why the start failed (or "already_used", "unauthorized", etc.) */
  reason?: string;
  /** ISO timestamp when the trial actually started (server time). */
  startedAt?: string;
  /** ISO timestamp when the trial will expire. */
  expiresAt?: string;
  /** Plan that was started (always "elite" today). */
  plan?: string;
  /** True if the failure was a network/RPC error rather than policy. */
  networkError?: boolean;
}

/**
 * CRIT-#12: server-side-validated trial start.
 *
 * Calls `start_civilian_trial` RPC FIRST. The RPC checks the
 * `civilian_trial_history` table (1 row per user lifetime) and only
 * approves if no row exists. If approved, this function then writes
 * localStorage so the existing UI hooks continue to work unchanged.
 *
 * If the RPC denies (trial already used) or fails (network), we do
 * NOT write localStorage. Without localStorage, the rest of the app
 * sees the user as "free tier" and gates Elite features accordingly.
 *
 * FAIL-CLOSED: any RPC error (network, missing client, server error)
 * blocks the trial start. Better to deny a legitimate first-time user
 * (who can retry with connectivity) than to grant an exploitative
 * second trial.
 */
export async function startTrialAsync(
  days: number = DEFAULT_TRIAL_DAYS,
): Promise<StartTrialResult> {
  // Local fast-path: if localStorage already has an active/cancelled
  // trial for THIS browser, no need to hit the server.
  if (readState()) {
    return { success: false, reason: "trial_already_used_local" };
  }

  // Lazy-load supabase to keep this module dependency-light.
  let supabase: any;
  try {
    const mod = await import("./api/supabase-client");
    supabase = mod.supabase;
    if (!supabase) {
      return { success: false, reason: "supabase_not_configured", networkError: true };
    }
  } catch (e) {
    console.warn("[trial-service] supabase import failed:", e);
    return { success: false, reason: "supabase_import_failed", networkError: true };
  }

  try {
    const { data, error } = await supabase.rpc("start_civilian_trial", {
      p_plan: "elite",
      p_duration_days: Math.max(1, Math.min(90, days)),
    });
    if (error) {
      console.warn("[trial-service] RPC error:", error);
      return { success: false, reason: "rpc_error", networkError: true };
    }
    if (!data || data.success !== true) {
      // Server denied (trial already used / unauthorized / invalid plan).
      return {
        success: false,
        reason: data?.reason ?? "server_denied",
        startedAt: data?.started_at,
        expiresAt: data?.expires_at,
        plan: data?.plan,
      };
    }
    // Server approved — write localStorage so rest of the app sees the trial.
    const serverStartMs = data.started_at
      ? new Date(data.started_at).getTime()
      : Date.now();
    const serverExpiresMs = data.expires_at
      ? new Date(data.expires_at).getTime()
      : serverStartMs + Math.max(1, days) * 86_400_000;
    writeState({
      startedAt: serverStartMs,
      durationMs: Math.max(1, serverExpiresMs - serverStartMs),
      status: "active",
      tier: "elite",
    });
    return {
      success: true,
      startedAt: data.started_at,
      expiresAt: data.expires_at,
      plan: data.plan,
    };
  } catch (e) {
    console.warn("[trial-service] startTrialAsync threw:", e);
    return { success: false, reason: "exception", networkError: true };
  }
}

/**
 * Cancel an in-progress trial immediately. No-op if no trial exists
 * or it's already ended. Cancellation is permanent — the user cannot
 * start a new trial.
 */
export function cancelTrial(): void {
  const s = readState();
  if (!s) return;
  if (s.status !== "active") return;
  writeState({ ...s, status: "cancelled" });
}

/** Default trial length (for UI copy). */
export function getTrialDurationDays(): number {
  return DEFAULT_TRIAL_DAYS;
}
