// ═══════════════════════════════════════════════════════════════════════════
// utils/country-from-phone — derive ISO 3166-1 alpha-2 country code from
// a phone number in E.164 format ("+966501234567" → "SA").
// ─────────────────────────────────────────────────────────────────────────
// R-49 (LAUNCH_AUDIT MOBILE_AUDIT_FINDINGS.md, 2026-05-19) — STORAGE_KEYS.
// countryCode was defined but NEVER WRITTEN anywhere in the codebase, so
// the entire emergency-services country lookup chain (R-48 sister fix)
// had no upstream data source. This module is the canonical derivation
// path used wherever a phone number is in hand but the country isn't.
//
// Strategy: longest-prefix match against the canonical COUNTRIES table
// shipped with the country picker — same source of truth used by the
// login screen, so the result is guaranteed to match what the user saw
// when they tapped the flag at signup.
//
// CAVEAT (NANP — +1): the North American Numbering Plan groups US, CA,
// and many Caribbean islands under +1. Specific Caribbean +1xxx codes
// resolve correctly via longest-prefix. For the bare +1 case (US vs
// CA), this resolver defaults to "US"; callers needing CA-specific
// resolution must pass the country through explicitly.
// ═══════════════════════════════════════════════════════════════════════════

import { COUNTRIES } from "../country-picker";

/**
 * Derive an ISO 3166-1 alpha-2 country code from an E.164 phone number.
 *
 * @param phoneE164 — phone like "+966501234567" (with leading +)
 * @returns ISO code like "SA" — or undefined if no prefix matched
 *
 * @example
 *   countryFromPhone("+966501234567") // "SA"
 *   countryFromPhone("+12025551234")  // "US"  (NANP default)
 *   countryFromPhone("12345")         // undefined  (no +)
 *   countryFromPhone("")              // undefined
 */
export function countryFromPhone(phoneE164: string | null | undefined): string | undefined {
  if (!phoneE164 || typeof phoneE164 !== "string") return undefined;
  const trimmed = phoneE164.trim();
  if (!trimmed.startsWith("+")) return undefined;

  // Longest-prefix match — a +1268 (Antigua) must beat a +1 (US/CA)
  // because the table has both. We sort dial codes by length descending
  // and pick the first that the phone starts with. For ties at equal
  // length (the bare +1 collision between US and CA), prefer US so the
  // resolver returns a deterministic answer independent of COUNTRIES
  // list order.
  //
  // O(n) over COUNTRIES is fine — list is ~240 entries, runs once per
  // signup. Caching is not worth the complexity.
  const sorted = [...COUNTRIES].sort((a, b) => {
    if (b.dial.length !== a.dial.length) return b.dial.length - a.dial.length;
    if (a.dial === "+1" && a.code === "US") return -1;
    if (b.dial === "+1" && b.code === "US") return 1;
    return 0;
  });
  for (const c of sorted) {
    if (trimmed.startsWith(c.dial)) {
      return c.code.toUpperCase();
    }
  }
  return undefined;
}
