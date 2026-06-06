// ═══════════════════════════════════════════════════════════════
// SOSphere — packet-preferences-service contract (26th pattern app)
// ─────────────────────────────────────────────────────────────
// 2026-06-06 roots-of-roots M2-#2. Locks the cache trio + pure
// helpers so a future refactor cannot silently break the GDPR
// consent persistence path.
//
//   1. cache: empty by default → null
//   2. cache: set → get returns copy (not same ref)
//   3. clear wipes in-memory cache
//   4. DEFAULT_PACKET_MODULES has location:true (responder requirement)
//   5. hydrateModules: null/garbage → defaults
//   6. hydrateModules: location ALWAYS true (regardless of input)
//   7. hydrateModules: explicit false stays false
//   8. hydrateModules: missing key → default true (opt-in)
//   9. countOptIns: all opt-ins → 5 (excludes location)
//  10. countOptIns: zero opt-ins → 0
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from "vitest";
import {
  setCachedPacketModules, getCachedPacketModules, clearPacketPreferencesCache,
  hydrateModules, countOptIns, DEFAULT_PACKET_MODULES,
  type PacketModules,
} from "../packet-preferences-service";

describe("packet-preferences-service — 26th pattern app contract", () => {
  beforeEach(() => { clearPacketPreferencesCache(); });

  it("1. cache: empty by default → null", () => {
    expect(getCachedPacketModules()).toBeNull();
  });

  it("2. cache: set → get returns copy (not same ref)", () => {
    const m: PacketModules = { ...DEFAULT_PACKET_MODULES };
    setCachedPacketModules(m);
    const got = getCachedPacketModules();
    expect(got).toEqual(m);
    expect(got).not.toBe(m);
  });

  it("3. clear wipes in-memory cache", () => {
    setCachedPacketModules({ ...DEFAULT_PACKET_MODULES });
    clearPacketPreferencesCache();
    expect(getCachedPacketModules()).toBeNull();
  });

  it("4. DEFAULT_PACKET_MODULES has location:true", () => {
    expect(DEFAULT_PACKET_MODULES.location).toBe(true);
  });

  it("5. hydrateModules: null / garbage → defaults", () => {
    expect(hydrateModules(null)).toEqual(DEFAULT_PACKET_MODULES);
    expect(hydrateModules(undefined)).toEqual(DEFAULT_PACKET_MODULES);
    expect(hydrateModules("nope")).toEqual(DEFAULT_PACKET_MODULES);
    expect(hydrateModules(42)).toEqual(DEFAULT_PACKET_MODULES);
  });

  it("6. hydrateModules: location ALWAYS true (regardless of input)", () => {
    // Server can never persuade the client to hide its own location:
    // SOS without coordinates is useless. Defense-in-depth.
    expect(hydrateModules({ location: false }).location).toBe(true);
    expect(hydrateModules({}).location).toBe(true);
  });

  it("7. hydrateModules: explicit false stays false", () => {
    const m = hydrateModules({ medical: false, contacts: false });
    expect(m.medical).toBe(false);
    expect(m.contacts).toBe(false);
  });

  it("8. hydrateModules: missing key → default true (opt-in)", () => {
    const m = hydrateModules({}); // empty server row
    expect(m.medical).toBe(true);
    expect(m.contacts).toBe(true);
    expect(m.device).toBe(true);
    expect(m.recording).toBe(true);
    expect(m.incident).toBe(true);
  });

  it("9. countOptIns: all opt-ins → 5 (excludes location)", () => {
    expect(countOptIns(DEFAULT_PACKET_MODULES)).toBe(5);
  });

  it("10. countOptIns: zero opt-ins → 0", () => {
    expect(countOptIns({
      location: true, medical: false, contacts: false,
      device: false, recording: false, incident: false,
    })).toBe(0);
  });
});
