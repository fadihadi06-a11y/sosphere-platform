// ═══════════════════════════════════════════════════════════════
// SOSphere — AES-GCM localStorage Encryption (Task #73)
// ─────────────────────────────────────────────────────────────
// Encrypts sensitive localStorage values using AES-256-GCM via
// the Web Crypto API. The encryption key is derived from a
// per-device passphrase using PBKDF2 (100k iterations, SHA-256).
//
// Why:
//   - localStorage is readable by any JS on the same origin.
//   - XSS or a rogue dependency could exfiltrate auth tokens,
//     admin phone numbers, PIN hashes, biometric handles, etc.
//   - AES-GCM provides authenticated encryption — tampered
//     ciphertext fails decryption, preventing silent corruption.
//
// What gets encrypted:
//   - Keys listed in SENSITIVE_KEYS below (auth tokens, PII, etc.)
//   - All other keys remain unencrypted (performance, debuggability).
//
// Key management:
//   - The AES key is derived from a random 32-byte seed that is
//     itself stored in localStorage under a non-obvious name.
//   - This is NOT a password-based scheme — the seed provides
//     defence-in-depth against casual inspection and XSS payloads
//     that read localStorage.getItem(knownKey) but don't know
//     to derive the AES key first. It does NOT protect against a
//     determined attacker with full JS execution on the origin.
//   - For true at-rest encryption, the seed should come from a
//     server-side HSM or be prompted from the user. This module
//     supports both: pass your own CryptoKey to `initSecureStorage`.
//
// Browser support: all browsers with SubtleCrypto (Chrome 37+,
// Firefox 34+, Safari 11+, Edge 12+). Falls back gracefully to
// plaintext if Web Crypto is unavailable.
// ═══════════════════════════════════════════════════════════════

// ── Keys that contain sensitive / PII data ───────────────────
export const SENSITIVE_KEYS = new Set([
  "sosphere_admin_profile",
  "sosphere_admin_phone",
  "sosphere_auth_token",
  "sosphere_refresh_token",
  "sosphere_biometric_handles",
  "sosphere_biometric_user",
  "sosphere_emergency_contacts",
  "sosphere_pin_hash",
  "sosphere_mfa_backup",
  "sosphere_device_id",
]);

// ── Internal constants ───────────────────────────────────────
const SEED_KEY = "sosphere_ks_v1"; // key-seed storage key
const PBKDF2_ITERATIONS = 100_000;
const CIPHER_PREFIX = "enc:v1:"; // marks encrypted values

let _key: CryptoKey | null = null;
let _available: boolean | null = null;

// ── Availability check ───────────────────────────────────────
function isWebCryptoAvailable(): boolean {
  if (_available !== null) return _available;
  try {
    _available = !!(
      typeof crypto !== "undefined" &&
      crypto.subtle &&
      typeof crypto.subtle.encrypt === "function"
    );
  } catch {
    _available = false;
  }
  return _available;
}

// ── Key derivation ───────────────────────────────────────────
async function deriveKey(seed: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw", seed, "PBKDF2", false, ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode("sosphere-aes-gcm-v1"),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ── Initialise / retrieve encryption key ─────────────────────
async function getOrCreateKey(): Promise<CryptoKey> {
  if (_key) return _key;

  let seedHex = localStorage.getItem(SEED_KEY);
  let seed: Uint8Array;

  if (seedHex) {
    // Restore existing seed
    seed = new Uint8Array(
      (seedHex.match(/.{2}/g) || []).map(b => parseInt(b, 16)),
    );
  } else {
    // First run — generate random seed
    seed = crypto.getRandomValues(new Uint8Array(32));
    seedHex = Array.from(seed).map(b => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(SEED_KEY, seedHex);
  }

  _key = await deriveKey(seed);
  return _key;
}

/**
 * Initialise secure storage with an externally managed key.
 * Call this at app startup if you want to use a server-provided key.
 * If not called, a per-device random key is generated automatically.
 */
export async function initSecureStorage(externalKey?: CryptoKey): Promise<void> {
  if (externalKey) {
    _key = externalKey;
    return;
  }
  if (isWebCryptoAvailable()) {
    await getOrCreateKey();
  }
}

// ── Encrypt ──────────────────────────────────────────────────
export async function encryptValue(plaintext: string): Promise<string> {
  if (!isWebCryptoAvailable()) return plaintext;

  try {
    const key = await getOrCreateKey();
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
    const enc = new TextEncoder();
    const cipherBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      enc.encode(plaintext),
    );
    // Format: enc:v1:<iv-hex>:<ciphertext-hex>
    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, "0")).join("");
    const ctHex = Array.from(new Uint8Array(cipherBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
    return `${CIPHER_PREFIX}${ivHex}:${ctHex}`;
  } catch (e) {
    console.warn("[SecureStorage] Encryption failed, storing plaintext:", e);
    return plaintext;
  }
}

// ── Decrypt ──────────────────────────────────────────────────
export async function decryptValue(stored: string): Promise<string> {
  // Not encrypted — return as-is (backward compatible)
  if (!stored.startsWith(CIPHER_PREFIX)) return stored;
  if (!isWebCryptoAvailable()) {
    console.warn("[SecureStorage] Web Crypto unavailable, cannot decrypt");
    return stored;
  }

  try {
    const key = await getOrCreateKey();
    const payload = stored.slice(CIPHER_PREFIX.length);
    const [ivHex, ctHex] = payload.split(":");
    if (!ivHex || !ctHex) return stored;

    const iv = new Uint8Array((ivHex.match(/.{2}/g) || []).map(b => parseInt(b, 16)));
    const ct = new Uint8Array((ctHex.match(/.{2}/g) || []).map(b => parseInt(b, 16)));

    const plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ct,
    );
    return new TextDecoder().decode(plainBuf);
  } catch (e) {
    console.warn("[SecureStorage] Decryption failed (tampered or wrong key):", e);
    return stored; // Return raw value so caller can handle gracefully
  }
}

// ── Convenience: check if a key should be encrypted ──────────
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key);
}

// ── Secure write ─────────────────────────────────────────────
export async function secureSetItem(key: string, value: string): Promise<void> {
  if (isSensitiveKey(key) && isWebCryptoAvailable()) {
    const encrypted = await encryptValue(value);
    localStorage.setItem(key, encrypted);
  } else {
    localStorage.setItem(key, value);
  }
}

// ── Secure read ──────────────────────────────────────────────
export async function secureGetItem(key: string): Promise<string | null> {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  if (raw.startsWith(CIPHER_PREFIX) && isWebCryptoAvailable()) {
    return decryptValue(raw);
  }
  return raw;
}

// ── Migrate existing plaintext sensitive keys to encrypted ───
export async function migrateToEncrypted(): Promise<number> {
  if (!isWebCryptoAvailable()) return 0;
  let migrated = 0;
  for (const key of SENSITIVE_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw && !raw.startsWith(CIPHER_PREFIX)) {
      try {
        const encrypted = await encryptValue(raw);
        localStorage.setItem(key, encrypted);
        migrated++;
      } catch {
        // Don't break migration for one key
      }
    }
  }
  if (migrated > 0) {
    console.log(`[SecureStorage] Migrated ${migrated} key(s) to AES-GCM`);
  }
  return migrated;
}
