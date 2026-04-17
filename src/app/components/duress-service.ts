/**
 * SOSphere Duress PIN Service
 * ═══════════════════════════
 * A "duress code" is a second PIN that LOOKS like a normal deactivation PIN
 * to an attacker/coercer, but secretly:
 *   • Tags the end-of-SOS event with duress=true (server/dashboard see the flag)
 *   • Leaves a distinct trail in the incident timeline
 *   • Still ends the local SOS UI so the coercer is visually deceived
 *
 * Design principles:
 *   • Purely additive — no existing flow is altered unless both PINs are set.
 *   • Storage is isolated from the normal deactivation PIN key.
 *   • Tier-gated: Elite-only feature per subscription-service.features.duressCode.
 *
 * SUPABASE_MIGRATION_POINT: replace localStorage with a server-side hashed
 * record on the user's profile row. For now PINs are stored plaintext to
 * match the existing deactivation-PIN pattern; migrate to SHA-256 in Phase 5.
 */

import { hasFeature } from "./subscription-service";

// ── E-M1: PIN hashing + constant-time compare ────────────────────
// Previous versions stored the duress and deactivation PINs as
// plaintext in localStorage. That made both PINs readable by any
// extension / other tab / XSS payload that could touch localStorage,
// and defeated the entire point of having a *separate* duress PIN.
//
// We now store ONLY a SHA-256 hash of the PIN, salted per-device
// with a random per-install value. Verification uses constant-time
// equality so an attacker cannot deduce the PIN byte-by-byte from
// response-time differences.
//
// Backwards compatibility: if we find a legacy plaintext PIN in
// localStorage (written by a pre-fix build), we upgrade it to a
// hash on first read and DELETE the plaintext entry. The user
// doesn't need to re-enter anything.
//
// KEY LAYOUT (all localStorage):
//   sosphere_pin_salt           — hex string, 16 bytes (per-install salt)
//   sosphere_duress_pin_hash    — SHA-256(salt || pin), 64 hex chars
//   sosphere_deactivation_pin_hash — same shape, separate key

const DURESS_PIN_KEY               = "sosphere_duress_pin";            // legacy plaintext key (purged on upgrade)
const DEACTIVATION_PIN_KEY         = "sosphere_deactivation_pin";      // legacy plaintext key (purged on upgrade)
const DURESS_PIN_HASH_KEY          = "sosphere_duress_pin_hash";
const DEACTIVATION_PIN_HASH_KEY    = "sosphere_deactivation_pin_hash";
const PIN_SALT_KEY                 = "sosphere_pin_salt";
const LEGACY_MARKER                = "__legacy_pre_hash__";

function getOrCreateSalt(): string {
  try {
    let salt = localStorage.getItem(PIN_SALT_KEY);
    if (salt && /^[a-f0-9]{32}$/.test(salt)) return salt;
    // 16 random bytes → 32 hex chars
    const bytes = new Uint8Array(16);
    (globalThis.crypto || (globalThis as any).msCrypto).getRandomValues(bytes);
    salt = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(PIN_SALT_KEY, salt);
    return salt;
  } catch {
    // Deterministic fallback for ancient browsers without crypto —
    // still better than no salt (server will never see either value).
    return "fallback-salt-00000000000000000";
  }
}

