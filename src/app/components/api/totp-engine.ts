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

function base32Decode(encoded: string): Uint8Array<ArrayBuffer> {
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
  // P0-ci-cleanup: concrete ArrayBuffer for crypto.subtle.importKey BufferSource
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i];
  return out;
}

// ── HMAC-SHA1 (required by TOTP standard) ────────────────────
async function hmacSha1(
  key: Uint8Array<ArrayBuffer>,
  message: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  // P0-ci-cleanup: tighten param + return to Uint8Array<ArrayBuffer> so
  // crypto.subtle.importKey/sign BufferSource overloads match (newer TS
  // distinguishes ArrayBufferLike from ArrayBuffer for BufferSource).
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
  const timeBytes = new Uint8Array(new ArrayBuffer(8));
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
  const bytes = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(20)));
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
  const prevTimeBytes = new Uint8Array(new ArrayBuffer(8));
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

// ═══════════════════════════════════════════════════════════════
// Supabase Integration — Server-side TOTP (gold standard)
// ─────────────────────────────────────────────────────────────
// 2026-05-30 P2-Followup C: every part of the TOTP flow that touches
// the secret runs INSIDE Postgres. The client only ever sends:
//   • plaintext secret at enrollment (one-time, over TLS)
//   • 6-digit code at verification (no secret material)
//
// Architecture (defence-in-depth, four layers):
//   1. user_2fa.totp_secret_enc is pgp_sym_encrypt_bytea() of the RAW
//      decoded secret bytes (not the base32 text).
//   2. Master key lives in _app_secrets (deny-all RLS).
//   3. save_totp_secret() base32-decodes then encrypts in one step.
//   4. verify_user_2fa(code) runs HMAC-SHA1 server-side and returns
//      a boolean. The decrypted secret never leaves Postgres.
//
// The old client-side verifyTOTP() helper stays in this file as a
// pure RFC-6238 reference implementation (used by tests + as a
// fallback if a future flow ever needs in-browser verification).
//
// S-H3 fail-closed contract preserved: if Supabase is not configured
// we still refuse — never store secrets in localStorage.
// ═══════════════════════════════════════════════════════════════

/** Save TOTP secret to Supabase (encrypted at rest via SECDEF RPC).
 *  The `userId` param is informational; the RPC pins to auth.uid(). */
export async function saveTOTPSecret(_userId: string, secret: string): Promise<boolean> {
  if (!SUPABASE_CONFIG.isConfigured) {
    console.error("[TOTP] S-H3: refusing to save secret — Supabase not configured. 2FA unavailable offline.");
    return false;
  }
  try {
    const { data, error } = await supabase.rpc("save_totp_secret", { p_secret: secret });
    if (error) {
      console.warn("[TOTP] save_totp_secret RPC failed:", error.message);
      return false;
    }
    return data === true;
  } catch (e) {
    console.warn("[TOTP] Save failed:", e);
    return false;
  }
}

/** Check if user has 2FA enabled.
 *  Direct SELECT on user_2fa.enabled is still allowed by RLS
 *  for the caller's own row (no secret material involved). */
export async function is2FAEnabled(userId: string): Promise<boolean> {
  if (!SUPABASE_CONFIG.isConfigured) return false;
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

/** Verify a user's TOTP code end-to-end via server-side RPC.
 *  The 6-digit code is sent to the DB; the secret stays encrypted
 *  on the server side. Returns true iff the code matches the
 *  current or previous 30-second window (RFC 6238 clock skew). */
export async function verifyUser2FA(_userId: string, code: string): Promise<boolean> {
  if (!SUPABASE_CONFIG.isConfigured) return false;
  if (!code || code.length !== 6) return false;
  try {
    const { data, error } = await supabase.rpc("verify_user_2fa", { p_code: code });
    if (error) {
      console.warn("[TOTP] verify_user_2fa RPC failed:", error.message);
      return false;
    }
    return data === true;
  } catch (e) {
    console.warn("[TOTP] Verify failed:", e);
    return false;
  }
}

/** Disable 2FA for a user.
 * S-H3: still sweep any legacy `sosphere_totp_<uid>` localStorage
 * entry from a pre-fix build so it cannot leak across logins. */
export async function disable2FA(userId: string): Promise<boolean> {
  try { localStorage.removeItem(`sosphere_totp_${userId}`); } catch { /* ignore */ }
  if (!SUPABASE_CONFIG.isConfigured) {
    console.warn("[TOTP] S-H3: Supabase not configured — cannot persist 2FA disable server-side.");
    return false;
  }
  try {
    await supabase.from("user_2fa").update({ enabled: false }).eq("user_id", userId);
    return true;
  } catch {
    return false;
  }
}
