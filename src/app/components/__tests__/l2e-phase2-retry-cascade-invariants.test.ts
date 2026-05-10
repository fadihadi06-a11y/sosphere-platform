// ═══════════════════════════════════════════════════════════════
// SOSphere — L2-E Phase 2: voice-call retry cascade invariants
// ─────────────────────────────────────────────────────────────
// Locks the contract that an unanswered fanout call gets ONE
// retry attempt before the SMS fallback fires. Cascade cap = 2
// attempts total per contact. machine_start (voicemail) and
// `failed` (Twilio-side fault) intentionally DO NOT retry.
//
// Per SOS_FLOW_DESIGN.md §3.2 Phase B + the inline tier
// disposition snapshot in sos-alert/index.ts:
//   free:   ≤2× TTS announce (30s ring each)
//   basic:  ≤2× TTS announce (30s ring, 60s duration)
//   elite:  ≤2× Bridge conference (30s ring, 120s)
// Retry is uniform across tiers; only the TwiML differs.
//
// What this guards against:
//   • A refactor reverting twilio-status to fire SMS immediately
//     on no-answer/busy (skips the retry round, contact gets one
//     ring and a text — worse than Phase 2 by design).
//   • Removing the per-contact statusCallback URL — would
//     collapse retry decisions to a single per-emergency choice
//     and lose contactIndex/attemptN attribution.
//   • Lifting MAX_CALL_ATTEMPTS past 2 — spam risk + billing
//     amplification on an outage. If we ever raise this, the
//     change should be deliberate (new commit + new invariant).
//   • Retrying on `failed` or `machine_start` — `failed` is
//     usually a Twilio-side issue (retry compounds load) and
//     machine_start means the contact has voicemail evidence.
//   • Dropping the dispatch_attempts ledger write for retries —
//     would corrupt the L2-B "what did we try" audit chain.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let alertSrc = "";
let statusSrc = "";

