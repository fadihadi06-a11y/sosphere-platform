// ═══════════════════════════════════════════════════════════════
// SOSphere — L1-D Phase 3: sos-inbound-probe architectural invariants
// ─────────────────────────────────────────────────────────────
// Companion to l1d-phase3-twilio-signature-unit.test.ts (behavior).
// Locks the SHAPE of the synthetic-inbound-SMS probe:
//   - bearer-token auth identical to twilio-config-probe
//   - signature computed from the SHARED module (no inline dup)
//   - marker SID prefix is "PROBE-" so cleanup + dashboard filters
//     can distinguish synthetic from real
//   - cleanup DELETE always runs (verify pass OR fail)
//   - alerting on PIPELINE_BROKEN mirrors to audit_log
//
// Guards against:
//   - A refactor that uses a real Twilio SM-prefixed sid (would
//     pollute real reporting + risk colliding with live inbound)
//   - A refactor that skips cleanup (every probe run leaves a row)
//   - A refactor that inlines computeTwilioSignature (unit test
//     covers only the _shared copy)
//   - A refactor that drops the verify-poll loop (false-pass when
//     the row write is slower than expected)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let probeSrc = "";
let sigSrc = "";

beforeAll(() => {
  probeSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/sos-inbound-probe/index.ts"),
    "utf8",
  );
  sigSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/_shared/twilio-signature.ts"),
    "utf8",
  );
});

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("L1-D Phase 3: shared signature module is the single source", () => {
  it("exports computeTwilioSignature + encodeFormBody", () => {
    expect(sigSrc).toMatch(/export async function computeTwilioSignature\(/);
    expect(sigSrc).toMatch(/export function encodeFormBody\(/);
  });

  it("shared module is Node-compatible (no Deno globals, no https:// imports)", () => {
    expect(sigSrc).not.toMatch(/from\s+["']https?:\/\//);
    expect(sigSrc).not.toMatch(/\bDeno\./);
  });

  it("uses HMAC-SHA1 (per Twilio spec — NOT SHA-256)", () => {
    expect(sigSrc).toMatch(/name:\s*["']HMAC["']/);
    expect(sigSrc).toMatch(/hash:\s*["']SHA-1["']/);
  });

  it("sorts param keys alphabetically (signing-order contract)", () => {
    const code = stripComments(sigSrc);
    expect(code).toMatch(/Object\.keys\(params\)\.sort\(\)/);
  });

  it("base64-encodes via btoa (matches Twilio's encoding)", () => {
    expect(sigSrc).toMatch(/btoa\(String\.fromCharCode\(\.\.\.new Uint8Array/);
  });

  it("probe edge function imports from _shared (NOT inlines a copy)", () => {
    expect(probeSrc).toMatch(/from\s+["']\.\.\/_shared\/twilio-signature\.ts["']/);
    const code = stripComments(probeSrc);
    expect(code).not.toMatch(/^export async function computeTwilioSignature\(/m);
  });
});

describe("L1-D Phase 3: probe — auth + req envelope", () => {
  it("requires Authorization: Bearer <PROBE_SECRET>", () => {
    expect(probeSrc).toMatch(/PROBE_SECRET/);
    expect(probeSrc).toMatch(/`Bearer \$\{probeSecret\}`/);
  });

  it("uses constant-time compare (no timing-attack)", () => {
    expect(probeSrc).toMatch(/function constantTimeEquals/);
    expect(probeSrc).toMatch(/diff\s*\|=/);
  });

  it("fails closed when PROBE_SECRET is missing or short", () => {
    expect(probeSrc).toMatch(/probeSecret\.length\s*<\s*16/);
    expect(probeSrc).toMatch(/probe_misconfigured/);
  });

  it("rejects non-POST methods", () => {
    expect(probeSrc).toMatch(/req\.method\s*!==\s*["']POST["']/);
  });
});

describe("L1-D Phase 3: synthetic payload + signature", () => {
  it("marker sid uses 'PROBE-' prefix (NOT Twilio's SM- prefix)", () => {
    // The prefix is load-bearing: real Twilio inbound always
    // starts with "SM"; this prefix lets cleanup + dashboard
    // filters distinguish synthetic from real without ambiguity.
    expect(probeSrc).toMatch(/`PROBE-\$\{Date\.now\(\)\}-\$\{Math\.random\(\)/);
  });

  it("synthetic From uses a reserved test number (no real-customer collision)", () => {
    expect(probeSrc).toMatch(/SYNTHETIC_FROM\s*=\s*["']\+15555550100["']/);
  });

  it("signature is computed for the SAME params posted as form body", () => {
    const code = stripComments(probeSrc);
    // params object is signed AND encoded for the body — they MUST
    // be the same object reference, or the signature won't validate.
    expect(code).toMatch(/computeTwilioSignature\(authToken,\s*inboundUrl,\s*params\)/);
    expect(code).toMatch(/encodeFormBody\(params\)/);
  });

  it("posts to the functions.supabase.co/sos-sms-inbound hostname (matches req.url inside the handler)", () => {
    // L1-D Phase 3 fix: req.url inside the function shows the
    // functions.supabase.co form, not supabase.co/functions/v1.
    // The probe must POST to AND sign for that form.
    expect(probeSrc).toMatch(/functions\.supabase\.co/);
    expect(probeSrc).toMatch(/`\$\{functionsHost\}\/sos-sms-inbound`/);
  });

  it("sends X-Twilio-Signature header on the POST (so handler validates pass)", () => {
    expect(probeSrc).toMatch(/"X-Twilio-Signature":\s*signature/);
  });

  it("Content-Type is application/x-www-form-urlencoded (matches Twilio)", () => {
    expect(probeSrc).toMatch(/"Content-Type":\s*"application\/x-www-form-urlencoded"/);
  });

  it("POST has a fetch timeout (handler hang must not hang the probe)", () => {
    expect(probeSrc).toMatch(/AbortSignal\.timeout\(\s*\d+\s*\)/);
  });
});

describe("L1-D Phase 3: verify + cleanup contract", () => {
  it("polls sos_sms_replies for the probe row (deadline-bound)", () => {
    const code = stripComments(probeSrc);
    expect(code).toMatch(/from\(\s*["']sos_sms_replies["']\s*\)[\s\S]{0,200}\.eq\(\s*["']message_sid["']\s*,\s*probeMessageSid\s*\)/);
    expect(code).toMatch(/while\s*\(Date\.now\(\)\s*<\s*verifyDeadline\)/);
  });

  it("verify timeout + poll interval are named constants (no magic numbers)", () => {
    expect(probeSrc).toMatch(/VERIFY_TIMEOUT_MS\s*=\s*\d+/);
    expect(probeSrc).toMatch(/VERIFY_POLL_INTERVAL_MS\s*=\s*\d+/);
  });

  it("ALWAYS runs cleanup DELETE — regardless of verify pass/fail", () => {
    const code = stripComments(probeSrc);
    // The DELETE must be OUTSIDE any verify-success branch — every
    // probe run must clean up its own row to prevent buildup.
    expect(code).toMatch(/\.from\(\s*["']sos_sms_replies["']\s*\)\s*\.delete\(\)\s*\.eq\(\s*["']message_sid["']\s*,\s*probeMessageSid\s*\)/);
  });

  it("uses service_role key for cleanup (bypasses RLS — table has no DELETE policy)", () => {
    const code = stripComments(probeSrc);
    expect(code).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(code).toMatch(/createClient\(supaUrl,\s*supaKey\)/);
  });
});

describe("L1-D Phase 3: alerting + report shape", () => {
  it("structured PIPELINE_BROKEN log line on fail (alert-rule contract)", () => {
    expect(probeSrc).toMatch(/console\.error\(\s*["']\[sos-inbound-probe\] PIPELINE_BROKEN["']/);
  });

  it("compact OK log line on pass (liveness contract)", () => {
    expect(probeSrc).toMatch(/console\.log\([\s\S]{0,200}sos-inbound-probe[\s\S]{0,30}OK:/);
  });

  it("mirrors fail to audit_log with action sos_inbound_pipeline_broken", () => {
    expect(probeSrc).toMatch(/p_action:\s*["']sos_inbound_pipeline_broken["']/);
    expect(probeSrc).toMatch(/p_operation:\s*["']telephony_health["']/);
  });

  it("report exposes per-stage breakdown (forge / post / verify / cleanup)", () => {
    for (const stage of ["forge", "post", "verify", "cleanup"]) {
      expect(probeSrc).toMatch(new RegExp(`\\b${stage}:\\s*`));
    }
  });

  it("audit_log mirror failure is non-fatal (probe still returns report)", () => {
    const code = stripComments(probeSrc);
    expect(code).toMatch(/audit_log mirror failed/);
  });
});

describe("L1-D Phase 3: HTTP→HTTPS canonicalization (production bug fix)", () => {
  // Why this matters: Supabase's gateway terminates TLS and forwards
  // plain HTTP to the function container, so req.url's protocol is
  // "http:" internally. Twilio signs the webhook URL as configured
  // (always "https:"). Without coercion, real Twilio inbound traffic
  // would fail signature validation 100% of the time. This bug was
  // present from day one — only discovered when the Phase 3 synthetic
  // probe attempted end-to-end verification and got HTTP 403.
  let smsInboundSrc = "";
  let twilioStatusSrc = "";
  beforeAll(() => {
    smsInboundSrc = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/functions/sos-sms-inbound/index.ts"),
      "utf8",
    );
    twilioStatusSrc = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/functions/twilio-status/index.ts"),
      "utf8",
    );
  });

  it("sos-sms-inbound coerces req.url http:// to https:// before signature validation", () => {
    expect(smsInboundSrc).toMatch(/canonicalUrl\s*=\s*req\.url\.replace\(\/\^http:\\\/\\\/\/,\s*["']https:\/\/["']\s*\)/);
    expect(smsInboundSrc).toMatch(/validateTwilioSignature\(\s*req,\s*canonicalUrl,/);
  });

  it("twilio-status coerces req.url http:// to https:// before signature validation", () => {
    expect(twilioStatusSrc).toMatch(/canonicalUrl\s*=\s*req\.url\.replace\(\/\^http:\\\/\\\/\/,\s*["']https:\/\/["']\s*\)/);
    const callMatches = twilioStatusSrc.match(/validateTwilioSignature\(\s*req,\s*canonicalUrl,/g) || [];
    expect(callMatches.length).toBeGreaterThanOrEqual(2);
    expect(twilioStatusSrc).not.toMatch(/validateTwilioSignature\(\s*req,\s*req\.url,/);
  });
});

describe("L1-D Phase 3: Supabase config", () => {
  let cfgSrc = "";
  beforeAll(() => {
    cfgSrc = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/config.toml"),
      "utf8",
    );
  });
  it("sos-inbound-probe has verify_jwt = false", () => {
    expect(cfgSrc).toMatch(/\[functions\.sos-inbound-probe\][\s\S]{0,80}verify_jwt\s*=\s*false/);
  });
});
