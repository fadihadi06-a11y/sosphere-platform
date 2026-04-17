// ═══════════════════════════════════════════════════════════════
// SOSphere — Phone Number E.164 Normalization (CLIENT-side)
// ─────────────────────────────────────────────────────────────
// Mirrors the server-side normalizer in
// `supabase/functions/sos-alert/index.ts`. The server rejects any
// phone that isn't a valid E.164 string, so we MUST pre-normalize
// before the number is persisted anywhere the SOS fan-out reads
// from (localStorage `sosphere_emergency_contacts`, `sosphere_safety_contacts`,
// profile screens, quick-setup, onboarding).
//
// Default country is Iraq (IQ) because the launch market is Iraqi
// civilians. Override per-device by setting localStorage
// `sosphere_default_country` to a valid ISO-3166 alpha-2 code.
//
// Rules:
//   • Passthrough if number already starts with '+' and has 8–15 digits
//   • '00' → '+'  (European-style international escape)
//   • Leading '0' stripped and default country dial prefix prepended
//   • Bare digits without leading 0 → prepend default country prefix
//   • Strips spaces, dashes, parens, etc. before validation
//   • Returns `null` for anything that can't be normalized safely —
//     callers MUST handle null (never pass raw through to Twilio).
// ═══════════════════════════════════════════════════════════════

export const COUNTRY_DIAL: Record<string, string> = {
  IQ: "964", // Iraq — launch market
  SA: "966", // Saudi Arabia
  AE: "971", // UAE
  KW: "965", // Kuwait
  QA: "974", // Qatar
  BH: "973", // Bahrain
  OM: "968", // Oman
  JO: "962", // Jordan
  LB: "961", // Lebanon
  EG: "20",  // Egypt
  TR: "90",  // Türkiye
  GB: "44",  // United Kingdom
  US: "1",   // United States
};

/**
 * Get the device-local default country (ISO-3166 alpha-2).
 * Priority: localStorage override → profile's stored country → IQ.
 * Safe to call from the browser — uses try/catch around storage.
 */
export function getDefaultCountry(): string {
  try {
    const ov = localStorage.getItem("sosphere_default_country");
    if (ov && COUNTRY_DIAL[ov.toUpperCase()]) return ov.toUpperCase();
  } catch {}
  return "IQ";
}

/**
 * Normalize a user-entered phone string to E.164.
 * Returns `null` if the string can't be interpreted safely.
 */
export function normalizeE164(phone: string | null | undefined, defaultCountry?: string): string | null {
  if (!phone) return null;
  const cleaned = String(phone).replace(/[^+\d]/g, "");
  if (!cleaned) return null;

  const country = (defaultCountry || getDefaultCountry()).toUpperCase();
  const dial = COUNTRY_DIAL[country];

  let normalized: string;
  if (cleaned.startsWith("+")) {
    normalized = cleaned;
  } else if (cleaned.startsWith("00")) {
    normalized = "+" + cleaned.slice(2);
  } else if (cleaned.startsWith("0")) {
    // National-format local number — strip leading 0, prepend dial code.
    if (!dial) return null;
    normalized = "+" + dial + cleaned.slice(1);
  } else {
    // Bare digits (e.g. user typed "964...") — if it already starts with
    // the default dial code, treat as international; otherwise prepend.
    if (!dial) return null;
    normalized = cleaned.startsWith(dial)
      ? "+" + cleaned
      : "+" + dial + cleaned;
  }

  const digits = normalized.slice(1);
  if (digits.length < 8 || digits.length > 15 || !/^\d+$/.test(digits)) {
    return null;
  }
  return normalized;
}

/**
 * Idempotent migration: rewrite every contact stored under the given
 * localStorage key so its `phone` field is E.164.  Leaves entries
 * untouched if their phone is already valid E.164, and flags malformed
 * entries with `phoneInvalid: true` (callers can surface a warning).
 *
 * Returns the number of entries changed (useful for logging).
 */
export function migrateStoredContactsToE164(storageKey: string): number {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return 0;
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return 0;

    let changes = 0;
    const migrated = list.map((c: any) => {
      if (!c || typeof c !== "object" || typeof c.phone !== "string") return c;
      const before = c.phone;
      const after = normalizeE164(before);
      if (after === null) {
        // Can't normalize — mark so UI can warn, but keep original so user
        // can see what they entered and edit it.
        if (!c.phoneInvalid) {
          changes++;
          return { ...c, phoneInvalid: true };
        }
        return c;
      }
      if (after !== before) {
        changes++;
        // Clear invalid flag if we fixed it.
        const { phoneInvalid: _pi, ...rest } = c;
        return { ...rest, phone: after };
      }
      return c;
    });

    if (changes > 0) {
      localStorage.setItem(storageKey, JSON.stringify(migrated));
      // Single diagnostic line — grep-able in chromium console.
      // Never log the raw phone numbers themselves (PII).
      try {
        console.info(
          "[phone-utils] migrated " + changes + " entries in " + storageKey + " to E.164"
        );
      } catch {}
    }
    return changes;
  } catch (e) {
    try {
      console.warn("[phone-utils] migration failed for " + storageKey + ": " + (e as Error).message);
    } catch {}
    return 0;
  }
}

/**
 * Run all known-contact-store migrations. Call ONCE on app mount.
 * Safe to re-run — each migration is idempotent.
 */
export function runAllPhoneMigrations(): void {
  // Primary SOS store — the one the fan-out reads.
  migrateStoredContactsToE164("sosphere_emergency_contacts");
  // Secondary tier-system store — the Safety Contacts screen.
  migrateStoredContactsToE164("sosphere_safety_contacts");
}
