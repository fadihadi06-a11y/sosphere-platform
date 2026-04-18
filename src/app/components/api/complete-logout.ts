// ═══════════════════════════════════════════════════════════════
// SOSphere — Complete Logout Helper  (S-H5)
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./supabase-client";
import { clearPermissionCache } from "./server-permission";
import { clearRoleCache } from "./authenticated-role";
import { clearTenantCache } from "./tenant";

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
