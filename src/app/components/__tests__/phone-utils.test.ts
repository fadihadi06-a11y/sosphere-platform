// ═══════════════════════════════════════════════════════════════
// SOSphere — Phone Utils (client-side normalizer)
// ─────────────────────────────────────────────────────────────
// The project test env is "node" (see vitest.config.ts) and jsdom
// is NOT installed, so we shim a minimal localStorage before
// importing the module under test. Re-imports are avoided by
// putting the shim on globalThis the first time the file loads.
// Pins the behaviour of normalizeE164 and the idempotent migration
// in `phone-utils.ts`. The server has a near-identical normalizer in
// supabase/functions/sos-alert/index.ts — if one is touched, the
// other MUST move in lockstep, or Twilio 21211 comes back.
//
// The migration test documents the self-heal that runs on app
// mount: it must rewrite stored values in place, keep already-valid
// E.164 untouched, and mark truly un-fixable entries with
// `phoneInvalid: true` so the UI can surface a warning.
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
if (typeof (globalThis as any).localStorage === "undefined") {
  (globalThis as any).localStorage = new MemoryStorage();
  // Expose the prototype so spyOn(Storage.prototype, ...) still works.
  (globalThis as any).Storage = MemoryStorage;
}

import {
  normalizeE164,
  getDefaultCountry,
  migrateStoredContactsToE164,
} from "../phone-utils";

beforeEach(() => {
  localStorage.clear();
});

describe("normalizeE164 — Iraqi default country", () => {
  it("keeps a valid E.164 number unchanged", () => {
    expect(normalizeE164("+9647728569514")).toBe("+9647728569514");
  });

  it("normalizes a leading-0 Iraqi mobile by prepending +964", () => {
    expect(normalizeE164("07728569514")).toBe("+9647728569514");
  });

  it("converts '00' international prefix to '+'", () => {
    expect(normalizeE164("009647728569514")).toBe("+9647728569514");
  });

  it("strips spaces, dashes, and parentheses before normalizing", () => {
    expect(normalizeE164("077 2856-9514")).toBe("+9647728569514");
    expect(normalizeE164("(077) 28569514")).toBe("+9647728569514");
  });

  it("treats bare digits already starting with 964 as international", () => {
    expect(normalizeE164("9647728569514")).toBe("+9647728569514");
  });

  it("rejects too-short numbers", () => {
    expect(normalizeE164("123")).toBeNull();
    expect(normalizeE164("+1234")).toBeNull();
  });

  it("rejects too-long numbers", () => {
    // 16 digits after '+' — above E.164 max (15)
    expect(normalizeE164("+12345678901234567")).toBeNull();
  });

  it("returns null on empty / whitespace-only input", () => {
    expect(normalizeE164("")).toBeNull();
    expect(normalizeE164("   ")).toBeNull();
    expect(normalizeE164(null)).toBeNull();
    expect(normalizeE164(undefined)).toBeNull();
  });
});

describe("normalizeE164 — explicit default country override", () => {
  it("uses the provided default country code", () => {
    // Saudi mobile style: 05XXXXXXXX → +9665XXXXXXXX
    expect(normalizeE164("0512345678", "SA")).toBe("+966512345678");
  });

  it("returns null for unknown country codes", () => {
    expect(normalizeE164("0512345678", "XX")).toBeNull();
  });
});

describe("getDefaultCountry", () => {
  it("falls back to IQ when no override is stored", () => {
    expect(getDefaultCountry()).toBe("IQ");
  });

  it("returns the localStorage override when valid", () => {
    localStorage.setItem("sosphere_default_country", "SA");
    expect(getDefaultCountry()).toBe("SA");
  });

  it("ignores an invalid override and falls back to IQ", () => {
    localStorage.setItem("sosphere_default_country", "XX");
    expect(getDefaultCountry()).toBe("IQ");
  });
});

describe("migrateStoredContactsToE164 — idempotent self-heal", () => {
  const KEY = "sosphere_emergency_contacts";

  it("rewrites leading-0 Iraqi numbers in place and reports the diff count", () => {
    localStorage.setItem(KEY, JSON.stringify([
      { id: 1, name: "Ali", phone: "07728569514", relation: "brother" },
      { id: 2, name: "Sara", phone: "+9647700000000", relation: "wife" },
    ]));

    const changed = migrateStoredContactsToE164(KEY);

    expect(changed).toBe(1);
    const after = JSON.parse(localStorage.getItem(KEY) || "[]");
    expect(after[0].phone).toBe("+9647728569514");
    expect(after[1].phone).toBe("+9647700000000");
  });

  it("is idempotent — running twice changes nothing the second time", () => {
    localStorage.setItem(KEY, JSON.stringify([
      { id: 1, name: "Ali", phone: "07728569514" },
    ]));

    migrateStoredContactsToE164(KEY);
    const setSpy = vi.spyOn(Storage.prototype, "setItem");
    const changedSecond = migrateStoredContactsToE164(KEY);
    expect(changedSecond).toBe(0);
    // second run must NOT re-write (avoid wasted storage churn)
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });

  it("flags un-fixable entries with phoneInvalid: true without erasing them", () => {
    localStorage.setItem(KEY, JSON.stringify([
      { id: 1, name: "Broken", phone: "abc" },
    ]));

    const changed = migrateStoredContactsToE164(KEY);
    expect(changed).toBe(1);
    const after = JSON.parse(localStorage.getItem(KEY) || "[]");
    expect(after[0].phone).toBe("abc"); // raw kept so user can fix
    expect(after[0].phoneInvalid).toBe(true);
  });

  it("no-ops cleanly on missing / invalid storage payload", () => {
    expect(migrateStoredContactsToE164(KEY)).toBe(0);
    localStorage.setItem(KEY, "not valid json");
    expect(migrateStoredContactsToE164(KEY)).toBe(0);
    localStorage.setItem(KEY, JSON.stringify({ not: "an array" }));
    expect(migrateStoredContactsToE164(KEY)).toBe(0);
  });
});
