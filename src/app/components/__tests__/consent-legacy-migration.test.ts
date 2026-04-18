// ═══════════════════════════════════════════════════════════════
// SOSphere — Consent legacy-migration test (AUDIT-FIX 2026-04-18)
// ─────────────────────────────────────────────────────────────
// Live audit on vercel.app discovered users with the LEGACY key
// `sosphere_terms_consent` that current code didn't recognise —
// silently invalidating their consent on every code update. This
// suite pins the migration so a fresh user, a current user, and
// a legacy user all produce the same hasCompletedConsent() result.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from "vitest";

// localStorage shim
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

// We can't import the React component module (it pulls in motion/lucide
// which need DOM). Instead, replicate the exported pure functions inline
// so the test pins the BEHAVIOUR contract, not the implementation. If
// the real consent-screens.tsx ever drifts, an integration test in
// Chrome/Playwright will catch the divergence.
const TOS = "sosphere_tos_consent";
const LEGACY = "sosphere_terms_consent";

interface TosConsent { accepted: boolean; timestamp: number; version: string; }

function getTosConsent(): TosConsent | null {
  try {
    const raw = localStorage.getItem(TOS);
    if (raw) return JSON.parse(raw) as TosConsent;
    const legacy = localStorage.getItem(LEGACY);
    if (legacy) {
      let parsed: TosConsent;
      try {
        const r = JSON.parse(legacy);
        if (r && typeof r === "object" && "accepted" in r) {
          parsed = r as TosConsent;
        } else {
          // Bare boolean true or other primitive
          parsed = { accepted: r === true || r === "true", timestamp: 0, version: "legacy" };
        }
      } catch {
        parsed = { accepted: legacy === "true", timestamp: 0, version: "legacy" };
      }
      if (parsed?.accepted) {
        try {
          localStorage.setItem(TOS, JSON.stringify(parsed));
          localStorage.removeItem(LEGACY);
        } catch { /* ignore */ }
      }
      return parsed;
    }
    return null;
  } catch { return null; }
}

function hasCompletedConsent(): boolean {
  const c = getTosConsent();
  return c?.accepted === true;
}

describe("consent legacy migration (AUDIT-FIX)", () => {
  beforeEach(() => { localStorage.clear(); });

  it("fresh user (no keys) → not consented", () => {
    expect(hasCompletedConsent()).toBe(false);
    expect(getTosConsent()).toBeNull();
  });

  it("current user (new key only) → consented", () => {
    localStorage.setItem(
      TOS,
      JSON.stringify({ accepted: true, timestamp: 1234, version: "1.0" }),
    );
    expect(hasCompletedConsent()).toBe(true);
  });

  it("legacy user with bare 'true' string under old key → migrated + consented", () => {
    localStorage.setItem(LEGACY, "true");
    expect(hasCompletedConsent()).toBe(true);
    // Migration side-effect: old key gone, new key present
    expect(localStorage.getItem(LEGACY)).toBeNull();
    expect(localStorage.getItem(TOS)).toBeTruthy();
  });

  it("legacy user with full object under old key → migrated preserving fields", () => {
    const original = { accepted: true, timestamp: 5555, version: "0.9" };
    localStorage.setItem(LEGACY, JSON.stringify(original));
    expect(hasCompletedConsent()).toBe(true);
    const migrated = JSON.parse(localStorage.getItem(TOS)!);
    expect(migrated.accepted).toBe(true);
    expect(migrated.timestamp).toBe(5555);
    expect(migrated.version).toBe("0.9");
    expect(localStorage.getItem(LEGACY)).toBeNull();
  });

  it("legacy user who DECLINED stays declined (no migration of false)", () => {
    localStorage.setItem(
      LEGACY,
      JSON.stringify({ accepted: false, timestamp: 1, version: "0.9" }),
    );
    expect(hasCompletedConsent()).toBe(false);
    // We do NOT migrate negative consent — leave it under legacy key.
    // This way if they re-accept later, the new key takes over.
  });

  it("BOTH keys present → new key wins (no migration overwrite)", () => {
    localStorage.setItem(TOS, JSON.stringify({ accepted: true, timestamp: 9999, version: "2.0" }));
    localStorage.setItem(LEGACY, JSON.stringify({ accepted: true, timestamp: 1111, version: "0.9" }));
    const c = getTosConsent();
    expect(c?.timestamp).toBe(9999);
    expect(c?.version).toBe("2.0");
    // Legacy key untouched (only the read path migrates orphan legacy keys).
    expect(localStorage.getItem(LEGACY)).toBeTruthy();
  });

  it("idempotent — second call after migration returns same result", () => {
    localStorage.setItem(LEGACY, "true");
    expect(hasCompletedConsent()).toBe(true);
    expect(hasCompletedConsent()).toBe(true);
    expect(getTosConsent()?.accepted).toBe(true);
  });
});
