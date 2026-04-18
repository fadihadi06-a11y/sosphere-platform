// ═══════════════════════════════════════════════════════════════
// SOSphere — completeLogout test suite (AUDIT-FIX verification)
// ─────────────────────────────────────────────────────────────
// Pins the new broad-prefix-sweep design so it can't regress into
// the typo'd allowlist that caused the post-logout PII leak we
// discovered on 2026-04-18. Every key the app actually writes gets
// a positive test (must be removed) and every keep-list key gets
// a negative test (must survive).
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";

// --- localStorage shim (node env, no jsdom) ---------------------
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, String(value)); }
  removeItem(key: string) { this.store.delete(key); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
}

// --- Shim globals BEFORE importing the module under test --------
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

// --- Mock the supabase + cache-helper imports -------------------
vi.mock("../api/supabase-client", () => ({
  supabase: {
    auth: {
      signOut: vi.fn().mockResolvedValue({ error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  },
  clearDeviceFingerprint: vi.fn(),
}));
vi.mock("../api/server-permission", () => ({ clearPermissionCache: vi.fn() }));
vi.mock("../api/authenticated-role", () => ({ clearRoleCache: vi.fn() }));
vi.mock("../api/tenant", () => ({ clearTenantCache: vi.fn() }));

import { completeLogout } from "../api/complete-logout";

describe("completeLogout — broad SOSphere-prefix sweep", () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
  });

  it("removes ALL sosphere_-prefixed user keys (the actual keys in use)", async () => {
    // Every key the app actually writes somewhere. If this list grows,
    // add the key here so we pin the sweep coverage.
    const leakingKeys = [
      "sosphere_individual_profile",      // PII
      "sosphere_active_sos",              // active emergency state
      "sosphere_incident_history",        // PII
      "sosphere_admin_profile",           // PII
      "sosphere_admin_phone",             // PII
      "sosphere_employee_profile",        // PII
      "sosphere_employee_avatar",         // PII
      "sosphere_company_id",              // tenant leak
      "sosphere_emergency_contacts",      // PII
      "sosphere_dashboard_auth",          // session
      "sosphere_dashboard_pin",           // admin PIN
      "sosphere_tos_consent",             // consent (was wrong key name in old list!)
      "sosphere_gps_consent",             // consent (was wrong key name in old list!)
      "sosphere_onboarding_completed",    // flag
      "sosphere_lang",                    // lang pref
      "sosphere_app_lang",                // lang pref (duplicate)
      "sosphere_device_fp",               // device fingerprint (was wrong key name!)
      "sosphere_neighbor_alert_settings", // privacy
      "sosphere_journeys",                // enterprise
      "sosphere_investigations",          // enterprise
      "sosphere_risks",                   // enterprise
      "sosphere_shifts",                  // enterprise
      "sosphere_timeline_event",          // enterprise
      "sosphere_sensor_events",           // enterprise
      "sosphere_totp_user-abc123",        // per-user
      "sosphere_audit_log",               // audit
      "sosphere_audit_retry_queue",       // audit
      "sosphere_sar_prefill",             // search & rescue
      "sosphere_new_investigation",       // enterprise
      "sosphere_last_sync",               // sync
      "sosphere_fp_grace_until",          // fingerprint grace (S-H1)
    ];
    for (const k of leakingKeys) {
      localStorage.setItem(k, "leak-me");
    }

    await completeLogout();

    for (const k of leakingKeys) {
      expect(localStorage.getItem(k), `key ${k} should be removed`).toBeNull();
    }
  });

  it("KEEPS device-persistent keys that should survive logout", async () => {
    // These MUST survive — losing them breaks features (PIN hashes,
    // biometric preference) or forensic trails (migration errors).
    const keepKeys = [
      ["sosphere_pin_salt", "16-byte-random-salt"],
      ["sosphere_biometric_lock_enabled", "1"],
      ["sosphere_db_migration_errors", '{"version":4,"failed":[]}'],
    ];
    for (const [k, v] of keepKeys) {
      localStorage.setItem(k, v);
    }

    await completeLogout();

    for (const [k, expected] of keepKeys) {
      expect(
        localStorage.getItem(k),
        `key ${k} should be preserved (device-persistent)`,
      ).toBe(expected);
    }
  });

  it("does NOT touch non-sosphere keys (other apps on shared browser)", async () => {
    const foreignKeys = [
      ["google_oauth_redirect", "some-google-cookie"],
      ["my_other_app_pref", "foo"],
      ["github-token", "ghp_abc"],  // simulate a different app's key
    ];
    for (const [k, v] of foreignKeys) {
      localStorage.setItem(k, v);
    }

    await completeLogout();

    for (const [k, expected] of foreignKeys) {
      expect(
        localStorage.getItem(k),
        `foreign key ${k} must not be touched`,
      ).toBe(expected);
    }
  });

  it("is idempotent — second call after clean state is a no-op", async () => {
    localStorage.setItem("sosphere_individual_profile", "me");
    await completeLogout();
    expect(localStorage.getItem("sosphere_individual_profile")).toBeNull();

    // Second call should succeed without throwing even though nothing to clean.
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
});
