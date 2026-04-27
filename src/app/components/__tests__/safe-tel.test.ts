// ═══════════════════════════════════════════════════════════════
// SOSphere — safeTelCall test suite (CRIT-#2 verification)
// ─────────────────────────────────────────────────────────────
// Pins the new emergency-fallback contract so it cannot regress
// into the silent-fail behaviour we discovered on 2026-04-27.
//
//  • emergency short codes (911 / 112 / 999 / 997 / 998 / 122 /
//    140 / 000 / etc.) → MUST fall back to tel: on native if the
//    CallNumber plugin throws. Life > app-chooser UX.
//  • personal contacts (8+ digit international numbers) → MUST
//    NOT fall back to tel: on native (the chooser is bad UX).
//  • desktop and mobile-web behaviour unchanged.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── sonner toast mock (top-level — vi.mock is hoisted) ──
const { toastFn, toastError } = vi.hoisted(() => {
  const err = vi.fn();
  const fn = vi.fn() as any;
  fn.error = err;
  fn.success = vi.fn();
  return { toastFn: fn, toastError: err };
});
vi.mock("sonner", () => ({ toast: toastFn }));

// ── capacitor-call-number mock (we control success / failure per test) ──
const { callNumberMock } = vi.hoisted(() => ({
  callNumberMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("capacitor-call-number", () => ({
  CallNumber: { call: callNumberMock },
}));

import {
  safeTelCall,
  isEmergencyShortCode,
} from "../utils/safe-tel";

// ── Test helpers: control native vs web shell + window.location.href ──
function setNative(isNative: boolean) {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.Capacitor = isNative
    ? { isNativePlatform: () => true }
    : undefined;
}

function setMobileUA(isMobile: boolean) {
  // Node 22+ makes globalThis.navigator a getter-only property, so direct
  // assignment throws. Use Object.defineProperty with configurable:true.
  const ua = isMobile
    ? "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36"
    : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
  const navObj = { userAgent: ua, clipboard: { writeText: () => Promise.resolve() } };
  try {
    Object.defineProperty(globalThis, "navigator", {
      value: navObj,
      configurable: true,
      writable: true,
    });
  } catch {
    // Fallback for older Node runtimes where direct assignment is allowed.
    (globalThis as any).navigator = navObj;
  }
}

function trackTelHref(): { calls: string[] } {
  const calls: string[] = [];
  // window.location.href is a getter/setter; we replace `location` entirely.
  (globalThis as any).window.location = {
    _href: "",
    set href(v: string) { calls.push(v); },
    get href() { return ""; },
  };
  // window.open is used in the mobile-web tier
  (globalThis as any).window.open = (url: string) => calls.push(url);
  return { calls };
}

describe("isEmergencyShortCode", () => {
  it("matches 3-digit emergency numbers", () => {
    expect(isEmergencyShortCode("911")).toBe(true);
    expect(isEmergencyShortCode("112")).toBe(true);
    expect(isEmergencyShortCode("999")).toBe(true);
    expect(isEmergencyShortCode("997")).toBe(true);
    expect(isEmergencyShortCode("998")).toBe(true);
    expect(isEmergencyShortCode("122")).toBe(true);
    expect(isEmergencyShortCode("140")).toBe(true);
    expect(isEmergencyShortCode("000")).toBe(true);
    expect(isEmergencyShortCode("100")).toBe(true);
  });

  it("matches 4-digit emergency numbers", () => {
    expect(isEmergencyShortCode("9999")).toBe(true);
    expect(isEmergencyShortCode("1000")).toBe(true);
  });

  it("rejects regular international numbers", () => {
    expect(isEmergencyShortCode("966501234567")).toBe(false); // SA mobile
    expect(isEmergencyShortCode("12025550100")).toBe(false);  // US example
    expect(isEmergencyShortCode("4412345678")).toBe(false);   // UK
    expect(isEmergencyShortCode("+966501234567")).toBe(false); // contains +
  });

  it("rejects too-short and too-long inputs", () => {
    expect(isEmergencyShortCode("")).toBe(false);
    expect(isEmergencyShortCode("9")).toBe(false);
    expect(isEmergencyShortCode("99")).toBe(false);
    expect(isEmergencyShortCode("99999")).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(isEmergencyShortCode("91a")).toBe(false);
    expect(isEmergencyShortCode("9 1 1")).toBe(false);
  });
});

describe("safeTelCall — CRIT-#2 emergency fallback contract", () => {
  beforeEach(() => {
    callNumberMock.mockReset();
    callNumberMock.mockResolvedValue(undefined);
    toastFn.mockReset();
    toastError.mockReset();
    toastFn.success.mockReset();
  });

  // ── Native + plugin SUCCEEDS — never falls back ──────────────
  it("native + plugin succeeds: uses CallNumber, NO tel: fallback", async () => {
    setNative(true);
    const { calls } = trackTelHref();
    callNumberMock.mockResolvedValueOnce(undefined);

    await safeTelCall("911", "emergency-services");

    expect(callNumberMock).toHaveBeenCalledWith({ number: "911", bypassAppChooser: true });
    expect(calls).toEqual([]); // no tel: ever
    expect(toastError).not.toHaveBeenCalled();
  });

  // ── Native + plugin FAILS + emergency short code → tel: fallback ──
  it("CRIT-#2: native + plugin fails for 911 → falls back to tel:911", async () => {
    setNative(true);
    const { calls } = trackTelHref();
    callNumberMock.mockRejectedValueOnce(new Error("plugin not loaded"));

    await safeTelCall("911", "emergency-services");

    expect(callNumberMock).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["tel:911"]);   // the critical fix
    expect(toastError).not.toHaveBeenCalled(); // no scary toast — call IS dialing
  });

  it("CRIT-#2: native + plugin fails for 112 → tel:112", async () => {
    setNative(true);
    const { calls } = trackTelHref();
    callNumberMock.mockRejectedValueOnce(new Error("crash"));

    await safeTelCall("112", "emergency");

    expect(calls).toEqual(["tel:112"]);
  });

  it("CRIT-#2: native + plugin fails for 997 (SA) → tel:997", async () => {
    setNative(true);
    const { calls } = trackTelHref();
    callNumberMock.mockRejectedValueOnce(new Error("native crash"));

    await safeTelCall("997", "emergency");

    expect(calls).toEqual(["tel:997"]);
  });

  // ── Native + plugin FAILS + REGULAR contact → original toast behaviour ──
  it("native + plugin fails for personal contact: shows toast, NO tel: fallback (preserves no-chooser UX)", async () => {
    setNative(true);
    const { calls } = trackTelHref();
    callNumberMock.mockRejectedValueOnce(new Error("plugin failed"));

    await safeTelCall("+966501234567", "Ahmad");

    expect(calls).toEqual([]); // NO tel: — chooser would be annoying for regular contact
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toMatch(/Cannot call/);
  });

  // ── Explicit allowTelFallbackOnNative override works ──────────
  it("explicit allowTelFallbackOnNative=true forces fallback even for non-short-code numbers", async () => {
    setNative(true);
    const { calls } = trackTelHref();
    callNumberMock.mockRejectedValueOnce(new Error("plugin failed"));

    await safeTelCall("+966112233445", "dispatcher-bridge", { allowTelFallbackOnNative: true });

    expect(calls).toEqual(["tel:+966112233445"]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("explicit allowTelFallbackOnNative=false suppresses fallback even for emergency short codes", async () => {
    setNative(true);
    const { calls } = trackTelHref();
    callNumberMock.mockRejectedValueOnce(new Error("plugin failed"));

    await safeTelCall("911", "test", { allowTelFallbackOnNative: false });

    expect(calls).toEqual([]);  // explicit no-fallback wins over auto-detect
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  // ── Mobile web (non-native) unchanged ─────────────────────────
  it("mobile-web: opens tel: directly (no plugin, no chooser concern)", async () => {
    setNative(false);
    setMobileUA(true);
    const { calls } = trackTelHref();

    await safeTelCall("+966501234567", "Ahmad");

    expect(calls).toEqual(["tel:+966501234567"]);
    expect(callNumberMock).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  // ── Desktop unchanged ─────────────────────────────────────────
  it("desktop: shows toast with Copy action, never calls plugin", async () => {
    setNative(false);
    setMobileUA(false);
    const { calls } = trackTelHref();

    await safeTelCall("+966501234567", "Ahmad");

    expect(calls).toEqual([]);            // no tel: on desktop
    expect(callNumberMock).not.toHaveBeenCalled();
    expect(toastFn).toHaveBeenCalledTimes(1);  // the Copy toast
  });

  // ── Edge: empty / whitespace-only number → no-op ──────────────
  it("returns silently for empty / whitespace-only number", async () => {
    setNative(true);
    const { calls } = trackTelHref();

    await safeTelCall("", "blank");
    await safeTelCall("   ", "blank");

    expect(callNumberMock).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(toastError).not.toHaveBeenCalled();
  });

  // ── Cleaning: strips whitespace / brackets before dialing ─────
  it("strips formatting whitespace / brackets before dialing", async () => {
    setNative(true);
    const { calls } = trackTelHref();
    callNumberMock.mockRejectedValueOnce(new Error("force fallback"));

    await safeTelCall(" (911) ", "spaces", { allowTelFallbackOnNative: true });

    expect(callNumberMock).toHaveBeenCalledWith({ number: "911", bypassAppChooser: true });
    expect(calls).toEqual(["tel:911"]);
  });
});
