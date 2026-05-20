// ═══════════════════════════════════════════════════════════════════════════
// R-66 — language auto-detection contract tests
// ─────────────────────────────────────────────────────────────────────────
// Pins the universal UX behavior: no blocking language picker on first
// launch. The language is auto-detected from device locale, and only an
// EXPLICIT user choice (via Settings → Language) is persisted. This
// matches Apple HIG, Material Design, and WhatsApp/Telegram/Uber/Netflix.
//
// If anyone reverts the picker to be "first screen blocking", these
// tests fail and force the universal pattern back.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getLang } from "../useLang";

// Stub localStorage + navigator on globalThis (same pattern as r50).
function stubGlobals(opts: { savedLang?: string | null; deviceLocale?: string | undefined }) {
  // localStorage stub
  const lsStore: Record<string, string> = {};
  if (opts.savedLang) lsStore["sosphere_lang"] = opts.savedLang;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (k in lsStore ? lsStore[k] : null),
      setItem: (k: string, v: string) => { lsStore[k] = v; },
      removeItem: (k: string) => { delete lsStore[k]; },
      clear: () => { for (const k of Object.keys(lsStore)) delete lsStore[k]; },
      key: () => null,
      length: 0,
    },
  });
  // navigator stub
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: { language: opts.deviceLocale, languages: opts.deviceLocale ? [opts.deviceLocale] : [] },
  });
  // window stub (used as the "typeof window !== undefined" gate)
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { localStorage: globalThis.localStorage, addEventListener: () => {}, removeEventListener: () => {} },
  });
}

beforeEach(() => {
  // Defaults are overridden per-test via stubGlobals.
});

afterEach(() => {
  // @ts-expect-error — test cleanup
  delete globalThis.localStorage;
  // @ts-expect-error — test cleanup
  delete globalThis.navigator;
  // @ts-expect-error — test cleanup
  delete globalThis.window;
});

describe("R-66: explicit user choice wins (Settings → Language)", () => {
  it("returns the saved value when sosphere_lang is set, regardless of device locale", () => {
    stubGlobals({ savedLang: "en", deviceLocale: "ar-SA" });
    expect(getLang()).toBe("en");
  });

  it("returns 'ar' when explicit Arabic is saved even with US device", () => {
    stubGlobals({ savedLang: "ar", deviceLocale: "en-US" });
    expect(getLang()).toBe("ar");
  });
});

describe("R-66: auto-detect from device locale when no explicit choice", () => {
  it("returns 'ar' for ar-SA device with no saved choice", () => {
    stubGlobals({ savedLang: null, deviceLocale: "ar-SA" });
    expect(getLang()).toBe("ar");
  });

  it("returns 'ar' for ar-EG device", () => {
    stubGlobals({ savedLang: null, deviceLocale: "ar-EG" });
    expect(getLang()).toBe("ar");
  });

  it("returns 'en' for en-US device", () => {
    stubGlobals({ savedLang: null, deviceLocale: "en-US" });
    expect(getLang()).toBe("en");
  });

  it("returns 'en' for en-GB device", () => {
    stubGlobals({ savedLang: null, deviceLocale: "en-GB" });
    expect(getLang()).toBe("en");
  });

  it("returns the Saudi-market default ('ar') for an unknown locale", () => {
    // R-66: fr-FR is not natively supported by the app, so we fall to
    // the project's market default rather than ship a half-localized UI.
    stubGlobals({ savedLang: null, deviceLocale: "fr-FR" });
    expect(getLang()).toBe("ar");
  });

  it("handles missing navigator.language by falling back to default", () => {
    stubGlobals({ savedLang: null, deviceLocale: undefined });
    expect(getLang()).toBe("ar");
  });
});

describe("R-66: auto-detect does NOT persist (storage stays clean)", () => {
  it("calling getLang() without an explicit choice does not write to localStorage", () => {
    stubGlobals({ savedLang: null, deviceLocale: "en-US" });
    getLang();
    // After getLang(), the value should still be null — only setLang() writes.
    expect((globalThis as { localStorage: { getItem(k: string): string | null } }).localStorage.getItem("sosphere_lang")).toBeNull();
  });
});
