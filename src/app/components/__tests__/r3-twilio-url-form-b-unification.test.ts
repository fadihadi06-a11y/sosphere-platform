// ═══════════════════════════════════════════════════════════════
// R-3 (2026-05-13) — Twilio URL form-B unification contract
// ─────────────────────────────────────────────────────────────
// SUPERSEDES the L5-SEC-3 dual-form tolerance band-aid. sos-alert
// previously built Twilio URLs as form A while Twilio Console
// (post twilio-config-fix) used form B; sos-bridge-twiml had to
// accept both with urlFormVariants. R-3 forces sos-alert + twilio-
// status to emit form B via the shared fnUrl() helper, so signature
// validation collapses to single-form.
//
// Invariants pinned:
//   1. _shared/functions-host.ts exists + exports fnUrl + functionsHost
//   2. sos-alert imports fnUrl + uses it for every Twilio-facing URL
//   3. twilio-status's fireRetryCall uses fnUrl
//   4. sos-bridge-twiml internal URLs (joinTwiml, statusCb, gatherUrl,
//      recordingCb, confStatusCb) use fnUrl
//   5. Regression: NO `${SUPA_URL}/functions/v1/(twilio-status|sos-bridge-twiml)`
//      template literal remains in Twilio-facing paths
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const READ = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

let helper       = "";
let sosAlert     = "";
let twilioStatus = "";
let bridgeTwiml  = "";

beforeAll(() => {
  helper       = READ("supabase/functions/_shared/functions-host.ts");
  sosAlert     = READ("supabase/functions/sos-alert/index.ts");
  twilioStatus = READ("supabase/functions/twilio-status/index.ts");
  bridgeTwiml  = READ("supabase/functions/sos-bridge-twiml/index.ts");
});

describe("R-3: shared functions-host helper", () => {
  it("exports functionsHost() that maps supabase.co → functions.supabase.co", () => {
    expect(helper).toMatch(/export function functionsHost\(/);
    expect(helper).toMatch(/supabase\.co/);
    expect(helper).toMatch(/functions\.supabase\.co/);
  });

  it("exports fnUrl(supabaseUrl, functionName, query?) — query params auto-encoded", () => {
    expect(helper).toMatch(/export function fnUrl\(/);
    expect(helper).toMatch(/URLSearchParams/);
  });
});

describe("R-3: sos-alert builds ALL Twilio URLs via fnUrl()", () => {
  it("imports fnUrl from _shared/functions-host", () => {
    expect(sosAlert).toMatch(/import\s*\{\s*fnUrl\s*\}\s*from\s*["']\.\.\/_shared\/functions-host\.ts["']/);
  });

  it("statusCallback URL uses fnUrl + twilio-status (NOT form A)", () => {
    expect(sosAlert).toMatch(/fnUrl\(SUPA_URL,\s*["']twilio-status["']\)/);
  });

  it("all three tier twiml URLs use fnUrl + sos-bridge-twiml", () => {
    const matches = sosAlert.match(/fnUrl\(SUPA_URL,\s*["']sos-bridge-twiml["']/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3);  // basic, elite, free
  });

  it("regression guard: no `${SUPA_URL}/functions/v1/twilio-status` form A literal", () => {
    expect(sosAlert).not.toMatch(/\$\{SUPA_URL\}\/functions\/v1\/twilio-status/);
  });

  it("regression guard: no `${SUPA_URL}/functions/v1/sos-bridge-twiml` form A literal", () => {
    expect(sosAlert).not.toMatch(/\$\{SUPA_URL\}\/functions\/v1\/sos-bridge-twiml/);
  });
});

describe("R-3: twilio-status fireRetryCall uses fnUrl", () => {
  it("imports fnUrl", () => {
    expect(twilioStatus).toMatch(/import\s*\{\s*fnUrl\s*\}\s*from\s*["']\.\.\/_shared\/functions-host\.ts["']/);
  });

  it("retry twimlUrl uses fnUrl + sos-bridge-twiml", () => {
    expect(twilioStatus).toMatch(/twimlUrl\s*=\s*fnUrl\(supaUrl,\s*["']sos-bridge-twiml["']/);
  });

  it("retry statusCb uses fnUrl + twilio-status", () => {
    expect(twilioStatus).toMatch(/statusCb\s*=\s*`\$\{fnUrl\(supaUrl,\s*["']twilio-status["']\)\}/);
  });

  it("regression guard: no form-A literals in twilio-status (excluding internal send-push-notification)", () => {
    expect(twilioStatus).not.toMatch(/\$\{supaUrl\}\/functions\/v1\/twilio-status/);
    expect(twilioStatus).not.toMatch(/\$\{supaUrl\}\/functions\/v1\/sos-bridge-twiml/);
  });
});

describe("R-3: sos-bridge-twiml internal URLs use fnUrl + signature validation single-form", () => {
  it("imports fnUrl", () => {
    expect(bridgeTwiml).toMatch(/import\s*\{\s*fnUrl\s*\}\s*from\s*["']\.\.\/_shared\/functions-host\.ts["']/);
  });

  it("joinTwiml + statusCb + gatherUrl + recordingCb + confStatusCb all use fnUrl", () => {
    expect(bridgeTwiml).toMatch(/joinTwiml\s*=\s*fnUrl\(baseUrl,\s*["']sos-bridge-twiml["']/);
    expect(bridgeTwiml).toMatch(/statusCb\s*=\s*fnUrl\(baseUrl,\s*["']twilio-status["']/);
    expect(bridgeTwiml).toMatch(/gatherUrl\s*=\s*fnUrl\(baseUrl,\s*["']sos-bridge-twiml["']/);
    expect(bridgeTwiml).toMatch(/recordingCb\s*=\s*`\$\{fnUrl\(baseUrl,\s*["']twilio-status["']/);
    expect(bridgeTwiml).toMatch(/confStatusCb\s*=\s*`\$\{fnUrl\(baseUrl,\s*["']twilio-status["']/);
  });

  it("urlFormVariants helper is REMOVED (dead band-aid)", () => {
    expect(bridgeTwiml).not.toMatch(/^function\s+urlFormVariants/m);
    expect(bridgeTwiml).not.toMatch(/urlFormVariants\s*\(/);
  });

  it("validateTwilioSignature does single canonical compute (no variant loop)", () => {
    const block = bridgeTwiml.match(/async\s+function\s+validateTwilioSignature[\s\S]+?\n\}/)![0];
    expect(block).not.toMatch(/for\s*\(/);
    expect(block).toMatch(/const\s+sig\s*=\s*await\s+computeSig\(\s*authToken\s*,\s*url\s*,\s*params\s*\)/);
  });

  it("R-3 marker comment cites the form-B unification", () => {
    expect(bridgeTwiml).toMatch(/R-3[^a-zA-Z][\s\S]{0,400}form B/);
  });
});