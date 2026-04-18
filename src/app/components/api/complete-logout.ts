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
//   1. Clears in-memory caches (permission / role / tenant) so any
//      mid-flight security checks read from the new auth context.
//   2. Sweeps ALL SOSphere-prefixed localStorage keys (profile,
//      emergency contacts, active SOS, incident history, admin +
//      employee profiles, company_id, investigations, etc.) EXCEPT
//      a small KEEP list for device-persistent items (PIN salt,
//      biometric lock preference).
//   3. Explicitly clears the device fingerprint key.
//   4. Calls supabase.auth.signOut() to revoke the Bearer token
//      server-side.
//   5. Dispatches a `sosphere:logged-out` custom event so any
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

// AUDIT-FIX (2026-04-18): the previous allowlist-based design was
// fragile — the list had typo'd key names (e.g. "sosphere_consent_terms"
// instead of the actual "sosphere_tos_consent") and was missing a
// dozen keys written by features added after the list was last curated.
// That meant logout LEFT PII behind: sosphere_individual_profile,
// sosphere_active_sos, sosphere_incident_history, sosphere_admin_profile,
// sosphere_employee_profile, sosphere_company_id — all survived logout
// and could be read by the next user on a shared device.
//
// NEW DESIGN: broad prefix sweep (anything starting with `sosphere_`
// is user-scoped and gets removed) + an EXPLICIT KEEP-LIST of device-
// persistent keys that intentionally outlive sessions.
//
// Keys we KEEP on logout:
//   • sosphere_pin_salt               — per-install salt for the
//     hashed duress/deactivation PINs. Losing it invalidates all
//     existing PIN hashes and forces the user to re-enter.
//   • sosphere_biometric_lock_enabled — device-level preference
//     ("this device uses biometric unlock") — applies to everyone
//     on this device, not a user secret.
//   • sosphere_db_migration_errors    — forensic breadcrumb from
//     IndexedDB upgrade. Useful for support even after logout.
const SOSPHERE_KEEP_KEYS: Set<string> = new Set([
  "sosphere_pin_salt",
  "sosphere_biometric_lock_enabled",
  "sosphere_db_migration_errors",
]);

// Keys we KEEP via prefix match (for any future per-device family).
const SOSPHERE_KEEP_PREFIXES: readonly string[] = [
  // (empty today — add here if a feature needs cross-session persistence)
];

// The prefix that identifies SOSphere-owned storage.
const SOSPHERE_PREFIX = "sosphere_";

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

  // 2. AUDIT-FIX: broad SOSphere-prefix sweep — remove any key that
  //    starts with `sosphere_` EXCEPT the ones in SOSPHERE_KEEP_KEYS /
  //    SOSPHERE_KEEP_PREFIXES. This is resilient to typos in feature
  //    code and automatically covers new per-user keys as the app
  //    grows. Collect first, then delete — localStorage.key(i) indices
  //    shift after each removeItem().
  try {
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (!key.startsWith(SOSPHERE_PREFIX)) continue;    // not ours
      if (SOSPHERE_KEEP_KEYS.has(key)) continue;          // explicit keep
      if (SOSPHERE_KEEP_PREFIXES.some(p => key.startsWith(p))) continue;
      toDelete.push(key);
    }
    for (const k of toDelete) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
  } catch {
    // localStorage may be unavailable (Safari private mode, etc.) — best effort.
  }

  // 3. AUDIT-FIX: explicitly clear the device-fingerprint key.
  //    Previously this was attempted via the allowlist under a wrong
  //    name ("sosphere_session_fingerprint") so never actually
  //    happened. The real key is FINGERPRINT_KEY in supabase-client.ts.
  //    Swept by the prefix scan above when we're on the same session,
  //    but we call the exported helper explicitly so any future
  //    relocation of the key is honoured.
  try {
    const { clearDeviceFingerprint } = await import("./supabase-client");
    clearDeviceFingerprint();
  } catch { /* best effort */ }

  // 4. Revoke the Supabase session server-side. Never throw: a
  //    network failure here must not prevent local cleanup from
  //    being considered "done".
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.warn("[complete-logout] supabase signOut failed (continuing):", err);
  }

  // 5. Fire a DOM event so other singleton services (heartbeat,
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
