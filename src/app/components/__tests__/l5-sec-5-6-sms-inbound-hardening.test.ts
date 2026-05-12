// ═══════════════════════════════════════════════════════════════
// L5-SEC-5 + L5-SEC-6 (2026-05-12) — sos-sms-inbound hardening
// ─────────────────────────────────────────────────────────────
// Pre-launch security review fixes for sos-sms-inbound:
//   • L5-SEC-5 (Medium): HMAC compare uses constantTimeEquals helper
//     instead of raw === to defeat per-byte timing oracle.
//   • L5-SEC-6 (Medium): two information-disclosure paths closed:
//       1. SIG_MISMATCH_DEBUG no longer logs computed_sig (deterministic
//          HMAC oracle) or token_len (length oracle). Logs only
//          received_sig_prefix (correlation handle) + URL + param keys.
//       2. PROBE-* debug echo (debug_url + debug_param_keys in the 403
//          body) is now gated behind a matching X-Probe-Secret header.
//          The companion sos-inbound-probe sends this header so cron
//          probes still benefit from the diagnostic info.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const READ = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

let smsInbound = "";
let inboundProbe = "";

beforeAll(() => {
  smsInbound   = READ("supabase/functions/sos-sms-inbound/index.ts");
  inboundProbe = READ("supabase/functions/sos-inbound-probe/index.ts");
});

describe("L5-SEC-5: constant-time HMAC compare in sos-sms-inbound", () => {
  it("defines constantTimeEquals helper", () => {
    expect(smsInbound).toMatch(/function\s+constantTimeEquals\s*\(\s*a:\s*string,\s*b:\s*string\s*\)/);
    expect(smsInbound).toMatch(/diff\s*\|=\s*a\.charCodeAt\(i\)\s*\^\s*b\.charCodeAt\(i\)/);
  });

  it("uses constantTimeEquals on the HMAC compare, NOT raw ===", () => {
    expect(smsInbound).toMatch(/constantTimeEquals\s*\(\s*sigB64\s*,\s*sigHeader\s*\)/);
    expect(smsInbound).not.toMatch(/sigB64\s*===\s*sigHeader/);
  });
});

describe("L5-SEC-6: SIG_MISMATCH_DEBUG redaction", () => {
  it("does NOT log computed_sig (deterministic HMAC oracle)", () => {
    // The redacted debug block should NOT contain a computed_sig field.
    const debugBlock = smsInbound.match(/SIG_MISMATCH_DEBUG[\s\S]+?\}\)\);/)![0];
    expect(debugBlock).not.toMatch(/computed_sig/);
  });

  it("does NOT log token_len (token-length oracle)", () => {
    const debugBlock = smsInbound.match(/SIG_MISMATCH_DEBUG[\s\S]+?\}\)\);/)![0];
    expect(debugBlock).not.toMatch(/token_len/);
  });

  it("logs received_sig_prefix (truncated correlation handle, not full sig)", () => {
    expect(smsInbound).toMatch(/received_sig_prefix:\s*sigHeader\.slice\(\s*0\s*,\s*6\s*\)\s*\+\s*['"]\.\.\.['"]/);
  });

  it("L5-SEC-6 marker comment present in debug block", () => {
    expect(smsInbound).toMatch(/L5-SEC-6[^a-zA-Z]/);
  });
});

describe("L5-SEC-6: PROBE-* debug echo gated by X-Probe-Secret", () => {
  it("checks X-Probe-Secret header before considering caller a probe", () => {
    expect(smsInbound).toMatch(/X-Probe-Secret/);
    expect(smsInbound).toMatch(/probeHeader\s*=\s*req\.headers\.get\(\s*['"]X-Probe-Secret['"]\s*\)/);
  });

  it("uses constantTimeEquals to compare X-Probe-Secret with PROBE_SECRET env", () => {
    expect(smsInbound).toMatch(/constantTimeEquals\s*\(\s*probeHeader\s*,\s*probeSecret\s*\)/);
  });

  it("requires probeSecret length >= 16 (fail-closed on weak secret)", () => {
    expect(smsInbound).toMatch(/probeSecret\.length\s*>=\s*16/);
  });

  it("isProbe combines BOTH the PROBE- prefix AND the secret match (defense-in-depth)", () => {
    expect(smsInbound).toMatch(
      /isProbe\s*=\s*debugMsgSid\.startsWith\(\s*['"]PROBE-['"]\s*\)\s*[\s\S]{0,100}constantTimeEquals\(\s*probeHeader\s*,\s*probeSecret\s*\)/,
    );
  });

  it("the 403 errBody only includes debug fields when isProbe is true", () => {
    expect(smsInbound).toMatch(
      /errBody\s*=\s*isProbe\s*\?\s*\{[\s\S]{0,200}debug_url[\s\S]{0,200}debug_param_keys/,
    );
  });
});

describe("L5-SEC-6: sos-inbound-probe sends X-Probe-Secret header", () => {
  it("probe fetch includes X-Probe-Secret matching probeSecret env", () => {
    // Locate the fetch call to inboundUrl and confirm the header is present.
    const fetchBlock = inboundProbe.match(/const\s+res\s*=\s*await\s+fetch\(\s*inboundUrl[\s\S]+?\}\);/)![0];
    expect(fetchBlock).toMatch(/['"]X-Probe-Secret['"]\s*:\s*probeSecret/);
    expect(fetchBlock).toMatch(/['"]X-Twilio-Signature['"]\s*:\s*signature/);
  });

  it("L5-SEC-6 marker comment in the probe explaining the header", () => {
    expect(inboundProbe).toMatch(/L5-SEC-6[^a-zA-Z]/);
  });
});

describe("L5-SEC-6: regression guards", () => {
  it("debug echo in sos-sms-inbound 403 body NEVER fires on bare PROBE-* prefix alone", () => {
    // The bug we're fixing was: any caller setting MessageSid=PROBE-X
    // got debug info back. Confirm the gate now requires a secret.
    // We assert that the assignment to isProbe also references
    // probeHeader / constantTimeEquals — not just .startsWith("PROBE-").
    const isProbeStmt = smsInbound.match(/const\s+isProbe\s*=[\s\S]+?;/)![0];
    expect(isProbeStmt).toMatch(/probeHeader|constantTimeEquals/);
  });
});
