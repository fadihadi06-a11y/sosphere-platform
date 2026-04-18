// ═══════════════════════════════════════════════════════════════
// SOSphere — Audit Log UA Classification test suite (S-M2)
// ─────────────────────────────────────────────────────────────
// Pins the classifyUserAgent() helper: every audit row must carry
// a stable {browser}/{platform}[/mobile] label instead of the raw
// navigator.userAgent (which leaks version + fingerprints users).
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

(globalThis as any).localStorage = (globalThis as any).localStorage ?? new MemoryStorage();

// Mock supabase so the audit log doesn't try to hit the network.
vi.mock("../api/supabase-client", () => ({
  supabase: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    from: vi.fn().mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockResolvedValue({ error: null }),
    }),
  },
}));
vi.mock("../shared-store", () => ({ getCompanyId: vi.fn().mockReturnValue(null) }));

import { logAuditEvent, getRealAuditLog } from "../audit-log-store";

const loadAuditLog = () => getRealAuditLog();

// Helper: set navigator.userAgent for a test. Modern Node defines
// `navigator` as a read-only getter, so use defineProperty.
function withUA(ua: string, fn: () => void) {
  const original = (globalThis as any).navigator;
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: ua },
    configurable: true,
    writable: true,
  });
  try { fn(); } finally {
    Object.defineProperty(globalThis, "navigator", {
      value: original,
      configurable: true,
      writable: true,
    });
  }
}

describe("classifyUserAgent (S-M2)", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it("classifies Chrome Android as chrome/android/mobile", () => {
    withUA(
      "Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36",
      () => { logAuditEvent("security" as any, "test_action"); },
    );
    const log = loadAuditLog();
    expect(log[0]?.deviceInfo).toBe("chrome/android/mobile");
  });

  it("classifies Safari iPhone as safari/ios/mobile", () => {
    withUA(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
      () => { logAuditEvent("security" as any, "test_action"); },
    );
    const log = loadAuditLog();
    expect(log[0]?.deviceInfo).toBe("safari/ios/mobile");
  });

  it("classifies Firefox Windows as firefox/windows", () => {
    withUA(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
      () => { logAuditEvent("security" as any, "test_action"); },
    );
    const log = loadAuditLog();
    expect(log[0]?.deviceInfo).toBe("firefox/windows");
  });

  it("classifies Edge macOS as edge/macos", () => {
    withUA(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0",
      () => { logAuditEvent("security" as any, "test_action"); },
    );
    const log = loadAuditLog();
    expect(log[0]?.deviceInfo).toBe("edge/macos");
  });

  it("classifies unknown UA as unknown/desktop", () => {
    withUA("SomeCustomBot/1.0", () => { logAuditEvent("security" as any, "test_action"); });
    const log = loadAuditLog();
    expect(log[0]?.deviceInfo).toBe("unknown/desktop");
  });

  it("returns undefined for missing navigator", () => {
    const original = (globalThis as any).navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      logAuditEvent("security" as any, "test_action");
      const log = loadAuditLog();
      expect(log[0]?.deviceInfo).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });

  it("NEVER contains raw version numbers (privacy)", () => {
    withUA(
      "Mozilla/5.0 (Linux; Android 13; Pixel 6) Chrome/119.0.0.0",
      () => { logAuditEvent("security" as any, "test_action"); },
    );
    const log = loadAuditLog();
    const info = log[0]?.deviceInfo ?? "";
    expect(info).not.toMatch(/119/);
    expect(info).not.toMatch(/\d+\.\d+/);
  });
});
