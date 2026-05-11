// ═══════════════════════════════════════════════════════════════
// SOSphere — L1-D Phase 2: Twilio config probe architectural invariants
// ─────────────────────────────────────────────────────────────
// This is the structural lock — companion to
// l1d-phase2-twilio-drift-unit.test.ts (behavior tests).
// Behavior tests assert the COMPARISON RULES are correct.
// This file asserts the SHAPE around them stays correct.
//
// What this guards against:
//   • A refactor that removes the bearer-token auth (probe becomes
//     a public DoS vector against Twilio's API)
//   • A refactor that drops the constant-time compare (timing attack
//     on PROBE_SECRET)
//   • A refactor that drops the audit_log mirror on drift (drift
//     happens but no one is alerted)
//   • A refactor that drops the structured DRIFT_DETECTED prefix
//     (log-based alerting loses its pattern hook)
//   • A refactor that uses the public Twilio URL without auth
//     (would 401 every time, probe permanently broken)
//   • A refactor that splits or duplicates the pure detectDrift
//     logic out of _shared (the unit test would silently test the
//     wrong copy)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let probeSrc = "";
let sharedSrc = "";

beforeAll(() => {
  probeSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/twilio-config-probe/index.ts"),
    "utf8",
  );
  sharedSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/_shared/twilio-config-drift.ts"),
    "utf8",
  );
});

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("L1-D Phase 2: shared pure-logic module is the single source", () => {
  it("detectDrift + normalizeUrl + types live in _shared, NOT inlined in the edge function", () => {
    // The edge function imports from _shared; it must NOT also
    // declare its own copy (would silently diverge from the
    // unit-tested copy).
    expect(probeSrc).toMatch(/from\s+["']\.\.\/_shared\/twilio-config-drift\.ts["']/);
    const codeOnly = stripComments(probeSrc);
    expect(codeOnly).not.toMatch(/^export function detectDrift\(/m);
    expect(codeOnly).not.toMatch(/^function normalizeUrl\(/m);
  });

  it("shared module exports the contract used by the test + the edge function", () => {
    expect(sharedSrc).toMatch(/export function detectDrift\(/);
    expect(sharedSrc).toMatch(/export function normalizeUrl\(/);
    expect(sharedSrc).toMatch(/export interface TwilioPhoneNumber/);
    expect(sharedSrc).toMatch(/export interface ExpectedConfig/);
    expect(sharedSrc).toMatch(/export interface DriftReport/);
  });

  it("shared module is import-free of Deno globals (Node-compatible for vitest)", () => {
    // No https://deno.land imports, no Deno.* globals — the whole
    // point of the file is to be Node-importable.
    expect(sharedSrc).not.toMatch(/from\s+["']https?:\/\//);
    expect(sharedSrc).not.toMatch(/\bDeno\./);
  });
});

describe("L1-D Phase 2: edge function — auth envelope", () => {
  it("requires Authorization: Bearer <PROBE_SECRET> header", () => {
    expect(probeSrc).toMatch(/PROBE_SECRET/);
    expect(probeSrc).toMatch(/`Bearer \$\{probeSecret\}`/);
    expect(probeSrc).toMatch(/req\.headers\.get\(\s*["']Authorization["']\s*\)/);
  });

  it("uses constant-time compare for the secret (defeats timing attacks)", () => {
    expect(probeSrc).toMatch(/constantTimeEquals\(authHeader,\s*expectedAuth\)/);
    expect(probeSrc).toMatch(/function constantTimeEquals/);
    // The implementation must XOR and accumulate, not short-circuit.
    expect(probeSrc).toMatch(/diff\s*\|=\s*a\.charCodeAt\(i\)\s*\^\s*b\.charCodeAt\(i\)/);
  });

  it("fails CLOSED when PROBE_SECRET is missing or too short", () => {
    // A missing or empty secret must NOT allow anonymous access.
    expect(probeSrc).toMatch(/probeSecret\.length\s*<\s*16/);
    expect(probeSrc).toMatch(/probe_misconfigured/);
  });

  it("rejects non-POST methods", () => {
    expect(probeSrc).toMatch(/req\.method\s*!==\s*["']POST["']/);
    expect(probeSrc).toMatch(/method_not_allowed/);
  });
});

describe("L1-D Phase 2: edge function — Twilio fetch envelope", () => {
  it("uses Basic-auth with TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN", () => {
    expect(probeSrc).toMatch(/Deno\.env\.get\(\s*["']TWILIO_ACCOUNT_SID["']\s*\)/);
    expect(probeSrc).toMatch(/Deno\.env\.get\(\s*["']TWILIO_AUTH_TOKEN["']\s*\)/);
    expect(probeSrc).toMatch(/btoa\(`\$\{twilioSid\}:\$\{twilioToken\}`\)/);
  });

  it("hits the IncomingPhoneNumbers endpoint with PageSize bounded", () => {
    expect(probeSrc).toMatch(/IncomingPhoneNumbers\.json\?PageSize=100/);
  });

  it("has a fetch timeout (Twilio API hang must NOT hang the probe)", () => {
    expect(probeSrc).toMatch(/AbortSignal\.timeout\(\s*\d+\s*\)/);
  });

  it("returns 502 on Twilio API error (distinguishes upstream fault from internal)", () => {
    const code = stripComments(probeSrc);
    expect(code).toMatch(/twilio_api_error[\s\S]{0,200}status:\s*502/);
    expect(code).toMatch(/twilio_fetch_failed[\s\S]{0,200}status:\s*502/);
  });
});

describe("L1-D Phase 2: edge function — expected config derivation", () => {
  it("derives expected sms_url from SUPABASE_URL env (single source of truth)", () => {
    expect(probeSrc).toMatch(/smsUrl:\s*`\$\{supaUrl\}\/functions\/v1\/sos-sms-inbound`/);
  });

  it("expected sms_method is hard-coded to POST", () => {
    expect(probeSrc).toMatch(/smsMethod:\s*["']POST["']/);
  });

  it("expected voice_url targets sos-bridge-twiml", () => {
    expect(probeSrc).toMatch(/voiceUrl:\s*`\$\{supaUrl\}\/functions\/v1\/sos-bridge-twiml`/);
  });
});

describe("L1-D Phase 2: drift alerting — audit_log + structured log line", () => {
  it("mirrors drift to audit_log with action=twilio_webhook_drift_detected", () => {
    expect(probeSrc).toMatch(/rpc\(\s*["']log_sos_audit["']/);
    expect(probeSrc).toMatch(/p_action:\s*["']twilio_webhook_drift_detected["']/);
    expect(probeSrc).toMatch(/p_operation:\s*["']telephony_config["']/);
  });

  it("audit metadata carries drift summary (admin can investigate from the row alone)", () => {
    const code = stripComments(probeSrc);
    for (const field of ["severity", "drifted_count", "total_phones", "expected_sms_url", "drift_summary"]) {
      expect(code).toMatch(new RegExp(`\\b${field}:`));
    }
  });

  it("emits the structured DRIFT_DETECTED prefix on stderr (log-based alert hook)", () => {
    // Supabase log-based alerting (and Sentry's log shipper, if
    // configured) pattern-match on this prefix. Keep it stable.
    expect(probeSrc).toMatch(/console\.error\(\s*["']\[twilio-config-probe\] DRIFT_DETECTED["']/);
  });

  it("emits a compact OK line on clean (distinguishes 'ran clean' from 'didn't run')", () => {
    expect(probeSrc).toMatch(/console\.log\([\s\S]{0,200}twilio-config-probe[\s\S]{0,30}OK:/);
  });

  it("audit_log mirror failure is non-fatal (probe still returns the report)", () => {
    const code = stripComments(probeSrc);
    expect(code).toMatch(/audit_log mirror failed/);
  });
});
