// ═══════════════════════════════════════════════════════════════
// SOSphere — completeLogout test suite (AUDIT-FIX verification)
// ─────────────────────────────────────────────────────────────
// CRIT-#1 (2026-04-27): pins the IndexedDB hard-purge contract.
// CRIT-#4 (2026-04-27): pins the dashboard-store reset + legacy
// sos_reg_result removal contract.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, String(value)); }
  removeItem(key: string) { this.store.delete(key); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
}

(globalThis as any).localStorage = (globalThis as any).localStorage ?? new MemoryStorage();
(globalThis as any).window = (globalThis as any).window ?? {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
};
(globalThis as any).CustomEvent = (globalThis as any).CustomEvent ?? class MockCustomEvent {
  type: string;
  detail: unknown;
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
  }
};

const { signOutMock, clearDeviceFingerprintMock } = vi.hoisted(() => ({
  signOutMock: vi.fn().mockResolvedValue({ error: null }),
  clearDeviceFingerprintMock: vi.fn(),
}));

vi.mock("../api/supabase-client", () => ({
  supabase: {
    auth: {
      signOut: signOutMock,
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  },
  clearDeviceFingerprint: clearDeviceFingerprintMock,
}));
vi.mock("../api/server-permission", () => ({ clearPermissionCache: vi.fn() }));
vi.mock("../api/authenticated-role", () => ({ clearRoleCache: vi.fn() }));
vi.mock("../api/tenant", () => ({ clearTenantCache: vi.fn() }));

const { purgeMock } = vi.hoisted(() => ({
  purgeMock: vi.fn().mockResolvedValue({
    sosphere_offline: "deleted",
    sosphere_discreet_audio: "deleted",
    sosphere_emergency: "deleted",
  }),
}));
vi.mock("../offline-database", () => ({ purgeAllOfflineData: purgeMock }));

// CRIT-#4: completeLogout now also resets the Zustand dashboard store.
const { clearStoreMock } = vi.hoisted(() => ({ clearStoreMock: vi.fn() }));
vi.mock("../stores/dashboard-store", () => ({ clearDashboardStore: clearStoreMock }));

import { completeLogout } from "../api/complete-logout";

describe("completeLogout — broad SOSphere-prefix sweep", () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
    purgeMock.mockClear();
    purgeMock.mockResolvedValue({
      sosphere_offline: "deleted",
      sosphere_discreet_audio: "deleted",
      sosphere_emergency: "deleted",
    });
    signOutMock.mockClear();
    signOutMock.mockResolvedValue({ error: null });
    clearStoreMock.mockClear();
    clearStoreMock.mockReset();
  });

  it("removes ALL sosphere_-prefixed user keys (the actual keys in use)", async () => {
    const leakingKeys = [
      "sosphere_individual_profile","sosphere_active_sos","sosphere_incident_history",
      "sosphere_admin_profile","sosphere_admin_phone","sosphere_employee_profile",
      "sosphere_employee_avatar","sosphere_company_id","sosphere_emergency_contacts",
      "sosphere_dashboard_auth","sosphere_dashboard_pin","sosphere_tos_consent",
      "sosphere_gps_consent","sosphere_onboarding_completed","sosphere_lang",
      "sosphere_app_lang","sosphere_device_fp","sosphere_neighbor_alert_settings",
      "sosphere_journeys","sosphere_investigations","sosphere_risks","sosphere_shifts",
      "sosphere_timeline_event","sosphere_sensor_events","sosphere_totp_user-abc123",
      "sosphere_audit_log","sosphere_audit_retry_queue","sosphere_sar_prefill",
      "sosphere_new_investigation","sosphere_last_sync","sosphere_fp_grace_until",
    ];
    for (const k of leakingKeys) localStorage.setItem(k, "leak-me");
    await completeLogout();
    for (const k of leakingKeys) {
      expect(localStorage.getItem(k), `key ${k} should be removed`).toBeNull();
    }
  });

  it("KEEPS device-persistent keys that should survive logout", async () => {
    const keepKeys = [
      ["sosphere_pin_salt", "16-byte-random-salt"],
      ["sosphere_biometric_lock_enabled", "1"],
      ["sosphere_db_migration_errors", '{"version":4,"failed":[]}'],
    ];
    for (const [k, v] of keepKeys) localStorage.setItem(k, v);
    await completeLogout();
    for (const [k, expected] of keepKeys) {
      expect(localStorage.getItem(k), `key ${k} should be preserved`).toBe(expected);
    }
  });

  it("does NOT touch non-sosphere keys (other apps on shared browser)", async () => {
    const foreignKeys = [
      ["google_oauth_redirect", "some-google-cookie"],
      ["my_other_app_pref", "foo"],
      ["github-token", "ghp_abc"],
    ];
    for (const [k, v] of foreignKeys) localStorage.setItem(k, v);
    await completeLogout();
    for (const [k, expected] of foreignKeys) {
      expect(localStorage.getItem(k), `foreign key ${k} must not be touched`).toBe(expected);
    }
  });

  it("is idempotent — second call after clean state is a no-op", async () => {
    localStorage.setItem("sosphere_individual_profile", "me");
    await completeLogout();
    expect(localStorage.getItem("sosphere_individual_profile")).toBeNull();
    await expect(completeLogout()).resolves.toBeUndefined();
  });

  it("fires sosphere:logged-out event exactly once", async () => {
    const dispatchSpy = vi.fn();
    (globalThis as any).window.dispatchEvent = dispatchSpy;
    await completeLogout();
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const evt = dispatchSpy.mock.calls[0][0];
    expect(evt.type).toBe("sosphere:logged-out");
  });

  // ─── CRIT-#1 (2026-04-27) — IndexedDB hard purge ──────────────
  it("CRIT-#1: purges all SOSphere IndexedDB databases on logout", async () => {
    await completeLogout();
    expect(purgeMock).toHaveBeenCalledTimes(1);
  });

  it("CRIT-#1: purges IndexedDB BEFORE supabase.auth.signOut() so listeners cannot repopulate", async () => {
    const order: string[] = [];
    purgeMock.mockImplementationOnce(async () => {
      order.push("purge");
      return { sosphere_offline: "deleted", sosphere_discreet_audio: "deleted", sosphere_emergency: "deleted" };
    });
    signOutMock.mockImplementationOnce(async () => {
      order.push("signOut");
      return { error: null };
    });
    await completeLogout();
    expect(order).toEqual(["purge", "signOut"]);
  });

  it("CRIT-#1: logout still completes even if IndexedDB purge fails", async () => {
    purgeMock.mockRejectedValueOnce(new Error("simulated DB explosion"));
    await expect(completeLogout()).resolves.toBeUndefined();
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  // ─── CRIT-#4 (2026-04-27) — dashboard store reset + legacy keys ──
  it("CRIT-#4: removes the legacy non-prefixed sos_reg_result key", async () => {
    localStorage.setItem("sos_reg_result", JSON.stringify({ plan: "elite", employeeCount: 50 }));
    await completeLogout();
    expect(localStorage.getItem("sos_reg_result")).toBeNull();
  });

  it("CRIT-#4: still does NOT touch other non-sosphere legacy keys (allowlist only)", async () => {
    localStorage.setItem("sos_reg_result", "tenant-A");
    localStorage.setItem("some_other_app_key", "must-survive");
    localStorage.setItem("oauth_provider", "google");
    await completeLogout();
    expect(localStorage.getItem("sos_reg_result")).toBeNull();
    expect(localStorage.getItem("some_other_app_key")).toBe("must-survive");
    expect(localStorage.getItem("oauth_provider")).toBe("google");
  });

  it("CRIT-#4: invokes clearDashboardStore() exactly once on logout", async () => {
    await completeLogout();
    expect(clearStoreMock).toHaveBeenCalledTimes(1);
  });

  it("CRIT-#4: store reset runs AFTER localStorage purge (so reset re-reads cleaned state)", async () => {
    const order: string[] = [];
    const orig = localStorage.removeItem.bind(localStorage);
    let purgeFinished = false;
    (localStorage as any).removeItem = (k: string) => {
      orig(k);
      if (!purgeFinished && k === "sos_reg_result") {
        order.push("purge_localStorage");
        purgeFinished = true;
      }
    };
    clearStoreMock.mockImplementationOnce(() => { order.push("reset_store"); });
    localStorage.setItem("sos_reg_result", "x");
    await completeLogout();
    (localStorage as any).removeItem = orig;
    expect(order).toEqual(["purge_localStorage", "reset_store"]);
  });

  it("CRIT-#4: store reset runs BEFORE supabase.auth.signOut() so listeners observe an empty store", async () => {
    const order: string[] = [];
    clearStoreMock.mockImplementationOnce(() => { order.push("reset_store"); });
    signOutMock.mockImplementationOnce(async () => {
      order.push("signOut");
      return { error: null };
    });
    await completeLogout();
    expect(order).toEqual(["reset_store", "signOut"]);
  });

  it("CRIT-#4: logout still completes even if clearDashboardStore throws", async () => {
    clearStoreMock.mockImplementationOnce(() => { throw new Error("zustand exploded"); });
    await expect(completeLogout()).resolves.toBeUndefined();
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });
});
