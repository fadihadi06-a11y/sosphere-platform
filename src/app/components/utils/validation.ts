// ═══════════════════════════════════════════════════════════════
// SOSphere — Shared Validation Helpers  (D-H8 + E-H8 consolidation)
// ─────────────────────────────────────────────────────────────
// Centralises input validators so every form / API call applies
// the SAME rules. Before this, email and phone validation was
// rolled ad-hoc in ~6 files with subtly different regexes —
// meaning a phone that passed check-in didn't always pass SOS.
//
// Rules encoded here (keep them CONSERVATIVE — better to reject
// a weird-looking-but-valid input than to let a malformed one
// silently reach Twilio / Supabase):
//
//   isValidEmail(s)   RFC-5321 compatible local + domain + TLD
//   isValidE164Phone(s) +<country><number>, 8-15 digits total
//   isValidUuid(s)    RFC-4122 hex form with hyphens
//   isNonEmptyString(s) rejects null/undefined/"" and pure-whitespace
//   sanitiseUserInput(s) strips control chars + trims
//
// Nothing here touches the DOM or imports React — safe to import
// from Edge Functions, Workers, or React components alike.
// ═══════════════════════════════════════════════════════════════

/** True if the string looks like a real, dialable E.164 phone. */
export function isValidE164Phone(p: string | undefined | null): boolean {
  if (!p) return false;
  const s = String(p).replace(/[\s\-().]/g, "");
  return /^\+?[1-9]\d{7,14}$/.test(s);
}

/** True if the string is a syntactically valid email. We intentionally
 *  stop short of full RFC-5322 — that grammar admits addresses real
 *  MX servers reject. This matches the HTML5 `input[type=email]` rule
 *  plus a TLD-length sanity check. */
export function isValidEmail(s: string | undefined | null): boolean {
  if (typeof s !== "string") return false;
  const v = s.trim();
  if (v.length < 3 || v.length > 254) return false;
  // Local-part: letters/digits/._%+- (no leading/trailing dot).
  // Domain: letters/digits/.-, with a final TLD of 2-24 chars.
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/.test(v);
}

/** True if the string is a canonical RFC-4122 UUID (hyphenated). */
export function isValidUuid(s: string | undefined | null): boolean {
  if (typeof s !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

/** True if the value is a non-empty, non-whitespace-only string. */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Strip ASCII/Unicode control characters (including zero-width
 * and bidi override chars that can spoof UI text), trim whitespace,
 * and cap length. Returns an empty string for non-string input so
 * callers can use the result unconditionally.
 */
export function sanitiseUserInput(
  v: unknown,
  opts: { maxLength?: number } = {},
): string {
  if (typeof v !== "string") return "";
  const cap = opts.maxLength ?? 2000;
  return v
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .trim()
    .slice(0, cap);
}

/** True if the string is a valid URL with http/https scheme. */
export function isValidHttpUrl(s: string | undefined | null): boolean {
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
