// ═══════════════════════════════════════════════════════════════
// SOSphere — L2-E Phase 2: voice-call retry cascade invariants
// ─────────────────────────────────────────────────────────────
// Locks the SEQUENTIAL CASCADE contract (2026-06-17): ONE call is
// ever in flight. On any "move-on" final status (no-answer / busy /
// failed / voicemail) twilio-status ADVANCES to the NEXT contact
// (contactIndex + 1, fresh attempt) — it does NOT re-dial the same
// contact, and there is no MAX_CALL_ATTEMPTS cap. SMS is the backstop
// fired only when the roster is exhausted or the SOS is resolved.
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
    // lint-guard-allow no-source-pin -- justification: Deno edge-function source-contract guard; logic is not unit-importable into vitest
    expect(alertSrc).toMatch(/L2-E Phase 2 \(2026-05-10\)/);
    // lint-guard-allow no-source-pin -- justification: Deno edge-function source-contract guard; logic is not unit-importable into vitest
    expect(alertSrc).toMatch(/free:\s*≤2× TTS announce/);
    // lint-guard-allow no-source-pin -- justification: Deno edge-function source-contract guard; logic is not unit-importable into vitest
    expect(alertSrc).toMatch(/basic:\s*≤2× TTS announce/);
    // lint-guard-allow no-source-pin -- justification: Deno edge-function source-contract guard; logic is not unit-importable into vitest
    expect(alertSrc).toMatch(/elite:\s*≤2× Bridge conference/);
  });
});

