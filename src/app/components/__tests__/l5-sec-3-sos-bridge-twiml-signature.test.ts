// ═══════════════════════════════════════════════════════════════
// L5-SEC-3 (2026-05-12) — sos-bridge-twiml signature gate
// ─────────────────────────────────────────────────────────────
// Pre-launch security review: sos-bridge-twiml had no Twilio
// signature validation on ANY path (announce/join-user/accept).
// An attacker could:
//   * probe ?emergencyId=<real eid> on default/announce → get TwiML
//     confirming the eid exists + a freshly-signed gtok
//   * probe ?action=join-user → get TwiML revealing active conference
//   * drive ?action=accept with a leaked gtok → dial SOS owner's
//     phone into an attacker-initiated conference
//
// Fix locks in:
//   • validateTwilioSignature called BEFORE any path dispatches
//   • Both URL forms tried (sos-alert builds form A, Twilio Console
//     uses form B after twilio-config-fix)
//   • Constant-time HMAC compare (L5-SEC-5 pattern)
//   • Signature failure returns 403 deny TwiML (gtok check on accept
//     stays as defense-in-depth)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const READ = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

let edgeFn = "";

beforeAll(() => {
  edgeFn = READ("supabase/functions/sos-bridge-twiml/index.ts");
});

describe("L5-SEC-3: signature validation up-front", () => {
  it("validateTwilioSignature is called BEFORE any action branch", () => {
    // Locate the serve() body and confirm validateTwilioSignature appears
    // before any `if (action === "..."` branch.
    const serveBody = edgeFn.match(/serve\(\s*async\s*\(req[\s\S]+$/)![0];
    const sigIdx    = serveBody.indexOf("await validateTwilioSignature");
    const firstAct  = serveBody.search(/if\s*\(\s*action\s*===\s*["'][^"']+["']\s*\)/);
    expect(sigIdx).toBeGreaterThan(0);
    expect(firstAct).toBeGreaterThan(sigIdx);
  });

  it("signature failure short-circuits with denyTwiml (403)", () => {
    expect(edgeFn).toMatch(/if\s*\(\s*!sigOk\s*\)\s*\{[\s\S]{0,200}return\s+denyTwiml/);
    expect(edgeFn).toMatch(/function\s+denyTwiml[\s\S]{0,400}status:\s*403/);
  });

  it("function reads form body so POST signature includes Twilio-supplied params", () => {
    // Twilio signs URL + sorted body params. We must parse formData
    // to feed those into the signature computation.
    expect(edgeFn).toMatch(/req\.method\s*===\s*["']POST["'][\s\S]{0,200}await\s+req\.formData\(\)/);
  });

  it("L1-D Phase 3 protocol coercion present (http→https)", () => {
    expect(edgeFn).toMatch(/canonicalUrl\s*=\s*req\.url\.replace\(\/\^http:\\\/\\\/\/,\s*["']https:\/\/["']\s*\)/);
  });
});

describe("L5-SEC-3: dual URL-form tolerance (form A + form B)", () => {
  it("urlFormVariants helper tries both gateway and functions-hostname forms", () => {
    expect(edgeFn).toMatch(/function\s+urlFormVariants/);
    // form A → form B conversion regex.
    expect(edgeFn).toMatch(/supabase\\\.co\\\/functions\\\/v1[\s\S]{0,80}functions\.supabase\.co/);
    // form B → form A conversion regex.
    expect(edgeFn).toMatch(/functions\\\.supabase\\\.co[\s\S]{0,80}supabase\.co\/functions\/v1/);
  });

  it("validateTwilioSignature iterates url variants until one matches", () => {
    expect(edgeFn).toMatch(/for\s*\(\s*const\s+candidate\s+of\s+urlFormVariants/);
  });
});

describe("L5-SEC-3 + L5-SEC-5: constant-time compare", () => {
  it("defines constantTimeEquals helper (same pattern as twilio-status)", () => {
    expect(edgeFn).toMatch(/function\s+constantTimeEquals\s*\(\s*a:\s*string,\s*b:\s*string\s*\)/);
    expect(edgeFn).toMatch(/diff\s*\|=\s*a\.charCodeAt\(i\)\s*\^\s*b\.charCodeAt\(i\)/);
  });

  it("validateTwilioSignature uses constantTimeEquals, NOT raw ===", () => {
    const validateBlock = edgeFn.match(/async\s+function\s+validateTwilioSignature[\s\S]+?\n\}/)![0];
    expect(validateBlock).toMatch(/constantTimeEquals\(\s*sig\s*,\s*sigHeader\s*\)/);
    expect(validateBlock).not.toMatch(/sig\s*===\s*sigHeader/);
  });
});

describe("L5-SEC-3: defense-in-depth on action=accept", () => {
  it("accept path still verifies gtok AFTER signature validates", () => {
    // The signature gate runs FIRST (in the top-level guard). Then
    // when action === "accept", gtok is also verified — replay guard.
    const acceptBlock = edgeFn.match(/if\s*\(\s*action\s*===\s*["']accept["']\s*\)[\s\S]+?(?=\n\s*\/\/ default|\n\s*if\s*\(action|\n\}\);)/)![0];
    expect(acceptBlock).toMatch(/verifyGatherToken\s*\(\s*gtok\s*,\s*emergencyId\s*\)/);
  });

  it("gtok denial reuses the shared denyTwiml helper (no inline duplicate)", () => {
    const acceptBlock = edgeFn.match(/if\s*\(\s*action\s*===\s*["']accept["']\s*\)[\s\S]+?(?=\n\s*\/\/ default|\n\s*if\s*\(action|\n\}\);)/)![0];
    expect(acceptBlock).toMatch(/return\s+denyTwiml\(\s*corsHeaders\s*,\s*`accept:\s+gtok/);
  });
});

describe("L5-SEC-3: regression guards", () => {
  it("no path returns TwiML before signature validation runs", () => {
    // The serve() body should NOT have any early-return Response before
    // the sigOk check, except OPTIONS (CORS preflight).
    const serveBody = edgeFn.match(/serve\(\s*async\s*\(req[\s\S]+$/)![0];
    const sigCheckIdx = serveBody.indexOf("const sigOk");
    expect(sigCheckIdx).toBeGreaterThan(0);
    // Find any `return new Response` before the sigCheck.
    const beforeSig = serveBody.slice(0, sigCheckIdx);
    const earlyReturns = beforeSig.match(/return\s+new\s+Response/g) || [];
    // OPTIONS preflight is the only allowed early return.
    expect(earlyReturns.length).toBeLessThanOrEqual(1);
  });

  it("L5-SEC-3 marker comment present", () => {
    expect(edgeFn).toMatch(/L5-SEC-3[^a-zA-Z]/);
  });
});
