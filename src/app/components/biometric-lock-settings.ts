// ═══════════════════════════════════════════════════════════════
// SOSphere — Biometric Lock Setting
// ─────────────────────────────────────────────────────────────
// Tiny persistence layer for the "Biometric Lock" toggle exposed
// in Privacy & Security. Kept in its own module so both the
// PrivacyScreen (writer) and mobile-app.tsx root lock gate
// (reader) can use the same key without a circular import.
//
// Note: enrollment itself (credential ID, registration) is managed
// inside biometric-gate.ts. This flag only tracks whether the user
// WANTS the lock to gate app entry.
// ═══════════════════════════════════════════════════════════════

const KEY = "sosphere_biometric_lock_enabled";

/** Returns true if the user has opted into biometric app-unlock. */
export function getBiometricLockEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the opt-in state. Null-safe for SSR / locked storage. */
export function setBiometricLockEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked (private mode / quota) — best-effort only.
    // The runtime default is "off" so data-loss fails safely.
  }
}
