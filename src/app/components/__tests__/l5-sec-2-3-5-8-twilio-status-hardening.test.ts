// ═══════════════════════════════════════════════════════════════
// L5-SEC-2 + L5-SEC-5 + L5-SEC-8 — twilio-status hardening
// ─────────────────────────────────────────────────────────────
// Pins the three pre-launch security review fixes applied to
// supabase/functions/twilio-status/index.ts on 2026-05-12.
// If a future edit regresses any of them, this suite fails.
//
// What we lock in:
//   • L5-SEC-2 (High): gather action requires BOTH gtok AND Twilio
//     signature. Previously signature failure was logged-but-allowed,
//     so a stolen gtok could drive escalation SMS.
//   • L5-SEC-5 (Medium): HMAC compare uses constantTimeEquals helper
//     instead of raw === to defeat per-byte timing oracle.
//   • L5-SEC-8 (Medium): 500 response body is generic + request_id,
//     never raw String(err) — closes leak of DB driver messages,
//     stack pieces, env values.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const READ = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

let edgeFn = "";

beforeAll(() => {
  edgeFn = READ("supabase/functions/twilio-status/index.ts");
});

describe("L5-SEC-2: gather action requires BOTH gtok AND signature", () => {
  it("L5-SEC-2 marker is present in the gather block comment", () => {
    expect(edgeFn).toMatch(/L5-SEC-2[^a-zA-Z]/);
    expect(edgeFn).toMatch(/strict policy/i);
  });

  it("gather block calls validateTwilioSignature AFTER verifying gtok", () => {
    // Extract the gather branch.
    const m = edgeFn.match(/if\s*\(\s*action\s*===\s*["']gather["']\s*\)[\s\S]+?else\s*\{/);
    expect(m).toBeTruthy();
    const gatherBranch = m![0];
    // gtok verify happens before twilio signature.
    const gtokIdx = gatherBranch.indexOf("verifyGatherToken");
    const sigIdx  = gatherBranch.indexOf("validateTwilioSignature");
    expect(gtokIdx).toBeGreaterThanOrEqual(0);
    expect(sigIdx).toBeGreaterThan(gtokIdx);
  });

  it("gather block REJECTS (returns 403) when signature fails — not just warns", () => {
    const m = edgeFn.match(/if\s*\(\s*action\s*===\s*["']gather["']\s*\)[\s\S]+?else\s*\{/);
    const gatherBranch = m![0];
    // Find the second `validateTwilioSignature` failure block (the
    // gather-specific one). It MUST contain a `return new Response(...403)`.
    expect(gatherBranch).toMatch(/twilioOk\s*=\s*await\s+validateTwilioSignature[\s\S]{0,200}if\s*\(\s*!twilioOk\s*\)/);
    // The if(!twilioOk) block returns 403 — NOT just warns + falls through.
    expect(gatherBranch).toMatch(/if\s*\(\s*!twilioOk\s*\)\s*\{[\s\S]{0,400}return\s+new\s+Response[\s\S]{0,200}status:\s*403/);
  });

  it("regression guard: 'gtok was OK so proceeding' text is GONE", () => {
    // The pre-fix code logged "gtok was OK so proceeding" then fell
    // through. Any return of that phrase = regression.
    expect(edgeFn).not.toMatch(/gtok was OK so proceeding/);
  });
});

describe("L5-SEC-5: constant-time HMAC compare", () => {
  it("defines constantTimeEquals helper function", () => {
    expect(edgeFn).toMatch(/function\s+constantTimeEquals\s*\(\s*a:\s*string,\s*b:\s*string\s*\)/);
    // Helper must do XOR-OR loop (the textbook constant-time pattern).
    expect(edgeFn).toMatch(/diff\s*\|=\s*a\.charCodeAt\(i\)\s*\^\s*b\.charCodeAt\(i\)/);
  });

  it("validateTwilioSignature uses constantTimeEquals, NOT raw ===", () => {
    // Locate the validate function and confirm the return uses our helper.
    const m = edgeFn.match(/async\s+function\s+validateTwilioSignature\s*\([\s\S]+?\n\}/);
    expect(m).toBeTruthy();
    const fn = m![0];
    expect(fn).toMatch(/return\s+constantTimeEquals\s*\(\s*sigB64\s*,\s*sigHeader\s*\)/);
    // Belt-and-suspenders: ensure the raw `=== sigHeader` pattern is not
    // present anywhere in validateTwilioSignature.
    expect(fn).not.toMatch(/sigB64\s*===\s*sigHeader/);
  });
});

describe("L5-SEC-8: 500 response body is generic + request_id", () => {
  it("does NOT leak raw String(err) in the 500 body", () => {
    // The TOP-LEVEL catch in serve() is the place this can leak.
    expect(edgeFn).not.toMatch(/JSON\.stringify\(\s*\{\s*error:\s*String\(\s*err\s*\)/);
  });

  it("uses 'server_error' + request_id in the 500 body", () => {
    expect(edgeFn).toMatch(/JSON\.stringify\(\s*\{\s*error:\s*["']server_error["'],\s*request_id:\s*requestId\s*\}/);
  });

  it("logs the full err to console.error with the same request_id (correlation)", () => {
    expect(edgeFn).toMatch(/const\s+requestId\s*=\s*crypto\.randomUUID\(\)/);
    expect(edgeFn).toMatch(/console\.error\([^)]*request_id=\$\{requestId\}/);
  });
});
