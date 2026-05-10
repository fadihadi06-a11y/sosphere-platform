// ═══════════════════════════════════════════════════════════════
// SOSphere — L2-E Phase 1: Free tier first-call invariants
// ─────────────────────────────────────────────────────────────
// Locks the contract that Free tier gets ONE voice call attempt
// in parallel with SMS, breaking the prior SMS-only silence.
//
// Per SOS_FLOW_DESIGN.md §3.2 Phase A:
//   • A Free user who triggers SOS now fires a 30s-ring TTS announce
//     call to the contact, in parallel with the SMS.
//   • The call uses sos-bridge-twiml with mode=announce.
//   • Phase 2 (separate commit) will add the full 3-call cascade +
//     5s retry SMS + multi-contact escalation orchestrated via
//     twilio-status StatusCallback events.
//
// What this guards against:
//   • A future refactor reverting Free tier back to SMS-only
//     ("Free tier: no call, just SMS" comment regrowing).
//   • A future refactor breaking the dispatch_attempts ledger by
//     marking Free-tier call legs as 'skipped' (the pre-Phase-1
//     placeholder) — would mask real voice dispatch failures.
//   • A future refactor changing the L1-C method label so that a
//     Free-tier SOS reports 'sms_only' even though a call DID fire.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let alertSrc = "";

beforeAll(() => {
  alertSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/sos-alert/index.ts"),
    "utf8",
  );
});

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("L2-E Phase 1: Free tier fires a TTS announce call", () => {
  it("the old 'Free tier: no call, just SMS' comment is gone (code didn't regress)", () => {
    const code = stripComments(alertSrc);
    // The exact prior-state marker must not be present anywhere.
    expect(alertSrc).not.toMatch(/Free tier: no call, just SMS/);
    // Defensive: the runtime SHOULDN'T silently fall through to a null
    // callPromise on Free anymore.
    expect(code).toMatch(/freeAnnounceUrl/);
  });

  it("Free tier branch calls twilioCall with the announce TwiML mode", () => {
    expect(alertSrc).toMatch(/freeAnnounceUrl\s*=\s*`[^`]*sos-bridge-twiml\?mode=announce[^`]*`/);
    expect(alertSrc).toMatch(/callPromise\s*=\s*twilioCall\(\s*cleanPhone,\s*freeAnnounceUrl/);
  });

  it("Free tier call uses 30s timeout (Phase-1 single attempt budget)", () => {
    // The free-tier call object includes timeout: 30 and timeLimitSec: 30.
    expect(alertSrc).toMatch(/callPromise\s*=\s*twilioCall\(\s*cleanPhone,\s*freeAnnounceUrl[\s\S]*?timeout:\s*30[\s\S]*?timeLimitSec:\s*30/);
  });

  it("L1-C method label for Free is now 'tts_call_plus_sms' not 'sms_only'", () => {
    expect(alertSrc).toMatch(/tier === "free" \?\s*"tts_call_plus_sms"/);
    // sms_only must NOT appear for the free arm anymore. (It can still
    // appear in unrelated comments, hence the strict shape match above.)
    const freeArm = alertSrc.match(/tier === "free" \?\s*"[a-z_]+"/);
    expect(freeArm).not.toBeNull();
    if (freeArm) expect(freeArm[0]).not.toMatch(/sms_only/);
  });
});

describe("L2-E Phase 1: L2-B dispatch ledger labels Free tier correctly", () => {
  it("callChannel maps tier='free' to 'tts_call' (was null before)", () => {
    expect(alertSrc).toMatch(/tier === "free"\s*\?\s*"tts_call"/);
  });

  it("the dead 'else if (tier === \"free\")' skipped-branch is removed", () => {
    // Specifically: NO branch that records p_outcome:'skipped' for Free
    // tier in the dispatch ledger. Free now uses the main callChannel
    // path which records sent/failed/invalid like basic/elite.
    const code = stripComments(alertSrc);
    expect(code).not.toMatch(/else if \(tier === ['"]free['"]\)[\s\S]{0,200}p_outcome:\s*['"]skipped['"]/);
  });
});
