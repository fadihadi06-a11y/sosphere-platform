// ═══════════════════════════════════════════════════════════════
// SOSphere — Complete Logout Helper  (S-H5)
// ─────────────────────────────────────────────────────────────
// CRIT-#1 (2026-04-27): also wipes IndexedDB so a shared device
// cannot leak the previous user's queued SOS / GPS / audio / chat.
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./supabase-client";
import { clearPermissionCache } from "./server-permission";
import { clearRoleCache } from "./authenticated-role";
import { clearTenantCache } from "./tenant";
import { purgeAllOfflineData } from "../offline-database";

const SOSPHERE_KEEP_KEYS: Set<string> = new Set([
  "sosphere_pin_salt",
  "sosphere_biometric_lock_enabled",
  "sosphere_db_migration_errors",
]);

const SOSPHERE_KEEP_PREFIXES: readonly string[] = [];
const SOSPHERE_PREFIX = "sosphere_";

export async function completeLogout(): Promise<void> {
  try { clearPermissionCache(); } catch { /* best effort */ }
  try { clearRoleCache(); } catch { /* best effort */ }
  try { clearTenantCache(); } catch { /* best effort */ }

  try {
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (!key.startsWith(SOSPHERE_PREFIX)) continue;
      if (SOSPHERE_KEEP_KEYS.has(key)) continue;
      if (SOSPHERE_KEEP_PREFIXES.some((p) => key.startsWith(p))) continue;
      toDelete.push(key);
    }
    for (const k of toDelete) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
  } catch {
    /* localStorage unavailable */
  }

  try {
    const { clearDeviceFingerprint } = await import("./supabase-client");
    clearDeviceFingerprint();
  } catch {
    /* best effort */
  }

  // CRIT-#1: hard-purge IndexedDB BEFORE signOut. The signOut() dispatches
  // sosphere:logged-out which may wake listeners that try to write — we want
  // the DBs gone first so any such write fails loudly into a stale handle
  // (caught by the listeners' own try/catch) instead of repopulating the DB.
  try {
    const outcomes = await purgeAllOfflineData();
    const failed = Object.entries(outcomes).filter(([, v]) => v !== "deleted");
    if (failed.length > 0) {
      console.warn("[complete-logout] some offline DBs were not deleted cleanly:", outcomes);
    }
  } catch (err) {
    console.warn("[complete-logout] purgeAllOfflineData failed (non-fatal):", err);
  }

  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.warn("[complete-logout] supabase signOut failed:", err);
  }

  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("sosphere:logged-out"));
    }
  } catch { /* ignore */ }
}

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
