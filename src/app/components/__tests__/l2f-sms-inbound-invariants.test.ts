// ═══════════════════════════════════════════════════════════════
// SOSphere — L2-F: inbound SMS reply handling invariants
// ─────────────────────────────────────────────────────────────
// Locks the contract that a contact's reply to the alert SMS
// becomes a structured event the user can see in real-time and
// that the audit chain captures every inbound message.
//
// Per L2-F design: when a contact replies during an active SOS,
//   1. Twilio inbound POST is signature-validated
//   2. The reply is logged to sos_sms_replies (idempotent on
//      MessageSid)
//   3. Mirrored to audit_log with action `sms_reply` or
//      `sms_reply_ack`
//   4. If the reply matches an ack keyword → record_sos_pipeline_acked
//      fires (L1-C SLA-critical metric)
//   5. The reply is broadcast on the same tenant-scoped channel
//      sos-alert uses (`sos-live:<companyId>` or
//      `sos-live:civilian:<userId>`) with event `sms_reply`
//
// What this guards against:
//   • A refactor accidentally auto-replying on the SOS line
//     (would create a feedback loop)
//   • A refactor dropping the Twilio signature check
//   • A refactor changing the channel scoping back to global
//     `sos-live` (cross-tenant PHI leak — same regression as W3-3)
//   • A refactor breaking the ack keyword allowlist (each
//     keyword is load-bearing for the L1-C SLA dashboard)
//   • A refactor dropping idempotency — a Twilio retry on the
//     same MessageSid would inflate ack counts
//   • A refactor removing the unmatched-phone audit row — we
//     need to see EVERY inbound to the Twilio number for
//     security review
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let inboundSrc = "";
let migrationSrc = "";

