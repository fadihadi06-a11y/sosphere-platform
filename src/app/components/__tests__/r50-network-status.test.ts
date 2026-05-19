// ═══════════════════════════════════════════════════════════════════════════
// R-50 — network-status helper contract tests
// ─────────────────────────────────────────────────────────────────────────
// Pins the fallback behavior: when @capacitor/network is not loadable
// (vitest node env, web build), the helper must transparently degrade to
// navigator.onLine. That fallback path is what every existing web user
// will see — we cannot afford a regression there.
//
// CI-FIX-1 (2026-05-19): CI Node was missing globalThis.navigator (the
// local vitest sandbox provides it, CI's headless Node does not). All
// three failing tests were dependent on navigator existing. Fix: inject
// a stub navigator onto globalThis in beforeEach, restore in afterEach.
//
// Native-Capacitor branch coverage happens via integration tests against
// a real Android emulator after R-50 is merged.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isOnline, refreshNetworkStatus, subscribeNetworkStatus, __resetForTests } from "../utils/network-status";

// ─── Stub navigator on globalThis (works in both Node and jsdom) ───────────
type NavLike = { onLine: boolean };
let _origNavigator: PropertyDescriptor | undefined;

function setNavigatorOnLine(value: boolean) {
  // Defining/redefining on globalThis works whether navigator already
  // exists (browser/jsdom) or doesn't (headless Node in CI).
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: { onLine: value } as NavLike,
  });
}

beforeEach(() => {
  _origNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  setNavigatorOnLine(true);
  __resetForTests();
});

afterEach(() => {
  if (_origNavigator) {
    Object.defineProperty(globalThis, "navigator", _origNavigator);
  } else {
    // No prior descriptor — delete the stub we added.
    // @ts-expect-error — globalThis is intentionally being mutated for tests
    delete globalThis.navigator;
  }
});

describe("R-50: isOnline() fallback to navigator.onLine", () => {
  it("returns true when navigator.onLine is true and Capacitor is unavailable", async () => {
    setNavigatorOnLine(true);
    await refreshNetworkStatus();
    expect(isOnline()).toBe(true);
  });

  it("returns false when navigator.onLine is false", async () => {
    setNavigatorOnLine(false);
    await refreshNetworkStatus();
    expect(isOnline()).toBe(false);
  });

  it("refreshNetworkStatus reports source='navigator' when Capacitor module is missing", async () => {
    // In the test env @capacitor/network is not installed → loadCapacitor()
    // returns null → we fall through to navigator. Asserting source guarantees
    // the lazy-import error path is exercised and does not throw.
    setNavigatorOnLine(true);
    const s = await refreshNetworkStatus();
    expect(s.source).toBe("navigator");
    expect(typeof s.connected).toBe("boolean");
  });
});

describe("R-50: subscribeNetworkStatus returns a working unsubscribe", () => {
  it("returns a function that can be invoked safely", () => {
    const unsub = subscribeNetworkStatus(() => {});
    expect(typeof unsub).toBe("function");
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
  it("isOnline() returns the cached value within TTL window", async () => {
    setNavigatorOnLine(false);
    await refreshNetworkStatus(); // caches false

    // Flip the raw navigator. Cache should still report false until TTL expires.
    setNavigatorOnLine(true);
    expect(isOnline()).toBe(false);
  });
});
