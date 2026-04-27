// ═══════════════════════════════════════════════════════════════
// SOSphere — clearTenantLocalState + initRealtimeChannels test
// (CRIT-#5, 2026-04-27)
// ─────────────────────────────────────────────────────────────
// Pins three contracts:
//   1. clearTenantLocalState() removes every TENANT_SCOPED_KEY from
//      localStorage (and ONLY those keys — never user-prefs / pin-salt).
//   2. initRealtimeChannels(companyId) calls clearTenantLocalState
//      ONLY when switching from a previous companyId, never on the
//      first init (no leak yet) and never on the same-id no-op.
//   3. The TENANT_SCOPED_KEYS registry includes every `sosphere_*`
//      key constant declared in shared-store.ts (catches the next
//      developer who adds a key and forgets to register it).
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// localStorage shim
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
}
(globalThis as any).localStorage = (globalThis as any).localStorage ?? new MemoryStorage();
(globalThis as any).window = (globalThis as any).window ?? {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
};

// Mock supabase: shared-store imports `supabase` from ./api/supabase-client.
const { channelMock, removeChannelMock } = vi.hoisted(() => ({
  channelMock: vi.fn(),
  removeChannelMock: vi.fn(),
}));
function makeChain() {
  const chain: any = {
    on: () => chain,
    subscribe: () => chain,
    send: () => Promise.resolve(),
  };
  return chain;
}
channelMock.mockImplementation(() => makeChain());

vi.mock("../api/supabase-client", () => ({
  supabase: {
    channel: channelMock,
    removeChannel: removeChannelMock,
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
  SUPABASE_CONFIG: { isConfigured: false },
}));

// Sentry import inside initRealtimeChannels — stub it.
vi.mock("../sentry-client", () => ({ setSentryCompany: vi.fn() }));
// audit-log-store flush — stub.
vi.mock("../audit-log-store", () => ({ flushAuditRetryQueue: vi.fn().mockResolvedValue(0) }));

import {
  clearTenantLocalState,
  initRealtimeChannels,
  getCompanyId,
  _getTenantScopedKeysForTest,
} from "../shared-store";

describe("CRIT-#5 — clearTenantLocalState()", () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
  });

  it("removes every key listed in TENANT_SCOPED_KEYS", () => {
    const keys = _getTenantScopedKeysForTest();
    expect(keys.length).toBeGreaterThanOrEqual(20); // safety floor — currently 30
    for (const k of keys) localStorage.setItem(k, JSON.stringify({ leak: "tenant-A" }));
    const removed = clearTenantLocalState();
    expect(removed).toBe(keys.length);
    for (const k of keys) {
      expect(localStorage.getItem(k), `key ${k} should be removed`).toBeNull();
    }
  });

  it("returns 0 if nothing was present (idempotent)", () => {
    expect(clearTenantLocalState()).toBe(0);
    expect(clearTenantLocalState()).toBe(0);
  });

  it("does NOT touch user-prefs / device-persistent keys", () => {
    // The keep-list lives in complete-logout, but tenant-clear must not
    // even consider these — they are not in the registry.
    const keepers = [
      ["sosphere_pin_salt", "device-salt"],
      ["sosphere_biometric_lock_enabled", "1"],
      ["sosphere_db_migration_errors", '{"v":4}'],
      ["sosphere_dashboard_lang", "ar"],          // user pref
      ["sosphere_individual_profile", "civilian"], // user pref
    ];
    for (const [k, v] of keepers) localStorage.setItem(k, v);
    clearTenantLocalState();
    for (const [k, v] of keepers) {
      expect(localStorage.getItem(k), `${k} must be preserved`).toBe(v);
    }
  });

  it("does NOT touch foreign (non-sosphere) keys", () => {
    localStorage.setItem("google_oauth_state", "x");
    localStorage.setItem("my_other_app", "y");
    clearTenantLocalState();
    expect(localStorage.getItem("google_oauth_state")).toBe("x");
    expect(localStorage.getItem("my_other_app")).toBe("y");
  });

  it("never throws even if individual removeItem fails", () => {
    const orig = localStorage.removeItem.bind(localStorage);
    let calls = 0;
    (localStorage as any).removeItem = (k: string) => {
      calls++;
      if (calls === 2) throw new Error("simulated quota / restricted access");
      orig(k);
    };
    localStorage.setItem("sosphere_sync", "a");
    localStorage.setItem("sosphere_activity", "b");
    localStorage.setItem("sosphere_admin_signal", "c");
    expect(() => clearTenantLocalState()).not.toThrow();
    (localStorage as any).removeItem = orig;
  });
});

