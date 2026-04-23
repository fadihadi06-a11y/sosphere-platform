// ═══════════════════════════════════════════════════════════════
// SOSphere — Validation helpers test suite (D-H8 / E-H8)
// ─────────────────────────────────────────────────────────────
// Pins the behaviour of utils/validation.ts so every form in the
// app applies the SAME rules. If this file diverges, SOS-dialed
// numbers can pass check-in forms but fail at Twilio (21211).
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import {
  isValidE164Phone,
  isValidEmail,
  isValidUuid,
  isNonEmptyString,
  sanitiseUserInput,
  isValidHttpUrl,
} from "../utils/validation";

describe("isValidE164Phone (E-H8)", () => {
  it("accepts well-formed international numbers", () => {
    expect(isValidE164Phone("+966512345678")).toBe(true);   // Saudi
    expect(isValidE164Phone("+14155551234")).toBe(true);    // US
    expect(isValidE164Phone("+441234567890")).toBe(true);   // UK
    expect(isValidE164Phone("+9661234567")).toBe(true);     // 10-digit
    expect(isValidE164Phone("+966123456789012")).toBe(true); // 15 digits (ITU-T E.164 max)
  });

  it("accepts formatting junk and normalises", () => {
    expect(isValidE164Phone("+966 51 234 5678")).toBe(true);
    expect(isValidE164Phone("+966-51-234-5678")).toBe(true);
    expect(isValidE164Phone("+1 (415) 555-1234")).toBe(true);
    expect(isValidE164Phone("+1.415.555.1234")).toBe(true);
  });

  it("accepts missing +", () => {
    // Server-side we prefer explicit +, but client-side we allow missing
    // so users in form fields don't have to think about it.
    expect(isValidE164Phone("966512345678")).toBe(true);
  });

  it("accepts '00' international access code (MENA / EU convention)", () => {
    // AUDIT-FIX 2026-04-18: live test with a real Iraqi contact
    // `009647728569514` was being rejected. ITU-T treats `00` as
    // equivalent to `+` for international dialing.
    expect(isValidE164Phone("009647728569514")).toBe(true); // Iraq
    expect(isValidE164Phone("00441234567890")).toBe(true);  // UK via 00
    expect(isValidE164Phone("0044 1234 567890")).toBe(true); // with spaces
  });

  it("rejects nullish / empty / garbage", () => {
    expect(isValidE164Phone(null)).toBe(false);
    expect(isValidE164Phone(undefined)).toBe(false);
    expect(isValidE164Phone("")).toBe(false);
    expect(isValidE164Phone("   ")).toBe(false);
    expect(isValidE164Phone("abc")).toBe(false);
    expect(isValidE164Phone("+abc123")).toBe(false);
  });

  it("rejects too-short numbers (< 8 digits)", () => {
    expect(isValidE164Phone("+9661234")).toBe(false); // 7 digits
    expect(isValidE164Phone("12345")).toBe(false);
  });

  it("rejects too-long numbers (> 15 digits)", () => {
    expect(isValidE164Phone("+966123456789012345678")).toBe(false); // 20+ digits
  });

  it("rejects single-leading-zero numbers (invalid E.164)", () => {
    // E.164 country codes never start with 0. But "00" prefix is
    // legitimate international access code (handled by the test above).
    expect(isValidE164Phone("+0123456789")).toBe(false);
    expect(isValidE164Phone("0123456789")).toBe(false);
  });
});

