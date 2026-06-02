// ═══════════════════════════════════════════════════════════════
// SOSphere — Complete Logout Helper  (S-H5)
// ─────────────────────────────────────────────────────────────
// CRIT-#1 (2026-04-27): also wipes IndexedDB so a shared device
// cannot leak the previous user's queued SOS / GPS / audio / chat.
// CRIT-#4 (2026-04-27): also resets the Zustand dashboard store and
// removes the legacy non-prefixed `sos_reg_result` key so a tenant
// switch on the same browser tab does not show the previous tenant's
// company / employees / emergencies / zones.
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./supabase-client";
import { clearPermissionCache } from "./server-permission";
import { clearRoleCache } from "./authenticated-role";
import { clearTenantCache } from "./tenant";
import { clearCompanyIdCache } from "./data-layer";
import { purgeAllOfflineData } from "../offline-database";
import { clearDashboardStore } from "../stores/dashboard-store";
import { clearServerTier } from "../subscription-service";
import { clearServerBuddyPairs } from "../shared-store";
import { clearGeofenceState } from "../geofence-service";
import { clearDiscreetSessionState } from "../discreet-session-service";
import { clearAttendanceCache } from "../attendance-service";
import { clearComplianceSummaryCache } from "../compliance-summary-service";

const SOSPHERE_KEEP_KEYS: Set<string> = new Set([
  "sosphere_pin_salt",
  "sosphere_biometric_lock_enabled",
  "sosphere_db_migration_errors",
]);

// Audit 2026-05-01 (lifesaving UX fix): the dashboard PIN is now
// stored under user-scoped keys (sosphere_dashboard_pin:<uuid>) so
// each user on a shared device keeps their own PIN. Logout MUST NOT
// wipe these — otherwise the user is forced to re-set their PIN on
// every login, which makes the pin-setup screen indistinguishable
// from pin-verify and led to a real production confusion the user
// experienced as "wrong PIN logged me in" (it was actually a fresh
// PIN setup they didn't realize they were doing).
const SOSPHERE_KEEP_PREFIXES: readonly string[] = [
  "sosphere_dashboard_pin:",
];
const SOSPHERE_PREFIX = "sosphere_";

// CRIT-#4: legacy keys that pre-date the sosphere_ prefix convention.
// They carry tenant-scoped data (company plan, employee count, zones from
// CSV) that the broad `sosphere_` sweep above misses. Add to this list
// any future legacy key that holds per-tenant state.
const LEGACY_TENANT_KEYS: readonly string[] = [
  "sos_reg_result",
];

export async function completeLogout(): Promise<void> {
  // 2026-05-31 CRIT-2 refactor: clear the in-memory authoritative tier
  // so the next user on this device does NOT inherit the previous
  // user's paid tier (subscription-service holds a module-level
  // _serverTier that survives logout otherwise). Also removes the
  // localStorage bootstrap cache for the same reason.
  try { clearServerTier(); } catch { /* best effort */ }
  // 2026-05-31 CRIT-4 refactor: same reasoning — buddy pairs are
  // company-scoped data; clearing prevents inter-user/inter-tenant
  // leakage on a shared device.
  try { clearServerBuddyPairs(); } catch { /* best effort */ }
  // 2026-06-01 Phase 2 CRIT-3: clear cached zones + membership +
  // pending hysteresis buffer so the next user on this device does
  // not inherit the previous tenant's zone definitions and does not
  // start with a stale "inside" state that could miss an EXIT event.
  try { clearGeofenceState(); } catch { /* best effort */ }
  // 2026-06-01 Phase 2 CRIT-9: clear cached discreet-session pointer +
  // localStorage bootstrap so a shared device cannot resume the previous
  // user's discreet session after logout.
  try { clearDiscreetSessionState(); } catch { /* best effort */ }
  // 2026-06-02 attendance refactor: clear cached checkin feed so the
  // next user on this device does NOT see the previous tenant's
  // attendance roll-up (CRIT-#4 cross-tenant leak class).
  try { clearAttendanceCache(); } catch { /* best effort */ }
  // 2026-06-02 compliance refactor (8th pattern app): clear cached
  // PDF summary so a shared device cannot leak the previous tenant's
  // KPIs into the next user's session.
  try { clearComplianceSummaryCache(); } catch { /* best effort */ }
  try { clearPermissionCache(); } catch { /* best effort */ }
  try { clearRoleCache(); } catch { /* best effort */ }
  try { clearTenantCache(); } catch { /* best effort */ }
  // E1.6-PHASE2 (2026-05-04): drop the cached JWT-derived companyId so a
  // tenant switch on the same browser tab cannot leak the previous tenant's
  // id into fetchEmployees / fetchEmergencies / fetchZones for up to 5 min.
  try { clearCompanyIdCache(); } catch { /* best effort */ }

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
    // CRIT-#4: also remove legacy tenant keys that pre-date the sosphere_
    // prefix convention. Without this, the dashboard store would re-seed
    // companyState from sos_reg_result on the next login (cross-tenant leak).
    for (const k of LEGACY_TENANT_KEYS) {
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

  // CRIT-#4: clear the in-memory Zustand dashboard store. Order matters:
  // localStorage is ALREADY purged above, so reset() (which re-builds
  // initial state from localStorage) sees the post-purge state, not the
  // stale module-load snapshot. Done before signOut() so the
  // sosphere:logged-out listeners observe an empty store.
  try {
    clearDashboardStore();
  } catch (err) {
    console.warn("[complete-logout] clearDashboardStore failed (non-fatal):", err);
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
