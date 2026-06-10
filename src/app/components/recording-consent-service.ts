// ═══════════════════════════════════════════════════════════════
// SOSphere — Recording Consent Logger
// Writes proof of the user's recording-consent decision to the server
// (profiles.recording_consent_at/_decision via record_consent RPC).
// Best-effort: never throws / blocks the UI.
// ═══════════════════════════════════════════════════════════════
import { supabase } from "./api/supabase-client";

export async function recordRecordingConsent(granted: boolean): Promise<void> {
  try {
    await supabase.rpc("record_consent", { p_kind: "recording", p_decision: granted ? "granted" : "declined" });
  } catch { /* best-effort proof; on-device toggle still governs behaviour */ }
}
