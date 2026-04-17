// ═══════════════════════════════════════════════════════════════
// SOSphere — Onboarding Server Flag  (S-H4)
// ─────────────────────────────────────────────────────────────
// The client-side onboarding flow (welcome-onboarding.tsx) was
// tracking completion via localStorage only. That's fine for UX
// (skip the tour on re-visit) but it's trivially bypassable:
//   • Clearing localStorage "re-onboards" the user, which by
//     itself is harmless, but
//   • A dev-tools-edited flag can trick app-startup code into
//     thinking a new account has "already onboarded" and skip
//     required consent / GPS / permission prompts.
//
// The Phase-1 migration added `profiles.onboarding_completed`
// (boolean) + `profiles.onboarding_completed_at` (timestamp).
// RLS ensures a user can only write their own row, so the flag
// is server-authoritative.
//
// This module is a small wrapper. It's additive — callers can
// continue to use localStorage for fast UX while also reconciling
// with the server flag when a session is available.
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./supabase-client";

/**
 * Mark onboarding complete on the server for the CURRENT user.
 * Fire-and-forget; never throws. Should be called from the
 * completion handler in welcome-onboarding.tsx alongside (or
 * instead of) any localStorage write.
 */
export async function markOnboardingComplete(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      // Anonymous onboarding — nothing to persist server-side yet.
      // The next sign-in will run startup reconciliation.
      return false;
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (error) {
      console.warn("[onboarding-server] update failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[onboarding-server] unexpected error:", err);
    return false;
  }
}

/**
 * Check whether the CURRENT user has completed onboarding on the
 * server. Returns:
 *   • `true`  — server says onboarding is complete
 *   • `false` — server says onboarding is NOT complete
 *   • `null`  — no session OR network/RPC error (caller decides
 *               whether to fall back to localStorage)
 */
export async function hasCompletedOnboardingServer(): Promise<boolean | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return null;

    const { data, error } = await supabase
      .from("profiles")
      .select("onboarding_completed")
      .eq("id", user.id)
      .single();

    if (error) {
      // Row may not exist yet for a brand-new account — treat as
      // "not completed" if the error is a not-found code; any other
      // error returns null so caller can fall back gracefully.
      if (error.code === "PGRST116") return false; // no rows
      return null;
    }
    return data?.onboarding_completed === true;
  } catch {
    return null;
  }
}

/**
 * Best-effort reconciliation: if localStorage says onboarding is
 * done, push that to the server the next time a session is
 * available. Idempotent — if the server already has it, nothing
 * changes. Safe to call on every startup.
 */
export async function reconcileOnboardingFlag(): Promise<void> {
  try {
    const localFlag =
      typeof localStorage !== "undefined" &&
      localStorage.getItem("sosphere_onboarding_completed") === "1";
    if (!localFlag) return;

    const serverFlag = await hasCompletedOnboardingServer();
    // null = couldn't check; false = server says not done → push.
    if (serverFlag === false) {
      await markOnboardingComplete();
    }
  } catch {
    // Swallow — reconciliation is best-effort.
  }
}
