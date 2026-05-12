// ═══════════════════════════════════════════════════════════════
// L5-SEC-1 (2026-05-12) — audit-actor-forgery contract
// ─────────────────────────────────────────────────────────────
// Pins the L5-SEC-1 hardening in supabase/migrations/
// 20260512150000_l5_sec_1_log_sos_audit_actor_forgery.sql. If a
// future migration re-creates log_sos_audit and forgets to gate
// p_actor by caller role, this suite fails — preventing silent
// regression of the most critical pre-launch security fix.
//
// What we lock in:
//   • Authenticated callers' p_actor is REJECTED in favour of auth.uid().
//   • service_role + postgres + supabase_admin retain override capability
//     (legitimate system-attribution use cases).
//   • anon and unknown roles are rejected outright (no audit write).
//   • Metadata annotates actor_id_source so forensic analysis can
//     distinguish authenticated-pinned rows from system-attributed rows.
//   • An authenticated forgery attempt is recorded in
//     metadata.actor_id_claim_overridden for post-hoc analysis.
//   • D-15 role freshness logic is preserved.
//   • L1-A trace_id parameter is preserved.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const READ = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

let migration = "";

beforeAll(() => {
  migration = READ("supabase/migrations/20260512150000_l5_sec_1_log_sos_audit_actor_forgery.sql");
});

describe("L5-SEC-1: caller-role gating", () => {
  it("extracts caller role from request.jwt.claims at top of function", () => {
    expect(migration).toMatch(/current_setting\(\s*['"]request\.jwt\.claims['"]\s*,\s*true\s*\)::jsonb->>['"]role['"]/);
  });

  it("captures session_user for the superuser allowlist", () => {
    expect(migration).toMatch(/session_user/);
  });

  it("postgres + supabase_admin retain override capability (defense-in-depth)", () => {
    expect(migration).toMatch(/session_user\s+in\s*\(\s*['"]postgres['"]\s*,\s*['"]supabase_admin['"]\s*\)/);
  });

  it("service_role JWT retains override capability", () => {
    expect(migration).toMatch(/v_caller_role\s*=\s*['"]service_role['"]/);
  });

  it("authenticated JWT path pins actor to auth.uid()", () => {
    expect(migration).toMatch(/v_caller_role\s*=\s*['"]authenticated['"]/);
    expect(migration).toMatch(/v_actor\s*:=\s*auth\.uid\(\)::text/);
  });

  it("authenticated path raises 42501 if auth.uid() is somehow null", () => {
    expect(migration).toMatch(/auth\.uid\(\)\s+is\s+null/);
    expect(migration).toMatch(/errcode\s*=\s*['"]42501['"]/);
  });

  it("anonymous + unknown roles are rejected with insufficient_privilege", () => {
    // The final ELSE branch raises on anon / null / unknown.
    expect(migration).toMatch(/raise\s+exception\s+['"]log_sos_audit:\s+caller\s+role[^'"]*not\s+permitted/i);
  });
});

describe("L5-SEC-1: forensic annotations", () => {
  it("tags every row with actor_id_source = auth_uid | service_override | superuser_override", () => {
    // Annotation: jsonb_set(v_metadata, '{actor_id_source}', to_jsonb(v_actor_id_source), true)
    expect(migration).toMatch(/actor_id_source[^\n]*to_jsonb\s*\(\s*v_actor_id_source\s*\)/);
    expect(migration).toMatch(/['"]auth_uid['"]/);
    expect(migration).toMatch(/['"]service_override['"]/);
    expect(migration).toMatch(/['"]superuser_override['"]/);
  });

  it("records the forgery attempt in metadata.actor_id_claim_overridden", () => {
    expect(migration).toMatch(/actor_id_claim_overridden[^\n]*to_jsonb\s*\(\s*p_actor\s*\)/);
  });

  it("only records forgery claim on authenticated callers, not service_role", () => {
    // The annotation block must be gated on v_actor_id_source = 'auth_uid'.
    expect(migration).toMatch(/v_actor_id_source\s*=\s*['"]auth_uid['"]\s*[\s\S]{0,200}p_actor\s*<>\s*v_actor/);
  });
});

describe("L5-SEC-1: D-15 + L1-A preservation", () => {
  it("preserves D-15 role freshness: re-reads role from profiles", () => {
    expect(migration).toMatch(/select\s+role\s+into\s+v_fresh_role\s+from\s+public\.profiles/i);
    expect(migration).toMatch(/actor_role_source/);
  });

  it("preserves L1-A trace_id parameter + column write", () => {
    expect(migration).toMatch(/p_trace_id\s+uuid\s+default\s+null/);
    // trace_id appears in the INSERT column list AND p_trace_id appears
    // in the VALUES list, separated by some content.
    expect(migration).toMatch(/insert\s+into\s+public\.audit_log[\s\S]+trace_id[\s\S]+values[\s\S]+p_trace_id/i);
  });

  it("preserves the 9-arg signature + grant to service_role + authenticated", () => {
    expect(migration).toMatch(/grant\s+execute\s+on\s+function\s+public\.log_sos_audit\(\s*text,\s*text,\s*text,\s*text,\s*text,\s*text,\s*jsonb,\s*uuid,\s*uuid\s*\)/i);
    expect(migration).toMatch(/to\s+service_role,\s+authenticated/i);
  });
});

describe("L5-SEC-1: write semantics", () => {
  it("INSERT uses v_actor (the computed/pinned identity), NOT p_actor", () => {
    // Critical: row's `actor` column MUST be v_actor (not p_actor) — that's
    // the WHOLE point of the fix. If a future refactor swaps it back to
    // p_actor, this test catches it.
    const insertMatch = migration.match(/insert\s+into\s+public\.audit_log[\s\S]+?\$\$/i);
    expect(insertMatch).toBeTruthy();
    const insertBlock = insertMatch![0];
    // Look for the values clause and verify v_actor (not p_actor) is used
    // for the actor column.
    expect(insertBlock).toMatch(/values[\s\S]+?v_id,\s*p_action,\s*v_actor\b/);
    expect(insertBlock).not.toMatch(/values[\s\S]+?v_id,\s*p_action,\s*coalesce\(\s*p_actor/);
  });

  it("INSERT writes v_actor to both `actor` and `actor_name` columns", () => {
    // Defense-in-depth: actor_name historically mirrored p_actor; pin it
    // to v_actor too so forensic search by name can't be forged either.
    const insertMatch = migration.match(/insert\s+into\s+public\.audit_log[\s\S]+?\$\$/i)![0];
    // Count occurrences of v_actor in the VALUES list (should appear at
    // least twice: once for actor, once for actor_name).
    const valuesPart = insertMatch.match(/values[\s\S]+?\)\s*;/i)![0];
    const vActorCount = (valuesPart.match(/\bv_actor\b/g) || []).length;
    expect(vActorCount).toBeGreaterThanOrEqual(2);
  });
});

describe("L5-SEC-1: regression guardrails", () => {
  it("the migration filename matches the L5-SEC-1 convention", () => {
    // If the file is renamed without updating this test path, beforeAll
    // would have thrown — but spell it out for clarity.
    expect(migration).toContain("L5-SEC-1 (2026-05-12)");
  }
);

  it("function comment reflects the L5-SEC-1 closure", () => {
    expect(migration).toMatch(/comment\s+on\s+function\s+public\.log_sos_audit\s+is\s+['"]L5-SEC-1/i);
    expect(migration).toMatch(/closes\s+actor-UUID\s+forgery/i);
  });
});