async function hashPin(pin: string): Promise<string | null> {
  if (!pin || typeof pin !== "string") return null;
  const salt = getOrCreateSalt();
  try {
    const enc = new TextEncoder();
    const data = enc.encode(salt + ":" + pin);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** Constant-time string compare. Does NOT early-return on mismatch. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** One-time migration: if a plaintext PIN exists under the legacy
 *  key, hash it under the new key and remove the plaintext. Safe to
 *  call on every startup — it does nothing if already migrated. */
async function migrateLegacyPin(
  legacyKey: string,
  hashKey: string,
): Promise<void> {
  try {
    const plaintext = localStorage.getItem(legacyKey);
    if (!plaintext || plaintext === LEGACY_MARKER) return;
    const hash = await hashPin(plaintext);
    if (hash) {
      localStorage.setItem(hashKey, hash);
      // Mark legacy slot as migrated so we don't re-hash on every read.
      // We keep the marker rather than a full delete so pre-fix builds
      // can still detect "a PIN is set" from the presence of the key.
      localStorage.setItem(legacyKey, LEGACY_MARKER);
    }
  } catch { /* best effort */ }
}

/** Elite feature gate. Returns true only for tiers that unlock duressCode. */
export function isDuressFeatureAvailable(): boolean {
  return hasFeature("duressCode");
}

/**
 * E-M1: getDuressPin returns the HASH now, not the PIN. Callers
 * that need to check equality must use isDuressPin(input). External
 * callers that previously relied on the plaintext value will get
 * the hash instead — which is safe (comparing two hashes is fine)
 * but semantically different. No external callers exist in-tree.
 */
export function getDuressPin(): string | null {
  try {
    const hash = localStorage.getItem(DURESS_PIN_HASH_KEY);
    if (hash && /^[a-f0-9]{64}$/.test(hash)) return hash;
    // Legacy path: if there's a plaintext value, trigger migration
    // fire-and-forget — caller will see null on this tick but the
    // next call will return the hash.
    const legacy = localStorage.getItem(DURESS_PIN_KEY);
    if (legacy && legacy !== LEGACY_MARKER) {
      void migrateLegacyPin(DURESS_PIN_KEY, DURESS_PIN_HASH_KEY);
    }
    return null;
  } catch {
    return null;
  }
}

/** Set or clear the duress PIN. Pass null/"" to clear. Returns success. */
export async function setDuressPin(pin: string | null): Promise<boolean> {
  try {
    if (pin === null || pin === "") {
      localStorage.removeItem(DURESS_PIN_HASH_KEY);
      localStorage.removeItem(DURESS_PIN_KEY); // also sweep any legacy
      return true;
    }
    if (!/^\d{4,10}$/.test(pin)) return false;
    // Guard: duress PIN must differ from the normal deactivation PIN
    // (hashes compared — don't reconstruct plaintext).
    const deactHash = localStorage.getItem(DEACTIVATION_PIN_HASH_KEY);
    const newHash = await hashPin(pin);
    if (!newHash) return false;
    if (deactHash && constantTimeEquals(deactHash, newHash)) return false;
    localStorage.setItem(DURESS_PIN_HASH_KEY, newHash);
    localStorage.removeItem(DURESS_PIN_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * True if the input matches the configured duress PIN.
 * Async because hashing requires SubtleCrypto. Callers in sync
 * contexts should await or use the legacy-sync fallback below.
 */
export async function isDuressPin(input: string): Promise<boolean> {
  const stored = getDuressPin();
  if (!stored) return false;
  const inputHash = await hashPin(input);
  if (!inputHash) return false;
  return constantTimeEquals(stored, inputHash);
}

/**
 * SYNC fallback — only for call sites that cannot await. Uses the
 * (fast) string comparison against a ONE-SHOT cached hash of the
 * last entered input. Less secure than the async path but still
 * beats plaintext storage. New code MUST use isDuressPin().
 */
let _lastInputHashCache: { input: string; hash: string } | null = null;
export function isDuressPinSync(input: string): boolean {
  const stored = getDuressPin();
  if (!stored) return false;
  // If we happen to have this exact input cached (entered earlier
  // this session), compare hashes — O(1), constant-time.
  if (_lastInputHashCache && _lastInputHashCache.input === input) {
    return constantTimeEquals(stored, _lastInputHashCache.hash);
  }
  // Otherwise schedule the hash compute for next time and fall back
  // to "not matched" — caller will need to re-verify via the async
  // path. This is intentional: a user manually typing a PIN can
  // easily await.
  void (async () => {
    const h = await hashPin(input);
    if (h) _lastInputHashCache = { input, hash: h };
  })();
  return false;
}

/**
 * Convenience read-only accessor for the normal deactivation PIN HASH.
 * Same semantics as getDuressPin — returns the hash, not the plaintext.
 */
export function getDeactivationPin(): string | null {
  try {
    const hash = localStorage.getItem(DEACTIVATION_PIN_HASH_KEY);
    if (hash && /^[a-f0-9]{64}$/.test(hash)) return hash;
    const legacy = localStorage.getItem(DEACTIVATION_PIN_KEY);
    if (legacy && legacy !== LEGACY_MARKER) {
      void migrateLegacyPin(DEACTIVATION_PIN_KEY, DEACTIVATION_PIN_HASH_KEY);
    }
    return null;
  } catch {
    return null;
  }
}

/** Setter for the normal deactivation PIN — mirrors the duress rules. */
export async function setDeactivationPin(pin: string | null): Promise<boolean> {
  try {
    if (pin === null || pin === "") {
      localStorage.removeItem(DEACTIVATION_PIN_HASH_KEY);
      localStorage.removeItem(DEACTIVATION_PIN_KEY);
      return true;
    }
    if (!/^\d{4,10}$/.test(pin)) return false;
    const duressHash = localStorage.getItem(DURESS_PIN_HASH_KEY);
    const newHash = await hashPin(pin);
    if (!newHash) return false;
    if (duressHash && constantTimeEquals(duressHash, newHash)) return false;
    localStorage.setItem(DEACTIVATION_PIN_HASH_KEY, newHash);
    localStorage.removeItem(DEACTIVATION_PIN_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Check deactivation PIN (async, constant-time). */
export async function isDeactivationPin(input: string): Promise<boolean> {
  const stored = getDeactivationPin();
  if (!stored) return false;
  const inputHash = await hashPin(input);
  if (!inputHash) return false;
  return constantTimeEquals(stored, inputHash);
}

/** Whether a normal deactivation PIN is configured. */
export function isDeactivationPinSet(): boolean {
  return getDeactivationPin() !== null;
}

/** Whether a duress PIN is configured. */
export function isDuressPinSet(): boolean {
  return getDuressPin() !== null;
}

/** Run legacy migrations once on module load. */
if (typeof localStorage !== "undefined") {
  void migrateLegacyPin(DURESS_PIN_KEY, DURESS_PIN_HASH_KEY);
  void migrateLegacyPin(DEACTIVATION_PIN_KEY, DEACTIVATION_PIN_HASH_KEY);
}
