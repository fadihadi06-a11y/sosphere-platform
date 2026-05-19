// ═══════════════════════════════════════════════════════════════════════════
// R-48 + R-49 — locale-aware emergency-services contract tests
// ─────────────────────────────────────────────────────────────────────────
// What we are pinning here:
//
//   R-49 utility: countryFromPhone() must derive the ISO country from
//                 every dial code in the COUNTRIES table, with longest-
//                 prefix-match semantics for overlapping NANP codes
//                 (+1268 Antigua must beat +1 US).
//
//   R-48 utility: getEmergencyNumber() must return 997 for SA, 911 for
//                 US, 999 for GB, 112 for unknown countries.
//
//                 resolveDispatcherCountry() must prefer profileCountry
//                 over browserLocale (so a Saudi user with English UI
//                 still gets 997, not 911).
//
// These tests are the regression net for the R-48 root-cause fix in
// sos-emergency.tsx (lines ~2410, 3208, 3214). If anyone reverts the
// utility behavior, the wiring in sos-emergency.tsx silently breaks
// and life-safety routing collapses for non-US users. Lock it down.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { countryFromPhone } from "../utils/country-from-phone";
import { getEmergencyNumber, resolveDispatcherCountry } from "../utils/emergency-services";

describe("R-49: countryFromPhone", () => {
  it("derives SA from a +966 Saudi number", () => {
    expect(countryFromPhone("+966501234567")).toBe("SA");
  });

  it("derives AE from a +971 Emirati number", () => {
    expect(countryFromPhone("+971501234567")).toBe("AE");
  });

  it("derives GB from a +44 UK number", () => {
    expect(countryFromPhone("+447700900123")).toBe("GB");
  });

  it("derives US from a +1 NANP number (US is the default for +1)", () => {
    expect(countryFromPhone("+12025551234")).toBe("US");
  });

  it("prefers longest-prefix match (+1268 Antigua over +1 US)", () => {
    // R-49 longest-prefix-match invariant: COUNTRIES table has both +1
    // (US) and +1268 (AG). For an Antiguan number "+1268..." the
    // resolver MUST pick AG, not collapse to US.
    expect(countryFromPhone("+12685551234")).toBe("AG");
  });

  it("returns undefined for an empty string", () => {
    expect(countryFromPhone("")).toBeUndefined();
  });

  it("returns undefined for null / undefined input", () => {
    expect(countryFromPhone(null)).toBeUndefined();
    expect(countryFromPhone(undefined)).toBeUndefined();
  });

  it("returns undefined when the + sign is missing (defense in depth)", () => {
    // A bare "966..." without the leading + could match anything by
    // accident. We require E.164 format.
    expect(countryFromPhone("966501234567")).toBeUndefined();
  });

  it("trims whitespace before matching", () => {
    expect(countryFromPhone("  +966501234567  ")).toBe("SA");
  });
});

describe("R-48: getEmergencyNumber", () => {
  it("returns 997 for Saudi Arabia (PRIMARY MARKET — regression critical)", () => {
    // If this test ever returns "911" we lose every Saudi user in a
    // real emergency. The audit (MOBILE_AUDIT_FINDINGS R-48) was
    // triggered by a hardcoded "911" that bypassed this lookup.
    const r = getEmergencyNumber("SA");
    expect(r.number).toBe("997");
    expect(r.country).toBe("SA");
  });

  it("returns 998 for the UAE", () => {
    expect(getEmergencyNumber("AE").number).toBe("998");
  });

  it("returns 911 for the US", () => {
    expect(getEmergencyNumber("US").number).toBe("911");
  });

  it("returns 999 for the UK", () => {
    expect(getEmergencyNumber("GB").number).toBe("999");
  });

  it("returns 112 (international fallback) for an unknown ISO code", () => {
    const r = getEmergencyNumber("ZZ");
    expect(r.number).toBe("112");
    expect(r.fallback).toBe(true);
  });

  it("returns 112 for null / undefined / empty input", () => {
    expect(getEmergencyNumber(undefined).number).toBe("112");
    expect(getEmergencyNumber(null).number).toBe("112");
    expect(getEmergencyNumber("").number).toBe("112");
  });

  it("is case-insensitive on country code", () => {
    expect(getEmergencyNumber("sa").number).toBe("997");
    expect(getEmergencyNumber(" Sa ").number).toBe("997");
  });
});

describe("R-48: resolveDispatcherCountry priority chain", () => {
  it("prefers an explicit override over everything else", () => {
    const r = resolveDispatcherCountry({
      override: "SA",
      profileCountry: "US",
      browserLocale: "en-US",
    });
    expect(r).toBe("SA");
  });

  it("prefers profileCountry over browserLocale (the Saudi-with-English-UI fix)", () => {
    // R-48's core motivating case: a Saudi user whose phone UI is
    // English. navigator.language returns "en-US" — without R-49's
    // explicit country write, the resolver would have returned "US"
    // and the user would have been routed to 911 (not Saudi 997).
    const r = resolveDispatcherCountry({
      profileCountry: "SA",
      browserLocale: "en-US",
    });
    expect(r).toBe("SA");
  });

  it("falls back to browserLocale region when no override or profile", () => {
    expect(resolveDispatcherCountry({ browserLocale: "ar-SA" })).toBe("SA");
    expect(resolveDispatcherCountry({ browserLocale: "fr-FR" })).toBe("FR");
  });

  it("handles underscore locale formats (Android default)", () => {
    expect(resolveDispatcherCountry({ browserLocale: "ar_SA" })).toBe("SA");
  });

  it("returns undefined when no signals are present", () => {
    expect(resolveDispatcherCountry({})).toBeUndefined();
  });
});

describe("R-48: end-to-end Saudi emergency invariant", () => {
  it("a Saudi number → SA country → 997 emergency", () => {
    // The full chain that protects real Saudi users at 3am.
    const country = countryFromPhone("+966501234567");
    expect(country).toBe("SA");
    const resolved = resolveDispatcherCountry({ profileCountry: country });
    expect(resolved).toBe("SA");
    const emergency = getEmergencyNumber(resolved);
    expect(emergency.number).toBe("997");
  });

  it("a UAE number → AE country → 998 emergency", () => {
    const country = countryFromPhone("+971501234567");
    expect(country).toBe("AE");
    const emergency = getEmergencyNumber(resolveDispatcherCountry({ profileCountry: country }));
    expect(emergency.number).toBe("998");
  });
});
