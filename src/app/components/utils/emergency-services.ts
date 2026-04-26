// ═══════════════════════════════════════════════════════════════════════════
// utils/emergency-services — country-aware emergency-services number lookup
// ─────────────────────────────────────────────────────────────────────────
// 2026-04-25 (B-02): replaces hard-coded "997" sprinkled across the AI
//   Co-Admin and Intelligent Guide. The single source of truth for the
//   medical-emergency number used by the dispatcher's "Tap to dial"
//   modals lives here.
//
//   - getEmergencyNumber(countryCode?) returns { number, label, country }.
//   - When the country is unknown (offline, no profile), defaults to
//     "112" — the international GSM emergency number that works on
//     virtually every modern handset in addition to the local one.
//
// This file is the only place that should know specific country digits.
// If the user later wants to add a country, add a row to the table —
// no other code needs to change.
// ═══════════════════════════════════════════════════════════════════════════

export interface EmergencyServiceInfo {
  /** The dialable number — always digits, no spaces. */
  number: string;
  /** Short human label, e.g. "Ambulance / EMS". */
  label: string;
  /** ISO 3166-1 alpha-2 country code this number applies to. */
  country: string;
  /** Whether this number is the international fallback (112 / 911). */
  fallback?: boolean;
}

// ── Medical / ambulance numbers by ISO country code ──
// Source: same numbers used by the existing EmergencyServices screen
// (src/app/components/emergency-services.tsx). Kept in sync manually.
const MEDICAL_BY_COUNTRY: Record<string, EmergencyServiceInfo> = {
  SA: { number: "997",  label: "Ambulance / EMS",        country: "SA" },
  AE: { number: "998",  label: "Ambulance",              country: "AE" },
  KW: { number: "112",  label: "Emergency (All)",        country: "KW" },
  QA: { number: "999",  label: "Emergency (All)",        country: "QA" },
  BH: { number: "999",  label: "Emergency (All)",        country: "BH" },
  OM: { number: "9999", label: "Emergency (All)",        country: "OM" },
  EG: { number: "123",  label: "Ambulance",              country: "EG" },
  IQ: { number: "122",  label: "Ambulance",              country: "IQ" },
  JO: { number: "911",  label: "Emergency (All)",        country: "JO" },
  LB: { number: "140",  label: "Civil Defense",          country: "LB" },
  US: { number: "911",  label: "Emergency (All)",        country: "US" },
  CA: { number: "911",  label: "Emergency (All)",        country: "CA" },
  GB: { number: "999",  label: "Emergency (All)",        country: "GB" },
  AU: { number: "000",  label: "Emergency (All)",        country: "AU" },
  // EU + most of the world
  DE: { number: "112",  label: "Emergency (All)",        country: "DE" },
  FR: { number: "112",  label: "Emergency (All)",        country: "FR" },
  ES: { number: "112",  label: "Emergency (All)",        country: "ES" },
  IT: { number: "112",  label: "Emergency (All)",        country: "IT" },
  NL: { number: "112",  label: "Emergency (All)",        country: "NL" },
};

// International GSM fallback — works as a redirect on most carriers
// even when the device has no SIM or the local number is unknown.
const INTERNATIONAL_FALLBACK: EmergencyServiceInfo = {
  number: "112",
  label: "Emergency (international)",
  country: "INTL",
  fallback: true,
};

/**
 * Look up the medical / emergency number for a country.
 * If `countryCode` is missing or unknown, returns the international
 * fallback (112) with `fallback: true` so callers can show a small
 * "international" badge if they want.
 */
export function getEmergencyNumber(countryCode?: string | null): EmergencyServiceInfo {
  if (!countryCode) return INTERNATIONAL_FALLBACK;
  const normalized = countryCode.trim().toUpperCase();
  return MEDICAL_BY_COUNTRY[normalized] ?? INTERNATIONAL_FALLBACK;
}

/**
 * Best-effort country resolution for the current dispatcher.
 * Tries (in order): explicit override → user profile country (passed
 * in by caller) → browser language region → undefined.
 * The caller is responsible for providing the profile country if known —
 * we do NOT read localStorage here so this stays a pure function.
 */
export function resolveDispatcherCountry(opts: {
  override?: string;
  profileCountry?: string;
  browserLocale?: string;
}): string | undefined {
  if (opts.override) return opts.override.toUpperCase();
  if (opts.profileCountry) return opts.profileCountry.toUpperCase();
  if (opts.browserLocale) {
    // Locale shapes: "en-US", "ar-SA", "ar_SA". Take the region.
    const parts = opts.browserLocale.split(/[-_]/);
    if (parts.length > 1) return parts[1].toUpperCase();
  }
  return undefined;
}