describe("CRIT-#5 — initRealtimeChannels tenant-switch behaviour", () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
    channelMock.mockClear();
    removeChannelMock.mockClear();
    // Reset the module-level _companyId by initializing to a known state
    // — a fresh import would be cleaner but vitest module isolation handles it
    // per file. Within one suite we just call init with a sentinel first.
  });

  it("first init does NOT clear localStorage (nothing to leak yet)", () => {
    // Seed legacy data BEFORE first init (e.g. previous session crashed
    // without cleanup). Defense: if there is no _previous_ company, we
    // cannot say this data belongs to "another tenant" so we leave it.
    localStorage.setItem("sosphere_sync", JSON.stringify(["legacy-event"]));
    initRealtimeChannels("COMPANY-FIRST");
    expect(localStorage.getItem("sosphere_sync")).not.toBeNull();
    expect(getCompanyId()).toBe("COMPANY-FIRST");
  });

  it("same-companyId init is a no-op (does NOT wipe local state)", () => {
    initRealtimeChannels("COMPANY-X");
    localStorage.setItem("sosphere_attendance", JSON.stringify({ ok: 1 }));
    initRealtimeChannels("COMPANY-X"); // duplicate
    expect(localStorage.getItem("sosphere_attendance")).not.toBeNull();
  });

  it("CRIT-#5: switching to a DIFFERENT companyId wipes tenant-scoped local state", () => {
    initRealtimeChannels("COMPANY-A");
    // Simulate company A activity persisting locally.
    localStorage.setItem("sosphere_sync", JSON.stringify(["evt-a"]));
    localStorage.setItem("sosphere_attendance", JSON.stringify([{ id: "x" }]));
    localStorage.setItem("sosphere_broadcasts", JSON.stringify([{ msg: "A" }]));
    // Also seed a non-tenant key — must survive.
    localStorage.setItem("sosphere_pin_salt", "device-salt-must-survive");

    initRealtimeChannels("COMPANY-B");

    // Tenant data is gone.
    expect(localStorage.getItem("sosphere_sync")).toBeNull();
    expect(localStorage.getItem("sosphere_attendance")).toBeNull();
    expect(localStorage.getItem("sosphere_broadcasts")).toBeNull();
    // Device key survives.
    expect(localStorage.getItem("sosphere_pin_salt")).toBe("device-salt-must-survive");
    // Active companyId is updated.
    expect(getCompanyId()).toBe("COMPANY-B");
  });

  it("ignores invalid companyId (empty / too short) and does NOT wipe state", () => {
    initRealtimeChannels("COMPANY-A");
    localStorage.setItem("sosphere_sync", "live-data");
    initRealtimeChannels("");   // invalid
    initRealtimeChannels(" ");  // invalid (length 0 after trim)
    initRealtimeChannels("ab"); // too short (<3)
    expect(localStorage.getItem("sosphere_sync")).toBe("live-data");
    expect(getCompanyId()).toBe("COMPANY-A"); // unchanged
  });
});

describe("CRIT-#5 — registry completeness (catches forgotten new keys)", () => {
  // This test reads the actual shared-store.ts source and verifies every
  // `const FOO_KEY = "sosphere_..."` line is registered in TENANT_SCOPED_KEYS
  // OR explicitly listed in NON_TENANT_KEYS below (user-prefs, device-keys,
  // IDB names, etc.). When you add a new constant, either register it as
  // tenant-scoped or add it to NON_TENANT_KEYS with a comment explaining why.
  const NON_TENANT_KEYS: ReadonlySet<string> = new Set([
    // IndexedDB names — separate purge path (offline-database.ts purgeAllOfflineData)
    "sosphere_emergency",
    // (intentionally allow new exemptions to appear here as the registry evolves)
  ]);

  it("every sosphere_* string literal in shared-store.ts is either tenant-scoped or exempt", () => {
    const sourcePath = path.join(__dirname, "..", "shared-store.ts");
    const src = fs.readFileSync(sourcePath, "utf8");
    // Match: const NAME = "sosphere_..." OR `sosphere_...`
    const regex = /["\x60](sosphere_[A-Za-z0-9_]+)["\x60]/g;
    const found = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = regex.exec(src))) found.add(m[1]);

    const registered = new Set(_getTenantScopedKeysForTest());
    const missing: string[] = [];
    for (const k of found) {
      if (registered.has(k)) continue;
      if (NON_TENANT_KEYS.has(k)) continue;
      missing.push(k);
    }
    expect(missing, `Found unregistered sosphere_* keys: ${missing.join(", ")}`).toEqual([]);
  });
});
