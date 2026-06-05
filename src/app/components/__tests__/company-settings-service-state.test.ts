// ═══════════════════════════════════════════════════════════════
// SOSphere — company-settings-service contract (19th pattern app)
// ─────────────────────────────────────────────────────────────
// 2026-06-04 fresh-audit #4: lock cache trio + mergeSettings +
// extractToggleValue so admin settings edits stay correct under
// partial-update flows (only one toggle changes, whole object
// round-trips through the RPC).
//
//  1. cache: get-empty → null
//  2. cache: set → get returns equal
//  3. cache: clear wipes in-memory
//  4. mergeSettings: null prev + patch returns patch
//  5. mergeSettings: prev + patch overrides shallow fields
//  6. mergeSettings: toggles are deep-merged
//  7. extractToggleValue: null settings → default
//  8. extractToggleValue: missing key → default
//  9. extractToggleValue: present boolean → that value
// 10. extractToggleValue: non-boolean value → default
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
  return await import("../company-settings-service");
}

describe("company-settings-service — fresh-audit #4 contract", () => {
  beforeEach(() => { for (const k of Object.keys(lsStore)) delete lsStore[k]; });

  it("1. cache: get-empty → null", async () => {
    const { getCachedCompanySettings } = await loadFresh();
    expect(getCachedCompanySettings()).toBeNull();
  });

  it("2. cache: set → get returns equal object", async () => {
    const { setCachedCompanySettings, getCachedCompanySettings } = await loadFresh();
    setCachedCompanySettings({ session_timeout: "8h", toggles: { dark: true } });
    expect(getCachedCompanySettings()).toEqual({ session_timeout: "8h", toggles: { dark: true } });
  });

  it("3. clear wipes in-memory cache", async () => {
    const { setCachedCompanySettings, getCachedCompanySettings, clearCompanySettingsCache } = await loadFresh();
    setCachedCompanySettings({ toggles: {} });
    clearCompanySettingsCache();
    expect(getCachedCompanySettings()).toBeNull();
  });

  it("4. mergeSettings: null prev + patch returns patch as base", async () => {
    const { mergeSettings } = await loadFresh();
    expect(mergeSettings(null, { session_timeout: "12h" })).toEqual({
      session_timeout: "12h", toggles: {},
    });
  });

  it("5. mergeSettings: prev + patch overrides shallow fields", async () => {
    const { mergeSettings } = await loadFresh();
    const out = mergeSettings(
      { session_timeout: "8h", toggles: { dark: true } },
      { session_timeout: "24h" },
    );
    expect(out.session_timeout).toBe("24h");
    expect(out.toggles).toEqual({ dark: true });
  });

  it("6. mergeSettings: toggles are deep-merged", async () => {
    const { mergeSettings } = await loadFresh();
    const out = mergeSettings(
      { toggles: { dark: true, sound: false } },
      { toggles: { dark: false, vibration: true } },
    );
    expect(out.toggles).toEqual({ dark: false, sound: false, vibration: true });
  });

  it("7. extractToggleValue: null settings → default", async () => {
    const { extractToggleValue } = await loadFresh();
    expect(extractToggleValue(null, "dark", true)).toBe(true);
    expect(extractToggleValue(null, "dark", false)).toBe(false);
  });

  it("8. extractToggleValue: missing key → default", async () => {
    const { extractToggleValue } = await loadFresh();
    expect(extractToggleValue({ toggles: {} }, "dark", true)).toBe(true);
  });

  it("9. extractToggleValue: present boolean → that value", async () => {
    const { extractToggleValue } = await loadFresh();
    expect(extractToggleValue({ toggles: { dark: true } }, "dark", false)).toBe(true);
    expect(extractToggleValue({ toggles: { dark: false } }, "dark", true)).toBe(false);
  });

  it("10. extractToggleValue: non-boolean value → default (fail-safe)", async () => {
    const { extractToggleValue } = await loadFresh();
    expect(extractToggleValue({ toggles: { dark: "yes" } } as any, "dark", true)).toBe(true);
    expect(extractToggleValue({ toggles: { dark: 1 } } as any, "dark", false)).toBe(false);
  });
});
