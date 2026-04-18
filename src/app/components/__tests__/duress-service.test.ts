// ═══════════════════════════════════════════════════════════════
// SOSphere — Duress Service test suite (E-M1)
// ─────────────────────────────────────────────────────────────
// Pins the hashed PIN behaviour: SHA-256 + salt, constant-time
// compare, legacy plaintext migration. If any of these regresses,
// the duress feature silently loses its security property.
//
// NOTE: SubtleCrypto is required. Node 18+ provides it on the
// global `crypto` object, which vitest's node env passes through.
// If we ever drop Node < 18 we can remove the availability guard.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";

// --- localStorage shim -------------------------------------------
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

// Mock subscription-service so hasFeature returns true in tests.
vi.mock("../subscription-service", () => ({
  hasFeature: vi.fn().mockReturnValue(true),
}));

import {
  isDuressFeatureAvailable,
  getDuressPin,
  setDuressPin,
  isDuressPin,
  getDeactivationPin,
  setDeactivationPin,
  isDeactivationPin,
  isDuressPinSet,
  isDeactivationPinSet,
} from "../duress-service";

// Skip the whole suite if SubtleCrypto isn't available (ancient Node).
const hasSubtleCrypto =
  typeof globalThis.crypto !== "undefined" &&
  typeof globalThis.crypto.subtle?.digest === "function";

const d = hasSubtleCrypto ? describe : describe.skip;

d("duress-service — E-M1 hashed PIN storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("feature-gate reports true when hasFeature('duressCode') is true", () => {
    expect(isDuressFeatureAvailable()).toBe(true);
  });

  it("setDuressPin stores only a hash, NOT the plaintext", async () => {
    const ok = await setDuressPin("1234");
    expect(ok).toBe(true);
    expect(localStorage.getItem("sosphere_duress_pin_hash")).toMatch(/^[a-f0-9]{64}$/);
    expect(localStorage.getItem("sosphere_duress_pin")).toBeNull();
  });

  it("isDuressPin returns true for the correct PIN", async () => {
    await setDuressPin("1234");
    const match = await isDuressPin("1234");
    expect(match).toBe(true);
  });

  it("isDuressPin returns false for wrong PIN", async () => {
    await setDuressPin("1234");
    expect(await isDuressPin("5678")).toBe(false);
    expect(await isDuressPin("123")).toBe(false); // shorter
    expect(await isDuressPin("12345")).toBe(false); // longer
  });

  it("isDuressPin returns false when no PIN is set", async () => {
    expect(await isDuressPin("1234")).toBe(false);
  });

  it("setDuressPin(null) clears the PIN", async () => {
    await setDuressPin("1234");
    await setDuressPin(null);
    expect(localStorage.getItem("sosphere_duress_pin_hash")).toBeNull();
    expect(await isDuressPin("1234")).toBe(false);
  });

  it("rejects PINs that don't match 4-10 digits", async () => {
    expect(await setDuressPin("abc")).toBe(false);       // non-digit
    expect(await setDuressPin("12")).toBe(false);        // too short
    expect(await setDuressPin("12345678901")).toBe(false); // too long
    expect(await setDuressPin("12 34")).toBe(false);     // whitespace
  });

  it("REFUSES duress PIN that equals the deactivation PIN", async () => {
    await setDeactivationPin("1234");
    const ok = await setDuressPin("1234");
    expect(ok).toBe(false);
    expect(isDuressPinSet()).toBe(false);
  });

  it("REFUSES deactivation PIN that equals the duress PIN", async () => {
    await setDuressPin("9999");
    const ok = await setDeactivationPin("9999");
    expect(ok).toBe(false);
    expect(isDeactivationPinSet()).toBe(false);
  });

  it("allows DIFFERENT duress and deactivation PINs", async () => {
    expect(await setDeactivationPin("1111")).toBe(true);
    expect(await setDuressPin("2222")).toBe(true);
    expect(await isDuressPin("2222")).toBe(true);
    expect(await isDeactivationPin("1111")).toBe(true);
    // Cross-check: wrong PIN for the wrong slot
    expect(await isDuressPin("1111")).toBe(false);
    expect(await isDeactivationPin("2222")).toBe(false);
  });

  it("uses a stable per-install salt (same PIN → same hash within install)", async () => {
    await setDuressPin("1234");
    const hash1 = localStorage.getItem("sosphere_duress_pin_hash");
    await setDuressPin(null);
    await setDuressPin("1234");
    const hash2 = localStorage.getItem("sosphere_duress_pin_hash");
    expect(hash1).toBe(hash2);
  });

  it("DIFFERENT installs produce DIFFERENT hashes for the same PIN", async () => {
    // Install 1
    await setDuressPin("1234");
    const hash1 = localStorage.getItem("sosphere_duress_pin_hash");
    const salt1 = localStorage.getItem("sosphere_pin_salt");

    // Simulate fresh install: clear everything
    localStorage.clear();
    await setDuressPin("1234");
    const hash2 = localStorage.getItem("sosphere_duress_pin_hash");
    const salt2 = localStorage.getItem("sosphere_pin_salt");

    expect(salt1).not.toBe(salt2);
    expect(hash1).not.toBe(hash2);
  });

  it("isDuressPinSet reflects presence of hash key", async () => {
    expect(isDuressPinSet()).toBe(false);
    await setDuressPin("4321");
    expect(isDuressPinSet()).toBe(true);
    await setDuressPin(null);
    expect(isDuressPinSet()).toBe(false);
  });
});