beforeAll(() => {
  alertSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/sos-alert/index.ts"),
    "utf8",
  );
  statusSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/twilio-status/index.ts"),
    "utf8",
  );
});

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("L2-E Phase 2: sos-alert builds per-contact statusCallback URLs", () => {
  it("buildStatusCb helper exists and carries contactIndex + attemptN + tier", () => {
    const code = stripComments(alertSrc);
    expect(code).toMatch(/function\s+buildStatusCb\s*\(\s*opts:\s*\{[^}]*contactIndex:\s*number[^}]*attemptN:\s*number[^}]*tierStr:\s*string/);
    // The URL it builds MUST set all three of contactIndex/attemptN/tier
    expect(code).toMatch(/contactIndex:\s*String\(opts\.contactIndex\)/);
    expect(code).toMatch(/attemptN:\s*String\(opts\.attemptN\)/);
    expect(code).toMatch(/tier:\s*opts\.tierStr/);
  });

  it("each fanout call leg uses perContactStatusCb (not the global statusCb)", () => {
    const code = stripComments(alertSrc);
    // After Phase 2, the per-contact builder is used inside the
    // contacts.map fanout. The global statusCb is reserved for
    // non-fanout call sites (currently none in production code).
    expect(code).toMatch(/const\s+perContactStatusCb\s*=\s*buildStatusCb\(\s*\{\s*contactIndex:\s*idx,\s*attemptN:\s*1,\s*tierStr:\s*tier\s*\}/);
    // The basic/elite/free branches all pass perContactStatusCb to twilioCall.
    const occurrences = (code.match(/statusCallback:\s*perContactStatusCb/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(4);
  });

  it("the Phase-1 tier-disposition comment block was updated to Phase 2 (≤2 attempts)", () => {
    expect(alertSrc).toMatch(/L2-E Phase 2 \(2026-05-10\)/);
    expect(alertSrc).toMatch(/free:\s*≤2× TTS announce/);
    expect(alertSrc).toMatch(/basic:\s*≤2× TTS announce/);
    expect(alertSrc).toMatch(/elite:\s*≤2× Bridge conference/);
  });
});

describe("L2-E Phase 2: twilio-status orchestrates retry-or-escalate", () => {
  it("MAX_CALL_ATTEMPTS is exactly 2 (Phase-2 cap — not 3, not 1)", () => {
    expect(statusSrc).toMatch(/const\s+MAX_CALL_ATTEMPTS\s*=\s*2\b/);
  });

  it("reads contactIndex + attemptN + tier from the statusCallback URL", () => {
    expect(statusSrc).toMatch(/url\.searchParams\.get\(\s*["']contactIndex["']\s*\)/);
    expect(statusSrc).toMatch(/url\.searchParams\.get\(\s*["']attemptN["']\s*\)/);
    expect(statusSrc).toMatch(/url\.searchParams\.get\(\s*["']tier["']\s*\)/);
  });

  it("retry fires only on recoverable no-answer/busy (not on failed, not on machine_start)", () => {
    const code = stripComments(statusSrc);
    expect(code).toMatch(/isRecoverableNoAnswer\s*=\s*callStatus\s*===\s*["']no-answer["']\s*\|\|\s*callStatus\s*===\s*["']busy["']/);
    // machine_start is voicemail → DOES NOT retry, escalates to SMS.
    expect(code).toMatch(/isVoicemail\s*=\s*callStatus\s*===\s*["']completed["']\s*&&\s*answeredBy\s*===\s*["']machine_start["']/);
    // The retry-fire guard must require isRecoverableNoAnswer AND attemptN < MAX
    expect(code).toMatch(/isRecoverableNoAnswer\s*&&\s*attemptN\s*<\s*MAX_CALL_ATTEMPTS/);
  });

  it("SMS escalation does NOT fire while a retry is in flight (no double-signal)", () => {
    const code = stripComments(statusSrc);
    // The SMS-escalation guard must require !didFireRetry — otherwise
    // we'd fire SMS AND a retry call simultaneously, doubling the
    // signal cost for an unanswered call and breaking the cascade.
    expect(code).toMatch(/!didFireRetry\s*&&/);
  });

  it("fireRetryCall reads tier + contact_snapshot from sos_sessions (DB is trust root)", () => {
    expect(statusSrc).toMatch(/async function fireRetryCall\s*\(/);
    // Pulls contact_snapshot — not from webhook payload — for tamper-resistance.
    expect(statusSrc).toMatch(/contact_snapshot/);
    expect(statusSrc).toMatch(/from\(\s*["']sos_sessions["']\s*\)/);
  });

  it("retry call increments attemptN in the new statusCallback URL (caps cascade)", () => {
    const code = stripComments(statusSrc);
    // The retry must call fireRetryCall with attemptN + 1.
    expect(code).toMatch(/fireRetryCall\([\s\S]{0,200}attemptN\s*\+\s*1/);
    // Inside fireRetryCall, the statusCb params must use nextAttemptN.
    expect(code).toMatch(/attemptN:\s*String\(nextAttemptN\)/);
  });

  it("retry attempt is recorded in dispatch_attempts via record_sos_dispatch_attempt", () => {
    expect(statusSrc).toMatch(/rpc\(\s*["']record_sos_dispatch_attempt["']/);
    // The channel for a retry MUST match the original fanout channel
    // (bridge_call for elite, tts_call for free/basic) — otherwise
    // the L2-B aggregate query "did the SOS reach anyone?" miscounts.
    expect(statusSrc).toMatch(/channel\s*=\s*tier\s*===\s*["']elite["']\s*\?\s*["']bridge_call["']\s*:\s*["']tts_call["']/);
  });

  it("retry skipped if SOS session is no longer active (responder already ack'd)", () => {
    const code = stripComments(statusSrc);
    // The L1-C ack contract already satisfied means no retry needed.
    // Defends against retrying after a successful resolution.
    expect(code).toMatch(/session\.status\s*&&\s*session\.status\s*!==\s*["']active["']/);
  });
});

describe("L2-E Phase 2: failure paths still reach the contact (defense in depth)", () => {
  it("if Twilio API rejects the retry, the function returns false so SMS fires", () => {
    const code = stripComments(statusSrc);
    // The return value must communicate success/failure so the caller
    // can fall through to SMS — a contact getting NEITHER call NOR sms
    // after a failed retry would be the worst-case regression.
    expect(code).toMatch(/return retryOutcome\s*===\s*["']sent["']/);
  });

  it("status `failed` (Twilio-side fault) goes straight to SMS, no retry", () => {
    const code = stripComments(statusSrc);
    // Specifically: the SMS-fire guard includes isFailed without any
    // retry-guard on it (failed != recoverable).
    expect(code).toMatch(/isFailed\s*=\s*callStatus\s*===\s*["']failed["']/);
    expect(code).toMatch(/isRecoverableNoAnswer\s*&&\s*attemptN\s*>=\s*MAX_CALL_ATTEMPTS[\s\S]{0,50}\|\|[\s\S]{0,50}isFailed/);
  });
});
