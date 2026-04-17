// ═══════════════════════════════════════════════════════════════
// SOSphere — Biometric Server Persistence  (S-H2)
// ─────────────────────────────────────────────────────────────
// The existing biometric gate (biometric-gate.ts) treats a
// successful WebAuthn / native fingerprint assertion as "verified
// for this session" and sets an in-memory flag. That's correct
// for local UI gating, but it's NOT an audit trail. There's no
// record on the server that user X actually presented a biometric
// at time Y — so a stolen device + JWT-only attacker looks
// indistinguishable from a legitimate biometric-confirmed login.
//
// This module wraps the `biometric_verifications` table added in
// the Phase-1 SQL migration. It records:
//   • last_verified_at   — server timestamp of most recent success
//   • last_verified_method — webauthn | fingerprint | face | pin
//   • device_fingerprint_hash — optional ephemeral device tag
//
// RLS on the table restricts reads/writes to `user_id = auth.uid()`,
// so even with direct PostgREST access a malicious user cannot
// forge a row for another account.
//
// USAGE: wired from biometric-gate.ts#verifyBiometric on the
// success path. Fire-and-forget — a failed server write must
// NEVER prevent the user from proceeding. We log and move on.
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./supabase-client";

export type BiometricMethod = "webauthn" | "fingerprint" | "face" | "pin";

/**
 * Persist a successful biometric verification to the server.
 * Fire-and-forget; never throws. The returned Promise resolves
 * with `true` on success (for tests / debugging), `false` on any
 * error — but callers generally shouldn't branch on this.
 */
export async function recordBiometricVerification(
  method: BiometricMethod,
  deviceFingerprintHash?: string,
): Promise<boolean> {
  try {
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user?.id) {
      // No authenticated user — nothing to record. Not an error.
      return false;
    }

    const { error } = await supabase
      .from("biometric_verifications")
      .upsert(
        {
          user_id: user.id,
          last_verified_at: new Date().toISOString(),
          last_verified_method: method,
          device_fingerprint_hash: deviceFingerprintHash ?? null,
        },
        { onConflict: "user_id" },
      );

    if (error) {
      console.warn("[biometric-server] upsert failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[biometric-server] unexpected error:", err);
    return false;
  }
}

/**
 * Fetch the most recent server-recorded biometric verification for
 * the current user. Useful for showing "last verified X minutes
 * ago" in settings, and for server-side grace-window checks.
 */
export async function getLastBiometricVerification(): Promise<{
  verifiedAt: Date;
  method: BiometricMethod;
} | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return null;

    const { data, error } = await supabase
      .from("biometric_verifications")
      .select("last_verified_at, last_verified_method")
      .eq("user_id", user.id)
      .single();

    if (error || !data?.last_verified_at) return null;
    return {
      verifiedAt: new Date(data.last_verified_at),
      method: data.last_verified_method as BiometricMethod,
    };
  } catch {
    return null;
  }
}
