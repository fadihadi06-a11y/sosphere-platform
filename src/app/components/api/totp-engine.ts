// ═══════════════════════════════════════════════════════════════
// SOSphere — TOTP 2FA Engine (Google Authenticator Compatible)
// ─────────────────────────────────────────────────────────────
// Implements RFC 6238 TOTP (Time-based One-Time Password)
// Compatible with: Google Authenticator, Authy, Microsoft Auth
//
// Flow:
//   1. Admin enables 2FA → generate secret → show QR code
//   2. Admin scans QR with Authenticator app
//   3. Admin enters 6-digit code to confirm setup
//   4. On sensitive operations: verify TOTP before allowing
//
// Cost: FREE — runs entirely in browser + Supabase DB
// ═══════════════════════════════════════════════════════════════

import { supabase, SUPABASE_CONFIG } from "./supabase-client";

// ── Base32 encoding/decoding (RFC 4648) ──────────────────────
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Uint8Array): string {
  let result = "";
  let bits = 0;
  let value = 0;
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 31];
  }
  return result;
}

function base32Decode(encoded: string): Uint8Array {
  const cleaned = encoded.replace(/[= ]/g, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of cleaned) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

// ── HMAC-SHA1 (required by TOTP standard) ────────────────────
async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, message);
  return new Uint8Array(sig);
}

// ── TOTP Generation ──────────────────────────────────────────
async function generateTOTP(secret: string, timeStep: number = 30, digits: number = 6): Promise<string> {
  const key = base32Decode(secret);
  const time = Math.floor(Date.now() / 1000 / timeStep);

  // Convert time to 8-byte big-endian
  const timeBytes = new Uint8Array(8);
  let t = time;
  for (let i = 7; i >= 0; i--) {
    timeBytes[i] = t & 0xff;
    t = Math.floor(t / 256);
  }

  const hmac = await hmacSha1(key, timeBytes);

  // Dynamic truncation (RFC 4226)
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (code % Math.pow(10, digits)).toString().padStart(digits, "0");
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

/** Generate a new TOTP secret (20 random bytes → base32) */
export function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return base32Encode(bytes);
}

/** Build otpauth:// URI for QR code scanning */
export function buildOTPAuthURI(
  secret: string,
  userEmail: string,
  issuer: string = "SOSphere",
): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedEmail = encodeURIComponent(userEmail);
  return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&digits=6&period=30`;
}

/** Verify a 6-digit TOTP code (checks current + previous window for clock skew) */
export async function verifyTOTP(secret: string, code: string): Promise<boolean> {
  // Check current time window
  const current = await generateTOTP(secret);
  if (current === code) return true;

  // Check previous window (30s ago) for clock skew tolerance
  const prevKey = base32Decode(secret);
  const prevTime = Math.floor(Date.now() / 1000 / 30) - 1;
  const prevTimeBytes = new Uint8Array(8);
  let t = prevTime;
  for (let i = 7; i >= 0; i--) {
    prevTimeBytes[i] = t & 0xff;
    t = Math.floor(t / 256);
  }
  const prevHmac = await hmacSha1(prevKey, prevTimeBytes);
  const prevOffset = prevHmac[prevHmac.length - 1] & 0x0f;
  const prevCode = (
    ((prevHmac[prevOffset] & 0x7f) << 24) |
    ((prevHmac[prevOffset + 1] & 0xff) << 16) |
    ((prevHmac[prevOffset + 2] & 0xff) << 8) |
    (prevHmac[prevOffset + 3] & 0xff)
  ) % 1000000;

  return prevCode.toString().padStart(6, "0") === code;
}

// ── Supabase Integration ────────────────────────────────────

/** Save TOTP secret to Supabase (encrypted at rest) */
export async function saveTOTPSecret(userId: string, secret: string): Promise<boolean> {
  if (!SUPABASE_CONFIG.isConfigured) {
    localStorage.setItem(`sosphere_totp_${userId}`, secret);
    return true;
  }
  try {
    await supabase.from("user_2fa").upsert({
      user_id: userId,
      totp_secret: secret,
      enabled: true,
      enabled_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    return true;
  } catch (e) {
    console.warn("[TOTP] Save failed:", e);
    return false;
  }
}

/** Check if user has 2FA enabled */
export async function is2FAEnabled(userId: string): Promise<boolean> {
  if (!SUPABASE_CONFIG.isConfigured) {
    return !!localStorage.getItem(`sosphere_totp_${userId}`);
  }
  try {
    const { data } = await supabase
      .from("user_2fa")
      .select("enabled")
      .eq("user_id", userId)
      .single();
    return data?.enabled === true;
  } catch {
    return false;
  }
}

/** Get TOTP secret for verification */
export async function getTOTPSecret(userId: string): Promise<string | null> {
  if (!SUPABASE_CONFIG.isConfigured) {
    return localStorage.getItem(`sosphere_totp_${userId}`);
  }
  try {
    const { data } = await supabase
      .from("user_2fa")
      .select("totp_secret")
      .eq("user_id", userId)
      .single();
    return data?.totp_secret || null;
  } catch {
    return null;
  }
}

/** Verify a user's TOTP code end-to-end */
export async function verifyUser2FA(userId: string, code: string): Promise<boolean> {
  const secret = await getTOTPSecret(userId);
  if (!secret) return false;
  return verifyTOTP(secret, code);
}

/** Disable 2FA for a user */
export async function disable2FA(userId: string): Promise<boolean> {
  if (!SUPABASE_CONFIG.isConfigured) {
    localStorage.removeItem(`sosphere_totp_${userId}`);
    return true;
  }
  try {
    await supabase.from("user_2fa").update({ enabled: false }).eq("user_id", userId);
    return true;
  } catch {
    return false;
  }
}
