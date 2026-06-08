// ═══════════════════════════════════════════════════════════════
// SOSphere — panic-siren-service contract (M3-#22)
// ─────────────────────────────────────────────────────────────
// 2026-06-06 roots-of-roots M3-#22: pure exports + config
// persistence. AudioContext is jsdom/Node-unavailable so the
// audio-emitting paths (onSOSConfirmed, stopSiren) are NOT
// exercised — they belong in a browser-environment test harness.
// What we CAN lock here: the config getter defaults, the setter
// round-trip, the state-machine getters, and the cache-clear.
//
//   1. getSirenState: idle default
//   2. getSirenConfig: defaults (enabled=true, autoTriggerDelaySec=0)
//   3. setSirenEnabled(false) persists across reload
//   4. setAutoTriggerDelay(N) persists across reload
//   5. isSirenActive: false default
//   6. subscribeSiren: returns an unsubscribe function
//   7. subscribeSiren: unsubscribe is idempotent
//   8. clearPanicSirenCache: idempotent + no-throw
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";

const lsStore: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem:    (k: string) => lsStore[k] ?? null,
  setItem:    (k: string, v: string) => { lsStore[k] = v; },
  removeItem: (k: string) => { delete lsStore[k]; },
  clear:      () => { for (const k of Object.keys(lsStore)) delete lsStore[k]; },
});

async function loadFresh() {
  vi.resetModules();
  return await import("../panic-siren-service");
}

describe("panic-siren-service — M3-#22 contract", () => {
  beforeEach(() => { for (const k of Object.keys(lsStore)) delete lsStore[k]; });

  it("1. getSirenState: idle default", async () => {
    const m = await loadFresh();
    expect(m.getSirenState()).toBe("idle");
  });

  it("2. getSirenConfig: defaults (enabled=true, autoTriggerDelaySec=0)", async () => {
    const m = await loadFresh();
    expect(m.getSirenConfig()).toEqual({ enabled: true, autoTriggerDelaySec: 0 });
  });

  it("3. setSirenEnabled(false) persists across reload", async () => {
    const m1 = await loadFresh();
    m1.setSirenEnabled(false);
    const m2 = await loadFresh();
    expect(m2.getSirenConfig().enabled).toBe(false);
  });

  it("4. setAutoTriggerDelay(N) persists across reload", async () => {
    const m1 = await loadFresh();
    m1.setAutoTriggerDelay(45);
    const m2 = await loadFresh();
    expect(m2.getSirenConfig().autoTriggerDelaySec).toBe(45);
  });

  it("5. isSirenActive: false default", async () => {
    const m = await loadFresh();
    expect(m.isSirenActive()).toBe(false);
  });

  it("6. subscribeSiren: returns an unsubscribe function", async () => {
    const m = await loadFresh();
    const unsub = m.subscribeSiren(() => {});
    expect(typeof unsub).toBe("function");
  });

  it("7. subscribeSiren: unsubscribe is idempotent", async () => {
    const m = await loadFresh();
    const unsub = m.subscribeSiren(() => {});
    expect(() => { unsub(); unsub(); }).not.toThrow();
  });

  it("8. clearPanicSirenCache: idempotent + no-throw", async () => {
    const m = await loadFresh();
    expect(() => m.clearPanicSirenCache()).not.toThrow();
    expect(() => m.clearPanicSirenCache()).not.toThrow();
  });
});