beforeAll(() => {
  inboundSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/sos-sms-inbound/index.ts"),
    "utf8",
  );
  migrationSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260510210000_l2f_sos_sms_replies.sql"),
    "utf8",
  );
});

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("L2-F: sos_sms_replies migration shape", () => {
  it("table is created with required columns", () => {
    expect(migrationSrc).toMatch(/CREATE TABLE IF NOT EXISTS public\.sos_sms_replies/);
    for (const col of [
      "emergency_id",
      "trace_id",
      "company_id",
      "user_id",
      "contact_index",
      "contact_name",
      "from_phone",
      "to_phone",
      "message_sid",
      "body",
      "is_ack",
      "ack_keyword",
      "received_at",
    ]) {
      expect(migrationSrc).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it("message_sid has a UNIQUE constraint (idempotency root)", () => {
    expect(migrationSrc).toMatch(/CREATE UNIQUE INDEX[^\n]*sos_sms_replies[\s\S]{0,200}message_sid/);
  });

  it("RLS is enabled + FORCEd, with admin and self read policies", () => {
    expect(migrationSrc).toMatch(/ALTER TABLE public\.sos_sms_replies ENABLE ROW LEVEL SECURITY/);
    expect(migrationSrc).toMatch(/ALTER TABLE public\.sos_sms_replies FORCE ROW LEVEL SECURITY/);
    expect(migrationSrc).toMatch(/CREATE POLICY sms_replies_company_admin_read/);
    expect(migrationSrc).toMatch(/CREATE POLICY sms_replies_self_read/);
  });

  it("record_sos_sms_reply RPC is SECURITY DEFINER with locked search_path and ON CONFLICT idempotency", () => {
    expect(migrationSrc).toMatch(/CREATE OR REPLACE FUNCTION public\.record_sos_sms_reply/);
    expect(migrationSrc).toMatch(/SECURITY DEFINER/);
    expect(migrationSrc).toMatch(/SET search_path\s*=\s*['"]public['"]/);
    expect(migrationSrc).toMatch(/ON CONFLICT\s*\(\s*message_sid\s*\)\s*DO UPDATE/);
  });

  it("RPC is service_role-only (revoked from public + anon + authenticated)", () => {
    expect(migrationSrc).toMatch(/REVOKE EXECUTE ON FUNCTION public\.record_sos_sms_reply[\s\S]{0,500}FROM PUBLIC/);
    expect(migrationSrc).toMatch(/REVOKE EXECUTE ON FUNCTION public\.record_sos_sms_reply[\s\S]{0,500}FROM anon, authenticated/);
    expect(migrationSrc).toMatch(/GRANT  EXECUTE ON FUNCTION public\.record_sos_sms_reply[\s\S]{0,500}TO service_role/);
  });
});

describe("L2-F: sos-sms-inbound edge function — security envelope", () => {
  it("validates Twilio signature on every inbound (fail-closed)", () => {
    const code = stripComments(inboundSrc);
    expect(code).toMatch(/async function validateTwilioSignature/);
    // The handler must REJECT (403) if signature is invalid.
    expect(code).toMatch(/if \(!valid\)\s*\{[\s\S]{0,200}status:\s*403/);
    // Fail closed: missing TWILIO_AUTH_TOKEN returns false (rejects).
    expect(code).toMatch(/TWILIO_AUTH_TOKEN missing[\s\S]{0,200}return false/);
  });

  it("never auto-replies on the SOS line (empty TwiML only)", () => {
    // The only TwiML this endpoint produces must be the empty Response.
    // Any <Say> / <Sms> / <Message> tag here would create a feedback
    // loop with the contact's phone.
    expect(inboundSrc).not.toMatch(/<Say\b/);
    expect(inboundSrc).not.toMatch(/<Sms\b/);
    expect(inboundSrc).not.toMatch(/<Message\b/);
    expect(inboundSrc).toMatch(/<Response><\/Response>/);
  });

  it("malformed inbound returns 200 + empty TwiML (not 4xx) to stop retry storms", () => {
    const code = stripComments(inboundSrc);
    // The missing-fields branch must return the same empty TwiML, NOT
    // throw or return 4xx — Twilio would re-fire the same payload.
    expect(code).toMatch(/missing required fields[\s\S]{0,200}return new Response\(emptyTwiml/);
  });

  it("unhandled error returns 200 + empty TwiML (avoid 5xx retry storms)", () => {
    const code = stripComments(inboundSrc);
    expect(code).toMatch(/catch \(err\)[\s\S]{0,400}return new Response\(emptyTwiml/);
  });
});

describe("L2-F: ack-keyword detection — frozen allowlist", () => {
  it("declares an ACK_KEYWORDS array with English + Arabic keywords", () => {
    expect(inboundSrc).toMatch(/ACK_KEYWORDS:\s*Array</);
    // Each of these MUST appear as a keyword label. Removing one here
    // breaks the L1-C ack pipeline for that linguistic path.
    for (const k of [
      "ON MY WAY",
      "EN ROUTE",
      "911 CALLED",
      "CALLED 911",
      "AMBULANCE",
      "POLICE",
      "COMING",
      "OMW",
      "911",
      "OK",
      "OKAY",
      "YES",
      "GOT IT",
      "AR_OK",
      "AR_OK_2",
      "AR_COMING",
      "AR_EN_ROUTE",
      "AR_POLICE",
      "AR_AMBULANCE",
    ]) {
      expect(inboundSrc).toMatch(new RegExp(`keyword:\\s*["']${k}["']`));
    }
  });

  it("exports detectAck so the test can exercise the function shape", () => {
    expect(inboundSrc).toMatch(/export function detectAck/);
    expect(inboundSrc).toMatch(/return \{\s*isAck:\s*(true|false)/);
  });

  it("ack detection is case-insensitive (regex flag /i)", () => {
    // Every English regex must have the /i flag. Arabic ones use /u
    // for Unicode property matching. A grep for /\b[a-z][^/]*\/[^iuy]
    // would be brittle; instead spot-check that every regex contains
    // either 'i' or 'u' in its flags.
    const matches = inboundSrc.match(/pattern:\s*\/[^\n]+?\/[a-z]+/g) || [];
    expect(matches.length).toBeGreaterThan(10);
    for (const m of matches) {
      // /…/i  /…/u  /…/iu  etc.
      expect(m).toMatch(/\/[a-z]*(?:i|u)[a-z]*$/);
    }
  });
});

describe("L2-F: session resolution + ledger writes", () => {
  it("resolveSessionByFromPhone matches against contact_snapshot (not profiles)", () => {
    const code = stripComments(inboundSrc);
    expect(code).toMatch(/resolveSessionByFromPhone/);
    expect(code).toMatch(/contact_snapshot/);
    // Critical: we match `phone`, not user_id / profile email. The
    // contact_snapshot is the frozen-at-fanout-time trust root.
    expect(code).toMatch(/snap\[i\]\?\.phone/);
  });

  it("active-session window is bounded (last 1 hour) — no resolving to stale rows", () => {
    expect(inboundSrc).toMatch(/60\s*\*\s*60\s*\*\s*1000/);
    expect(inboundSrc).toMatch(/\.gte\(\s*["']started_at["']\s*,\s*oneHourAgo/);
    expect(inboundSrc).toMatch(/\.eq\(\s*["']status["']\s*,\s*["']active["']/);
  });

  it("unmatched-phone replies are still logged (security audit covers everything)", () => {
    const code = stripComments(inboundSrc);
    // The emergency_id fallback for an unmatched reply must be a
    // stable marker, not null/undefined (would violate the NOT NULL
    // constraint in the migration).
    expect(code).toMatch(/UNMATCHED-\$\{fromPhone\}/);
    expect(code).toMatch(/record_sos_sms_reply/);
  });

  it("L1-C pipeline_acked is called only on positive ack from a matched contact", () => {
    const code = stripComments(inboundSrc);
    // The ack pipeline fires only when both `ack.isAck` AND a
    // resolved traceId are present.
    expect(code).toMatch(/if \(ack\.isAck && resolved\?\.traceId\)[\s\S]{0,200}record_sos_pipeline_acked/);
  });

  it("audit_log mirror action distinguishes ack vs plain reply", () => {
    const code = stripComments(inboundSrc);
    expect(code).toMatch(/p_action:\s*ack\.isAck\s*\?\s*["']sms_reply_ack["']\s*:\s*["']sms_reply["']/);
  });
});

describe("L2-F: Realtime broadcast — tenant-scoped, never global", () => {
  it("broadcast channel matches sos-alert tenant-scoping pattern", () => {
    const code = stripComments(inboundSrc);
    // B2B path: sos-live:<companyId>
    expect(code).toMatch(/`sos-live:\$\{resolved\.companyId\}`/);
    // Civilian path: sos-live:civilian:<userId>
    expect(code).toMatch(/`sos-live:civilian:\$\{resolved\.userId\}`/);
    // Anti-regression: must NEVER use a bare `sos-live` channel (PHI leak).
    expect(code).not.toMatch(/channel\(\s*["']sos-live["']\s*\)/);
  });

  it("broadcast event name is 'sms_reply' (dedicated, distinct from sos_triggered)", () => {
    expect(inboundSrc).toMatch(/event:\s*["']sms_reply["']/);
  });

  it("broadcast payload includes the fields the dashboard needs", () => {
    for (const field of [
      "emergencyId",
      "contactIndex",
      "contactName",
      "fromPhone",
      "body",
      "isAck",
      "ackKeyword",
      "messageSid",
    ]) {
      expect(inboundSrc).toMatch(new RegExp(`\\b${field}:\\s*`));
    }
  });

  it("broadcast skipped when no session resolved (don't spam tenant channels)", () => {
    const code = stripComments(inboundSrc);
    // The broadcast call site must be gated on `if (resolved)`.
    expect(code).toMatch(/if \(resolved\)\s*\{[\s\S]{0,200}broadcastSmsReply/);
  });
});
