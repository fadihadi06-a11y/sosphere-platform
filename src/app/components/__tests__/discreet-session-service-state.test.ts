// ═══════════════════════════════════════════════════════════════
// SOSphere — discreet-session-service contract
// ─────────────────────────────────────────────────────────────
// Phase 2 CRIT-9 (2026-06-01): 6th application of the world-class
// server-state pattern. These tests lock the contract so a future
// refactor cannot silently downgrade the gate logic:
//
//   1.  setActiveSession + getActiveSession round-trip in-memory
//   2.  setActiveSession persists to localStorage (next-session bootstrap)
//   3.  clearDiscreetSessionState wipes both in-memory and localStorage
//   4.  getActiveSession reads localStorage when in-memory empty
//   5.  getActiveSession refuses an expired bootstrap (autoTimeoutAt < now)
//   6.  classifyHeartbeat returns "fresh" when age <= 180s
//   7.  classifyHeartbeat returns "stale" when 180s < age <= 600s
//   8.  classifyHeartbeat returns "missing" when age > 600s OR null
//   9.  classifyHeartbeat returns "expired" when autoTimeoutAt is past
//  10.  statusColor maps each DiscreetStatus to a non-empty hex string
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
  return await import("../discreet-session-service");
}

describe("discreet-session-service — Phase 2 CRIT-9 contract", () => {
  beforeEach(() => {
    for (const k of Object.keys(lsStore)) delete lsStore[k];
  });

  it("1. setActiveSession + getActiveSession round-trip in-memory", async () => {
    const svc = await loadFresh();
    expect(svc.getActiveSession()).toBeNull();
    const s = { sessionId: "s1", mode: "blackout" as const, startedAt: Date.now(),
                autoTimeoutAt: Date.now() + 60_000, lastHeartbeatAt: Date.now() };
    svc.setActiveSession(s);
    expect(svc.getActiveSession()?.sessionId).toBe("s1");
    expect(svc.getActiveSession()?.mode).toBe("blackout");
  });

  it("2. setActiveSession persists to localStorage for next-session bootstrap", async () => {
    const svc = await loadFresh();
    const s = { sessionId: "s2", mode: "low_battery" as const, startedAt: 1,
                autoTimeoutAt: Date.now() + 600_000, lastHeartbeatAt: 1 };
    svc.setActiveSession(s);
    const raw = lsStore["sosphere_discreet_session"];
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).sessionId).toBe("s2");
  });

  it("3. clearDiscreetSessionState wipes both in-memory AND localStorage", async () => {
    const svc = await loadFresh();
    svc.setActiveSession({ sessionId: "s3", mode: "blackout", startedAt: 1,
                            autoTimeoutAt: Date.now() + 60_000 });
    svc.clearDiscreetSessionState();
    expect(svc.getActiveSession()).toBeNull();
    expect(lsStore["sosphere_discreet_session"]).toBeUndefined();
  });

  it("4. fresh module reads localStorage bootstrap when in-memory empty", async () => {
    lsStore["sosphere_discreet_session"] = JSON.stringify({
      sessionId: "boot", mode: "blackout", startedAt: 1,
      autoTimeoutAt: Date.now() + 60_000, lastHeartbeatAt: 1,
    });
    const svc = await loadFresh();
    expect(svc.getActiveSession()?.sessionId).toBe("boot");
  });

  it("5. getActiveSession refuses an expired bootstrap (autoTimeoutAt past)", async () => {
    lsStore["sosphere_discreet_session"] = JSON.stringify({
      sessionId: "expired", mode: "blackout", startedAt: 1,
      autoTimeoutAt: Date.now() - 60_000, lastHeartbeatAt: 1,
    });
    const svc = await loadFresh();
    expect(svc.getActiveSession()).toBeNull();
    // Also: expired bootstrap should be cleaned up
    expect(lsStore["sosphere_discreet_session"]).toBeUndefined();
  });

  it("6. classifyHeartbeat returns 'fresh' when age <= 180s", async () => {
    const { classifyHeartbeat } = await loadFresh();
    const future = new Date(Date.now() + 600_000).toISOString();
    expect(classifyHeartbeat(0,   future)).toBe("fresh");
    expect(classifyHeartbeat(60,  future)).toBe("fresh");
    expect(classifyHeartbeat(180, future)).toBe("fresh");
  });

  it("7. classifyHeartbeat returns 'stale' when 180 < age <= 600", async () => {
    const { classifyHeartbeat } = await loadFresh();
    const future = new Date(Date.now() + 600_000).toISOString();
    expect(classifyHeartbeat(181, future)).toBe("stale");
    expect(classifyHeartbeat(400, future)).toBe("stale");
    expect(classifyHeartbeat(600, future)).toBe("stale");
  });

  it("8. classifyHeartbeat returns 'missing' when age > 600 OR null", async () => {
    const { classifyHeartbeat } = await loadFresh();
    const future = new Date(Date.now() + 600_000).toISOString();
    expect(classifyHeartbeat(601,   future)).toBe("missing");
    expect(classifyHeartbeat(9999,  future)).toBe("missing");
    expect(classifyHeartbeat(null,  future)).toBe("missing");
    expect(classifyHeartbeat(undefined, future)).toBe("missing");
  });

  it("9. classifyHeartbeat returns 'expired' when autoTimeoutAt is past", async () => {
    const { classifyHeartbeat } = await loadFresh();
    const past = new Date(Date.now() - 60_000).toISOString();
    // Expired wins over fresh
    expect(classifyHeartbeat(60, past)).toBe("expired");
    // Expired wins over missing
    expect(classifyHeartbeat(null, past)).toBe("expired");
  });

  it("10. statusColor returns a non-empty hex for every DiscreetStatus", async () => {
    const { statusColor } = await loadFresh();
    const statuses = ["active","warned","timed_out","exited","admin_cleared"] as const;
    for (const s of statuses) {
      const c = statusColor(s);
      expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
