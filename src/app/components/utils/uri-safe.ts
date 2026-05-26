// ═══════════════════════════════════════════════════════════════
// SOSphere — Safe URI Builders
// ─────────────────────────────────────────────────────────────
// CodeQL js/xss-through-dom flags every `window.location.href = `
// `tel:${...}`` and similar template-string URI assignment because
// the embedded value could in principle contain a `javascript:`
// scheme or DTMF separator characters (`#`, `,`, `;`) that change
// dialer behaviour.
//
// This module gives every URI build site exactly one entry point.
// Each builder runs a STRICT allow-list filter on the embedded
// value:
//
//   buildTelURI(phone)       digits + leading "+" only
//   buildSmsURI(phone, body) phone sanitised, body URL-encoded
//   buildWhatsAppURI(...)    digits only (wa.me requires no "+")
//   buildMailtoURI(...)      RFC-compatible local + domain only
//   buildMapsURI(lat, lng)   numeric, 6-decimal lat/lng only
//
// All builders return "" when the input cannot be safely encoded,
// so callers MUST check the return value before using it in a
// window.location.href / window.open / <a href={…}> sink.
//
// Why this exists and not inline sanitisation:
//   1) CodeQL recognises the strict-allow-list pattern and stops
//      flagging the sink — closes the bulk of the 314 alerts on
//      js/xss-through-dom.
//   2) Single source of truth — if we ever need to add a new
//      filter rule (e.g. block premium-rate numbers, block specific
//      country codes), every dial / SMS / WhatsApp path picks it
//      up automatically.
//   3) DTMF-injection defence: removing `#`, `,`, `;`, `*` from
//      phone input prevents an attacker who controls a phone-number
//      string from auto-dialling premium codes or extensions.
//
// Nothing here imports React or touches the DOM — safe to import
// from any module.
// ═══════════════════════════════════════════════════════════════

/**
 * Reduce a phone-number-like string to digits with an optional
 * leading "+". Removes ALL other characters — including:
 *   spaces, hyphens, parentheses (cosmetic)
 *   `#`, `,`, `;`, `*` (DTMF / dial-control — security)
 *   `:`, `?`, `&`, `=`, `/` (URI metachars — security)
 *   letters (could form `javascript:` or other schemes)
 *
 * Returns "" for null/undefined/empty input so callers can use
 * the result unconditionally.
 */
export function sanitizePhoneE164(phone: unknown): string {
  if (typeof phone !== "string" || phone.length === 0) return "";
  // Capture leading "+" once, then strip everything that isn't a digit.
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return "";
  return hasPlus ? "+" + digits : digits;
}

/**
 * Build a `tel:` URI safe to assign to `window.location.href` or
 * `window.open()`. Returns "" if the phone cannot be sanitised.
 */
export function buildTelURI(phone: unknown): string {
  const sanitized = sanitizePhoneE164(phone);
  if (!sanitized) return "";
  return "tel:" + sanitized;
}

/**
 * Build an `sms:` URI with an optional URL-encoded body. The phone
 * is sanitised to digits + leading "+"; the body is passed through
 * `encodeURIComponent` so meta-characters cannot break out into
 * extra URI parameters.
 */
export function buildSmsURI(phone: unknown, body?: string): string {
  const sanitized = sanitizePhoneE164(phone);
  if (!sanitized) return "";
  const bodyParam = typeof body === "string" && body.length > 0
    ? "?body=" + encodeURIComponent(body)
    : "";
  return "sms:" + sanitized + bodyParam;
}

/**
 * Build a `https://wa.me/<digits>` URI. WhatsApp's wa.me format
 * REQUIRES digits with no leading "+", so this strips it.
 * Optional message is URL-encoded.
 */
export function buildWhatsAppURI(phone: unknown, message?: string): string {
  // Strip the "+" — wa.me wants raw digits.
  const sanitized = sanitizePhoneE164(phone).replace(/^\+/, "");
  if (!sanitized) return "";
  const text = typeof message === "string" && message.length > 0
    ? "?text=" + encodeURIComponent(message)
    : "";
  return "https://wa.me/" + sanitized + text;
}

/**
 * Build a `mailto:` URI. Strict email shape (local@domain.tld)
 * required — anything that fails the shape returns "".
 * Optional subject and body are URL-encoded.
 */
export function buildMailtoURI(
  email: unknown,
  subject?: string,
  body?: string,
): string {
  if (typeof email !== "string") return "";
  // Strict allow-list for email characters: letters, digits, and the
  // small set RFC-5321 permits in a local-part or domain.
  const safe = email.trim().replace(/[^A-Za-z0-9@._+\-]/g, "");
  // Must look like `local@domain.tld` after sanitisation.
  if (!/^[A-Za-z0-9._+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(safe)) return "";
  const params: string[] = [];
  if (typeof subject === "string" && subject.length > 0) {
    params.push("subject=" + encodeURIComponent(subject));
  }
  if (typeof body === "string" && body.length > 0) {
    params.push("body=" + encodeURIComponent(body));
  }
  return "mailto:" + safe + (params.length > 0 ? "?" + params.join("&") : "");
}

/**
 * Build a Google Maps URI from lat/lng coordinates. Coordinates
 * are coerced to numbers and bounded to 6 decimal places — anything
 * that isn't a finite number returns "".
 */
export function buildMapsURI(lat: unknown, lng: unknown): string {
  const nlat = Number(lat);
  const nlng = Number(lng);
  if (!Number.isFinite(nlat) || !Number.isFinite(nlng)) return "";
  if (nlat < -90 || nlat > 90 || nlng < -180 || nlng > 180) return "";
  return "https://maps.google.com/?q=" + nlat.toFixed(6) + "," + nlng.toFixed(6);
}

/**
 * Build a Google Maps directions URI from origin + destination
 * coordinates. Same numeric safety as `buildMapsURI`.
 */
export function buildMapsDirectionsURI(
  originLat: unknown,
  originLng: unknown,
  destLat: unknown,
  destLng: unknown,
  travelMode: "driving" | "walking" | "bicycling" | "transit" = "driving",
): string {
  const oLat = Number(originLat);
  const oLng = Number(originLng);
  const dLat = Number(destLat);
  const dLng = Number(destLng);
  if (!Number.isFinite(oLat) || !Number.isFinite(oLng)) return "";
  if (!Number.isFinite(dLat) || !Number.isFinite(dLng)) return "";
  if (oLat < -90 || oLat > 90 || dLat < -90 || dLat > 90) return "";
  if (oLng < -180 || oLng > 180 || dLng < -180 || dLng > 180) return "";
  // travelMode is a closed union — no user input enters it.
  return (
    "https://www.google.com/maps/dir/?api=1" +
    "&origin=" + oLat.toFixed(6) + "," + oLng.toFixed(6) +
    "&destination=" + dLat.toFixed(6) + "," + dLng.toFixed(6) +
    "&travelmode=" + travelMode
  );
}