describe("SOS cascade: twilio-status advances the roster or escalates", () => {
  it("uses a sequential roster cascade — the old same-contact MAX_CALL_ATTEMPTS cap is gone", () => {
    const code = stripComments(statusSrc);
    // The Phase-2 same-contact retry cap was replaced (2026-06-17) by a
    // one-call-in-flight roster cascade: the constant must no longer exist…
    expect(statusSrc).not.toMatch(/const\s+MAX_CALL_ATTEMPTS/);
    // …and the advance must move to the NEXT contact (contactIndex + 1).
    expect(code).toMatch(/fireRetryCall\([\s\S]{0,200}contactIndex\s*\+\s*1/);
  });

  it("reads contactIndex + attemptN + tier from the statusCallback URL", () => {
    // lint-guard-allow no-source-pin -- justification: Deno edge-function source-contract guard; logic is not unit-importable into vitest
    expect(statusSrc).toMatch(/url\.searchParams\.get\(\s*["']contactIndex["']\s*\)/);
    // lint-guard-allow no-source-pin -- justification: Deno edge-function source-contract guard; logic is not unit-importable into vitest
    expect(statusSrc).toMatch(/url\.searchParams\.get\(\s*["']attemptN["']\s*\)/);
    // lint-guard-allow no-source-pin -- justification: Deno edge-function source-contract guard; logic is not unit-importable into vitest
    expect(statusSrc).toMatch(/url\.searchParams\.get\(\s*["']tier["']\s*\)/);
  });

  it("move-on set = no-answer | busy | failed | voicemail (any drives one advance)", () => {
    const code = stripComments(statusSrc);
    expect(code).toMatch(/isRecoverableNoAnswer\s*=\s*callStatus\s*===\s*["']no-answer["']\s*\|\|\s*callStatus\s*===\s*["']busy["']/);
    expect(code).toMatch(/isVoicemail\s*=\s*callStatus\s*===\s*["']completed["']\s*&&\s*answeredBy\s*===\s*["']machine_start["']/);
    expect(code).toMatch(/const\s+isMoveOn\s*=\s*isRecoverableNoAnswer\s*\|\|\s*isFailed\s*\|\|\s*isVoicemail/);
    // Advance guard: a FINAL status + move-on + a known contact index.
    expect(code).toMatch(/isFinalStatus\s*&&\s*isMoveOn\s*&&\s*callId\s*&&\s*contactIndex\s*>=\s*0/);
  });

  it("advance dials the NEXT contact (contactIndex + 1), never re-rings the same one", () => {
    const code = stripComments(statusSrc);
    expect(code).toMatch(/fireRetryCall\([\s\S]{0,200}contactIndex\s*\+\s*1/);
    // MUST NOT cap-retry the same contact via attemptN + 1 at the call site.
    expect(code).not.toMatch(/fireRetryCall\([\s\S]{0,260}attemptN\s*\+\s*1/);
    // fireRetryCall stamps the (fresh) attempt into the next statusCb URL.
    expect(code).toMatch(/attemptN:\s*String\(nextAttemptN\)/);
  });

  it("advance skips blank/undialable contacts — one bad number can't halt the cascade", () => {
    const code = stripComments(statusSrc);
    // Forward-scan to the next DIALABLE contact; SMS backstop only on true exhaustion.
    expect(code).toMatch(/let\s+dialIndex\s*=\s*contactIndex/);
    expect(code).toMatch(/while\s*\([\s\S]{0,160}isDialable\(/);
    // The dialed index (post-skip) is what the next advance continues from.
    expect(code).toMatch(/contactIndex:\s*String\(dialIndex\)/);
  });

  it("SMS escalates only when NO advance happened (!didAdvance) — no double-signal", () => {
    const code = stripComments(statusSrc);
    // SMS must not fire while an advance call is in flight; it is the
    // backstop for "roster exhausted" or "session already resolved".
    expect(code).toMatch(/shouldEscalateToSMS\s*=\s*!didAdvance\s*&&\s*isMoveOn/);
  });

  it("fireRetryCall reads tier + contact_snapshot from sos_sessions (DB is trust root)", () => {
    // lint-guard-allow no-source-pin -- justification: Deno edge-function source-contract guard; logic is not unit-importable into vitest
    expect(statusSrc).toMatch(/async function fireRetryCall\s*\(/);
    // lint-guard-allow no-source-pin -- justification: Deno edge-function source-contract guard; logic is not unit-importable into vitest
    expect(statusSrc).toMatch(/contact_snapshot/);
    // lint-guard-allow no-source-pin -- justification: Deno edge-function source-contract guard; logic is not unit-importable into vitest
    expect(statusSrc).toMatch(/from\(\s*["']sos_sessions["']\s*\)/);
  });

  it("advance is recorded in dispatch_attempts via record_sos_dispatch_attempt", () => {
    // lint-guard-allow no-source-pin -- justification: Deno edge-function source-contract guard; logic is not unit-importable into vitest
    expect(statusSrc).toMatch(/rpc\(\s*["']record_sos_dispatch_attempt["']/);
    // Channel MUST match the original fanout channel (bridge_call for elite,
    // tts_call for free/basic) or the L2-B "did the SOS reach anyone?"
    // aggregate miscounts.
    // lint-guard-allow no-source-pin -- justification: Deno edge-function source-contract guard; logic is not unit-importable into vitest
    expect(statusSrc).toMatch(/channel\s*=\s*tier\s*===\s*["']elite["']\s*\?\s*["']bridge_call["']\s*:\s*["']tts_call["']/);
  });

  it("advance skipped if the SOS session is no longer active (responder already ackd)", () => {
    const code = stripComments(statusSrc);
    expect(code).toMatch(/session\.status\s*&&\s*session\.status\s*!==\s*["']active["']/);
  });
});

describe("SOS cascade: failure paths still reach the contact (defense in depth)", () => {
  it("if Twilio API rejects the advance, fireRetryCall returns false so SMS fires", () => {
    const code = stripComments(statusSrc);
    // A contact getting NEITHER a call NOR an SMS after a failed advance
    // would be the worst-case regression — the return value must signal it.
    expect(code).toMatch(/return retryOutcome\s*===\s*["']sent["']/);
  });

  it("status `failed` is a move-on: advance to next contact, SMS only if roster exhausted", () => {
    const code = stripComments(statusSrc);
    expect(code).toMatch(/isFailed\s*=\s*callStatus\s*===\s*["']failed["']/);
    expect(code).toMatch(/const\s+isMoveOn\s*=\s*isRecoverableNoAnswer\s*\|\|\s*isFailed\s*\|\|\s*isVoicemail/);
    expect(code).toMatch(/shouldEscalateToSMS\s*=\s*!didAdvance\s*&&\s*isMoveOn/);
  });
});
