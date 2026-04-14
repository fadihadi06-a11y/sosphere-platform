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
 * Begin the one-time Elite trial. Returns true if it was actually
 * started; false if the user has already used their trial (we do
 * not re-arm; one shot only).
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