describe("isValidEmail (D-H8)", () => {
  it("accepts normal addresses", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("first.last@company.co.uk")).toBe(true);
    expect(isValidEmail("name+tag@gmail.com")).toBe(true);
    expect(isValidEmail("u@a.io")).toBe(true);
    expect(isValidEmail("admin@sub.domain.example.ae")).toBe(true);
  });

  it("trims whitespace before validating", () => {
    expect(isValidEmail("  user@example.com  ")).toBe(true);
  });

  it("rejects obviously malformed addresses", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("no-at-sign")).toBe(false);
    expect(isValidEmail("@example.com")).toBe(false);
    expect(isValidEmail("user@")).toBe(false);
    expect(isValidEmail("user@example")).toBe(false); // no TLD
    expect(isValidEmail("user@@example.com")).toBe(false);
    expect(isValidEmail("user@.com")).toBe(false);
    expect(isValidEmail("user@example.")).toBe(false);
  });

  it("rejects the 'a@b.c' edge case (TLD too short)", () => {
    // This is the case the inline regex in company-register.tsx used
    // to ACCEPT but Supabase/SMTP rejects. Now we reject it too.
    expect(isValidEmail("a@b.c")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail(123 as any)).toBe(false);
  });

  it("rejects over-length emails (RFC 5321 cap 254)", () => {
    const long = "a".repeat(250) + "@x.com";
    expect(isValidEmail(long)).toBe(false);
  });
});

describe("isValidUuid", () => {
  it("accepts canonical UUIDs", () => {
    expect(isValidUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isValidUuid("c9a800a9-fa25-4498-81bc-cb4bd38cc0af")).toBe(true);
  });

  it("rejects malformed", () => {
    expect(isValidUuid("")).toBe(false);
    expect(isValidUuid("not-a-uuid")).toBe(false);
    expect(isValidUuid("550e8400-e29b-41d4-a716")).toBe(false); // too short
    expect(isValidUuid("550e8400e29b41d4a716446655440000")).toBe(false); // no hyphens
  });
});

describe("isNonEmptyString", () => {
  it("narrows types correctly", () => {
    expect(isNonEmptyString("hi")).toBe(true);
    expect(isNonEmptyString("  x  ")).toBe(true);
    expect(isNonEmptyString("")).toBe(false);
    expect(isNonEmptyString("   ")).toBe(false);
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(0)).toBe(false);
  });
});

describe("sanitiseUserInput", () => {
  it("trims whitespace", () => {
    expect(sanitiseUserInput("  hello  ")).toBe("hello");
  });

  it("strips control characters", () => {
    // \u0000 null, \u0007 bell, \u007F delete
    expect(sanitiseUserInput("he\u0000llo")).toBe("hello");
    expect(sanitiseUserInput("b\u0007eep")).toBe("beep");
  });

  it("strips bidi override (anti-spoofing)", () => {
    // \u202E is Right-to-Left Override — can flip display of adjacent chars.
    // Attackers use this for filename-extension spoofing.
    expect(sanitiseUserInput("safe\u202Egpj.exe")).toBe("safegpj.exe");
  });

  it("caps length", () => {
    const long = "a".repeat(5000);
    expect(sanitiseUserInput(long).length).toBe(2000);
    expect(sanitiseUserInput(long, { maxLength: 10 }).length).toBe(10);
  });

  it("returns empty string for non-string", () => {
    expect(sanitiseUserInput(null)).toBe("");
    expect(sanitiseUserInput(undefined)).toBe("");
    expect(sanitiseUserInput(42 as any)).toBe("");
  });
});

describe("isValidHttpUrl", () => {
  it("accepts http + https URLs", () => {
    expect(isValidHttpUrl("https://sosphere.co")).toBe(true);
    expect(isValidHttpUrl("http://localhost:3000/x")).toBe(true);
    expect(isValidHttpUrl("https://a.b/path?q=1")).toBe(true);
  });

  it("rejects other schemes", () => {
    expect(isValidHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isValidHttpUrl("ftp://files.example.com")).toBe(false);
    expect(isValidHttpUrl("data:text/html,x")).toBe(false);
    expect(isValidHttpUrl("mailto:a@b.c")).toBe(false);
  });

  it("rejects malformed", () => {
    expect(isValidHttpUrl("")).toBe(false);
    expect(isValidHttpUrl("not a url")).toBe(false);
    expect(isValidHttpUrl(null)).toBe(false);
  });
});
