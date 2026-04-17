// ═══════════════════════════════════════════════════════════════
// SOSphere — Complete Logout Helper  (S-H5)
// ─────────────────────────────────────────────────────────────
// `supabase.auth.signOut()` only revokes the Supabase session.
// On its own it leaves a pile of SOSphere-specific state behind
// in localStorage / IndexedDB / in-memory caches that the next
// user of the device can read:
//
//   • dashboard auth session         (role, permissions cached)
//   • neighbor-alert settings        (privacy-sensitive)
//   • subscription tier cache        (can be edited pre-login)
//   • permission-check cache         (S-C2)
//   • emergency-contacts list        (previous user's contacts)
//   • language / onboarding flags    (cosmetic only)
//
// completeLogout() is the ONLY acceptable way to sign a user out.
// It:
//   1. Clears the permission cache (so the next session's checks
//      start fresh against the authoritative RPC).
//   2. Clears all SOSphere-prefixed localStorage keys.
//   3. Calls supabase.auth.signOut() to revoke the Bearer token
//      server-side.
//   4. Dispatches a `sosphere:logged-out` custom event so any
//      singleton services (heartbeat loops, neighbor watchers,
//      replay timers) can tear themselves down.
//
// Safe to call multiple times (idempotent). Never throws — logout
// must succeed even when the network is down so the user never
// gets stranded in a "logout failed, try again" loop.
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./supabase-client";
import { clearPermissionCache } from "./server-permission";
import { clearRoleCache } from "./authenticated-role";
import { clearTenantCache } from "./tenant";

// Keys owned by SOSphere. Anything NOT on this list is left alone
// so we don't nuke unrelated apps on a shared browser profile.
// Rule of thumb: if the key is written by this codebase, add it here.
const SOSPHERE_LOCAL_STORAGE_KEYS: string[] = [
  "sosphere_dashboard_auth",
  "sosphere_lang",
  "sosphere_emergency_contacts",
  "sosphere_neighbor_alert_settings",
  "sosphere_subscription_tier",
  "sosphere_last_known_position",
  "sosphere_consent_terms",
  "sosphere_consent_gps",
  "sosphere_onboarding_completed",
  "sosphere_biometric_last_verified",
  "sosphere_session_fingerprint",
];

// Key prefixes owned by SOSphere — we also scan for these so
// per-user keys like `sosphere_totp_<uid>` and any future
// `sosphere_<feature>_<scope>` keys get swept.
const SOSPHERE_KEY_PREFIXES: string[] = [
  "sosphere_totp_",
  "sosphere_cache_",
  "sosphere_audit_",
];

/**
 * Perform a complete SOSphere logout. Safe on the main thread —
 * the Supabase call is awaited but never thrown; local cleanup
 * runs even if the network step fails.
 */
export async function completeLogout(): Promise<void> {
  // 1. Drop in-memory caches immediately so any mid-flight
  //    security checks read from the new (logged-out) auth context.
  try { clearPermissionCache(); } catch { /* best effort */ }
  try { clearRoleCache(); } catch { /* best effort */ }
  try { clearTenantCache(); } catch { /* best effort */ }

  // 2. Clear SOSphere-owned localStorage keys.
  try {
    // Fixed keys
    for (const k of SOSPHERE_LOCAL_STORAGE_KEYS) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
    // Prefix scan — removeItem is O(n) so collect first, then remove
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (SOSPHERE_KEY_PREFIXES.some(p => key.startsWith(p))) {
        toDelete.push(key);
      }
    }
    for (const k of toDelete) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
  } catch {
    // localStorage may be unavailable (Safari private mode, etc.) — best effort.
  }

  // 3. Revoke the Supabase session server-side. Never throw: a
  //    network failure here must not prevent local cleanup from
  //    being considered "done".
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.warn("[complete-logout] supabase signOut failed (continuing):", err);
  }

  // 4. Fire a DOM event so other singleton services (heartbeat,
  //    neighbor watcher, replay timers) can unsubscribe / stop.
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("sosphere:logged-out"));
    }
  } catch { /* ignore */ }
}

/**
 * Subscribe to the logout event. Returns an unsubscribe function.
 * Services that hold timers/listeners should call this at mount
 * so they can clean up when the user signs out without needing a
 * central orchestrator.
 */
export function onLogout(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const wrapped = () => {
    try { handler(); } catch (err) {
      console.warn("[complete-logout] handler threw:", err);
    }
  };
  window.addEventListener("sosphere:logged-out", wrapped);
  return () => window.removeEventListener("sosphere:logged-out", wrapped);
}
