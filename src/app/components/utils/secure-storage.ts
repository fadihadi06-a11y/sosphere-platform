// ═══════════════════════════════════════════════════════════════
// SOSphere — AES-GCM localStorage Encryption (Task #73)
// ═══════════════════════════════════════════════════════════════

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

const SEED_KEY = "sosphere_ks_v1";
const PBKDF2_ITERATIONS = 100_000;
const CIPHER_PREFIX = "enc:v1:";

let _key: CryptoKey | null = null;
let _available: boolean | null = null;

function isWebCryptoAvailable(): boolean {
  if (_available !== null) return _available;
  try {
    _available = !!(typeof crypto !== "undefined" && crypto.subtle && typeof crypto.subtle.encrypt === "function");
  } catch { _available = false; }
  return _available;
}

async function deriveKey(seed: Uint8Array): Promise<CryptoKey> {
  // WebCrypto overloads are notoriously strict in TS 5.x — cast to avoid
  // CI-specific "No overload matches" failures across different lib versions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subtle = crypto.subtle as any;
  const keyMaterial: CryptoKey = await subtle.importKey("raw", seed, { name: "PBKDF2" }, false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt: new TextEncoder().encode("sosphere-aes-gcm-v1"), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  ) as CryptoKey;
}

async function getOrCreateKey(): Promise<CryptoKey> {
  if (_key) return _key;
  let seedHex = localStorage.getItem(SEED_KEY);
  let seed: Uint8Array;
  if (seedHex) {
    seed = new Uint8Array((seedHex.match(/.{2}/g) || []).map(b => parseInt(b, 16)));
  } else {
    seed = crypto.getRandomValues(new Uint8Array(32));
    seedHex = Array.from(seed).map(b => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(SEED_KEY, seedHex);
  }
  _key = await deriveKey(seed);
  return _key;
}

export async function initSecureStorage(externalKey?: CryptoKey): Promise<void> {
  if (externalKey) { _key = externalKey; return; }
  if (isWebCryptoAvailable()) { await getOrCreateKey(); }
}

export async function encryptValue(plaintext: string): Promise<string> {
  if (!isWebCryptoAvailable()) return plaintext;
  try {
    const key = await getOrCreateKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, "0")).join("");
    const ctHex = Array.from(new Uint8Array(cipherBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
    return CIPHER_PREFIX + ivHex + ":" + ctHex;
  } catch (e) {
    console.warn("[SecureStorage] Encryption failed:", e);
    return plaintext;
  }
}

export async function decryptValue(stored: string): Promise<string> {
  if (!stored.startsWith(CIPHER_PREFIX)) return stored;
  if (!isWebCryptoAvailable()) return stored;
  try {
    const key = await getOrCreateKey();
    const payload = stored.slice(CIPHER_PREFIX.length);
    const colonIdx = payload.indexOf(":");
    if (colonIdx < 0) return stored;
    const ivHex = payload.slice(0, colonIdx);
    const ctHex = payload.slice(colonIdx + 1);
    const iv = new Uint8Array((ivHex.match(/.{2}/g) || []).map(b => parseInt(b, 16)));
    const ct = new Uint8Array((ctHex.match(/.{2}/g) || []).map(b => parseInt(b, 16)));
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(plainBuf);
  } catch (e) {
    console.warn("[SecureStorage] Decryption failed:", e);
    return stored;
  }
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key);
}

export async function secureSetItem(key: string, value: string): Promise<void> {
  if (isSensitiveKey(key) && isWebCryptoAvailable()) {
    const encrypted = await encryptValue(value);
    localStorage.setItem(key, encrypted);
  } else {
    localStorage.setItem(key, value);
  }
}

export async function secureGetItem(key: string): Promise<string | null> {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  if (raw.startsWith(CIPHER_PREFIX) && isWebCryptoAvailable()) {
    return decryptValue(raw);
  }
  return raw;
}

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
      } catch { /* skip */ }
    }
  }
  if (migrated > 0) console.log("[SecureStorage] Migrated " + migrated + " key(s) to AES-GCM");
  return migrated;
}
