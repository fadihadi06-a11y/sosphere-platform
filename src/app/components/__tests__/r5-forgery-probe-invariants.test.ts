// ═══════════════════════════════════════════════════════════════
// R-5 (2026-05-13) — forgery-probe contract
// ─────────────────────────────────────────────────────────────
// Pins the runtime PoC that proves L5-SEC-1 (actor-UUID forgery
// defense) actually fires in the real-threat scenario: an
// authenticated user posting via PostgREST with a forged p_actor.
//
// The static L5-SEC-1 invariant test verifies the migration source
// matches the contract. The DB smoke tests covered postgres /
// service_role / anon paths but NOT the authenticator + auth.uid()
// path that real attackers hit. R-5 fills that gap by exercising
// the full PostgREST → JWT → log_sos_audit pipeline.
//
// This suite locks the probe shape itself, not its runtime result:
//   • Five stages (ensure_user → sign_in → rpc_call → row_missing → asserts)
//   • PROBE_SECRET bearer auth + constant-time compare
//   • Forged actor is the dead-beef UUID sentinel
//   • Four assertions check the L5-SEC-1 contract
//   • Returns 500 on pass:false so cron alerting can fire
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const READ = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

let probeSrc = "";

beforeAll(() => {
  probeSrc = READ("supabase/functions/forgery-probe/index.ts");
});

describe("R-5: forgery-probe auth + setup", () => {
  it("guards with PROBE_SECRET bearer + constant-time compare", () => {
    expect(probeSrc).toMatch(/function constantTimeEquals\s*\(/);
    expect(probeSrc).toMatch(/Deno\.env\.get\(\s*["']PROBE_SECRET["']\s*\)/);
    expect(probeSrc).toMatch(/constantTimeEquals\(\s*authHeader\s*,\s*`Bearer\s*\$\{probeSecret\}`\s*\)/);
  });

  it("fail-closed on missing/short PROBE_SECRET", () => {
    expect(probeSrc).toMatch(/probeSecret\.length\s*<\s*16/);
    expect(probeSrc).toMatch(/probe_misconfigured/);
  });
});

describe("R-5: probe-user lifecycle (Stage 1)", () => {
  it("uses a stable PROBE_USER_EMAIL constant (idempotent across runs)", () => {
    expect(probeSrc).toMatch(/PROBE_USER_EMAIL\s*=\s*["']forgery-probe@sosphere\.internal["']/);
  });

  it("refreshes password per-run via admin.updateUserById (no stale credentials)", () => {
    expect(probeSrc).toMatch(/admin\.auth\.admin\.updateUserById/);
    // 2026-06-05 R-5 hotfix: probePassword needs to satisfy the strict
    // Auth password policy (lowercase + uppercase + digits + symbols).
    // The pin allows ANY infix between the two crypto.randomUUID()
    // calls — the original `+ +`, the hotfix `+ "Aa1!" +`, or any
    // future class-coverage tweak — so long as both UUIDs are used.
    // 2026-06-05 hotfix-v2: bcrypt caps password length at 72 bytes,
    // so the probe build must stay UNDER 72. The expression must
    // include at least one crypto.randomUUID() call (for entropy),
    // the "Aa1!" literal (for class coverage), and MUST NOT use
    // two UUIDs concatenated (which would total 72-76 chars).
    expect(probeSrc).toMatch(/probePassword\s*=[^;]*crypto\.randomUUID\(\)/);
    expect(probeSrc).toMatch(/"Aa1!"|'Aa1!'/);
    // Defense-in-depth: ensure two UUIDs aren't concatenated.
    // (Tightens the contract so a future "fix" doesn't bring back
    // the 72-byte boundary failure mode.)
    const probePwLine = probeSrc.split("\n").find((l) => l.includes("probePassword"));
    expect(probePwLine).toBeDefined();
    const uuidCount = (probePwLine!.match(/crypto\.randomUUID\(\)/g) || []).length;
    expect(uuidCount).toBeLessThanOrEqual(1);
  });

  it("creates the user via admin.createUser when missing", () => {
    expect(probeSrc).toMatch(/admin\.auth\.admin\.createUser\(\s*\{[\s\S]+?email_confirm:\s*true/);
  });
});

describe("R-5: forgery attempt + assertions", () => {
  it("uses a fixed dead-beef forged UUID (recognizable in forensic logs)", () => {
    expect(probeSrc).toMatch(/FORGED_USER_ID\s*=\s*["']00000000-dead-beef-0000-000000000000["']/);
  });

  it("posts to PostgREST rpc/log_sos_audit with the probe user's JWT", () => {
    expect(probeSrc).toMatch(/\$\{supaUrl\}\/rest\/v1\/rpc\/log_sos_audit/);
    expect(probeSrc).toMatch(/Authorization:\s*`Bearer \$\{userJwt\}`/);
  });

  it("sends FORGED_USER_ID as p_actor (the threat scenario)", () => {
    expect(probeSrc).toMatch(/p_actor:\s*FORGED_USER_ID/);
  });

  it("reads the row back via service-role admin client (bypasses RLS for verification)", () => {
    expect(probeSrc).toMatch(/admin[\s\S]{0,50}\.from\(\s*["']audit_log["']\s*\)/);
  });

  it("asserts the L5-SEC-1 contract — 4 invariants", () => {
    expect(probeSrc).toMatch(/actor_pinned_to_auth_uid:\s*row\.actor === probeUserId/);
    expect(probeSrc).toMatch(/actor_is_not_forged:\s*row\.actor !== FORGED_USER_ID/);
    expect(probeSrc).toMatch(/metadata_source_is_auth_uid:[\s\S]{0,80}actor_id_source[\s\S]{0,40}["']auth_uid["']/);
    expect(probeSrc).toMatch(/metadata_records_forgery_claim:[\s\S]{0,80}actor_id_claim_overridden[\s\S]{0,40}FORGED_USER_ID/);
  });

  it("computes overall pass from EVERY assertion (no partial pass)", () => {
    expect(probeSrc).toMatch(/Object\.values\(asserts\)\.every\(\s*Boolean\s*\)/);
  });
});

describe("R-5: alerting contract (non-200 on fail)", () => {
  it("returns HTTP 500 when pass is false so cron exits non-zero", () => {
    expect(probeSrc).toMatch(/pass\s*\?\s*200\s*:\s*500/);
  });
});

describe("R-5: forensic preservation", () => {
  it("does NOT delete the audit row after verification (proof-of-defense stays in chain)", () => {
    // The probe's last DB write is the log_sos_audit RPC. No subsequent
    // delete should appear in the source.
    expect(probeSrc).not.toMatch(/\.from\(\s*["']audit_log["']\s*\)\s*\.delete/);
  });
});
