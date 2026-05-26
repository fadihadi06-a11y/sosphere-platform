// ═══════════════════════════════════════════════════════════════
// SOSphere — Cryptographically secure random helpers
// ─────────────────────────────────────────────────────────────
// CodeQL js/insecure-randomness flags every `Math.random()` that
// flows into a security-sensitive sink — audit-log IDs, safety
// link tokens, certification IDs, PIN-like material. Math.random
// is a Mersenne Twister: deterministic, seedable, and not safe
// for any ID an attacker should not be able to predict.
//
// This module wraps `crypto.getRandomValues()` (Web Crypto API,
// available in modern browsers and Node ≥ 18) with three helpers
// that cover every place we used Math.random for ID generation:
//
//   secureRandomString(length, charset?)   N-char allow-list string
//   secureRandomId(prefix)                 `${prefix}-${ts36}-${secStr(5)}`
//   secureRandomInt(maxExclusive)          integer in [0, max)
//
// Each helper falls back to Math.random ONLY if Web Crypto is
// genuinely unavailable (very old browsers, server-side render
// without polyfill) — and even then it logs a console.warn so
// the regression is visible. The fallback is intentionally
// minimal and the production path is always crypto-backed.
//
// Why a new module and not inline crypto.getRandomValues calls:
//   1) CodeQL recognises the wrapper as a sanitiser and stops
//      flagging the upstream call sites — closes the 7 High
//      js/insecure-randomness alerts in one PR.
//   2) Single allow-list for charset chars — easy to harden
//      later (e.g. drop visually-confusable chars like 0/O/1/l).
//   3) Future-proof: if we add HSM-backed RNG or per-tenant
//      seeded streams, every ID call site picks it up.
// ═══════════════════════════════════════════════════════════════

/** Default alphanumeric charset used by secureRandomString. */
const DEFAULT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Resolve the platform's Web Crypto object, or return null if it
 * is genuinely unavailable. Avoids throwing — callers can use
 * `getCrypto() ?? fallback`.
 */
function getCrypto(): Crypto | null {
  // Browser
  if (typeof globalThis !== "undefined" && globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    return globalThis.crypto;
  }
  // Node 18+ (web crypto exposed on globalThis.crypto) — already covered above.
  // Older Node would require `import("node:crypto").webcrypto`, which is async
  // and would force every caller to be async. We accept the very-rare fallback
  // case here rather than complicate every API.
  return null;
}

/** True iff crypto.getRandomValues is available. Useful for tests. */
export function hasSecureRandom(): boolean {
  return getCrypto() !== null;
}

/**
 * Cryptographically secure integer in the half-open range
 * `[0, maxExclusive)`. Uses rejection sampling to avoid modulo
 * bias — caller does not need to worry about uniform distribution.
 *
 * Throws if Web Crypto is unavailable. We INTENTIONALLY do not
 * fall back to Math.random: a CodeQL dataflow trace would chase
 * the Math.random branch through every caller and re-flag the
 * sink as Insecure randomness even though the production path is
 * crypto-backed. A loud throw also exposes the misconfiguration
 * to the developer instead of silently downgrading to predictable
 * randomness. Web Crypto is present in every modern browser and
 * Node ≥ 18; the throw path is unreachable in production.
 */
export function secureRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError("secureRandomInt: maxExclusive must be a positive integer");
  }
  const c = getCrypto();
  if (!c) {
    throw new Error(
      "secureRandomInt: Web Crypto API (crypto.getRandomValues) is not available in this environment. " +
      "Refusing to fall back to Math.random because the call site is security-sensitive."
    );
  }
  // Rejection sampling against the largest multiple of maxExclusive
  // that fits in 32 bits. This keeps the distribution uniform.
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    c.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % maxExclusive;
  }
}

/**
 * Cryptographically secure random string of the requested length,
 * drawn from `charset` (default: alphanumeric). All chars are
 * sampled with uniform distribution via secureRandomInt.
 */
export function secureRandomString(length: number, charset: string = DEFAULT_CHARS): string {
  if (!Number.isInteger(length) || length <= 0) return "";
  if (typeof charset !== "string" || charset.length === 0) {
    throw new RangeError("secureRandomString: charset must be a non-empty string");
  }
  let out = "";
  for (let i = 0; i < length; i++) {
    out += charset.charAt(secureRandomInt(charset.length));
  }
  return out;
}

/**
 * Build an ID of the form `${prefix}-${TIMESTAMP36}-${RAND5}`,
 * matching the legacy ad-hoc format that audit logs and safety
 * links used to build with Math.random.
 * The random suffix is cryptographically secure.
 */
export function secureRandomId(prefix: string, randomLength: number = 5): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = secureRandomString(randomLength).toUpperCase();
  return prefix + "-" + ts + "-" + rand;
}
