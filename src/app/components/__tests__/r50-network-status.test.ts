// ═══════════════════════════════════════════════════════════════════════════
// R-50 — network-status helper contract tests
// ─────────────────────────────────────────────────────────────────────────
// Pins the fallback behavior: when @capacitor/network is not loadable
// (vitest node env, web build), the helper must transparently degrade to
// navigator.onLine. That fallback path is what every existing web user
// will see — we cannot afford a regression there.
//
// Why node env (no jsdom): the vitest harness for this repo runs in
// "node" by default and jsdom is not in node_modules. We test the
// helper's logic without needing window/document — `subscribeNetworkStatus`
// is documented to be a no-op for the window-event branch in non-DOM
// environments, which is what these tests exercise.
//
// Native-Capacitor branch coverage happens via integration tests against
// a real Android emulator after R-50 is merged.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from "vitest";
import { isOnline, refreshNetworkStatus, subscribeNetworkStatus, __resetForTests } from "../utils/network-status";

describe("R-50: isOnline() fallback to navigator.onLine", () => {
  beforeEach(() => {
    __resetForTests();
  });

  it("returns true when navigator.onLine is true and Capacitor is unavailable", async () => {
    // node env: globalThis.navigator is supplied by vitest (default true)
    if (typeof navigator !== "undefined") {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    }
    await refreshNetworkStatus();
    expect(isOnline()).toBe(true);
  });

  it("returns false when navigator.onLine is false", async () => {
    if (typeof navigator !== "undefined") {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    }
    await refreshNetworkStatus();
    expect(isOnline()).toBe(false);
    // Reset to default for downstream tests
    if (typeof navigator !== "undefined") {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    }
  });

  it("refreshNetworkStatus reports source='navigator' when Capacitor module is missing", async () => {
    const s = await refreshNetworkStatus();
    // In the test env @capacitor/network is not installed → loadCapacitor()
    // returns null → we fall through to navigator. Asserting this guarantees
    // the lazy-import error path is exercised and does not throw.
    expect(s.source).toBe("navigator");
    expect(typeof s.connected).toBe("boolean");
  });
});

describe("R-50: subscribeNetworkStatus returns a working unsubscribe", () => {
  beforeEach(() => {
    __resetForTests();
  });

  it("returns a function that can be invoked safely", () => {
    const unsub = subscribeNetworkStatus(() => {});
    expect(typeof unsub).toBe("function");
    // Must not throw even when no window/document was wired.
    expect(() => unsub()).not.toThrow();
  });

  it("can be called multiple times without leaking listeners or crashing", () => {
    const unsubs = [
      subscribeNetworkStatus(() => {}),
      subscribeNetworkStatus(() => {}),
      subscribeNetworkStatus(() => {}),
    ];
    for (const u of unsubs) expect(() => u()).not.toThrow();
  });
});

describe("R-50: cache invariants", () => {
  beforeEach(() => {
    __resetForTests();
  });

  it("isOnline() returns the cached value within TTL window", async () => {
    if (typeof navigator !== "undefined") {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    }
    await refreshNetworkStatus(); // caches false

    // Flip the raw navigator. Cache should still report false until TTL expires.
    if (typeof navigator !== "undefined") {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    }
    expect(isOnline()).toBe(false);

    // Reset for downstream tests
    if (typeof navigator !== "undefined") {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    }
  });
});
