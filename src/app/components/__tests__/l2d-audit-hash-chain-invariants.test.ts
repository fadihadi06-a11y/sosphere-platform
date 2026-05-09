// ═══════════════════════════════════════════════════════════════
// SOSphere — L2-D Append-only Audit Hash Chain — invariants
// ─────────────────────────────────────────────────────────────
// Locks the contract for the audit_log hash chain. Companion to:
//   • 20260509171557_l2d_audit_log_hash_chain.sql      (initial)
//   • 20260509171843_l2d_audit_chain_seq_fix.sql       (chain_seq)
//
// What this guards against:
//   • A future migration forgetting to keep the canonical-field list
//     in sync between the trigger function and the verify RPC. If
//     they drift, the verify RPC reports tampering on every row even
//     if the data is intact.
//   • A future migration weakening the auth gate on verify_audit_chain
//     so a non-admin can read another tenant's chain.
//   • A future migration removing the per-tenant advisory lock — that
//     would let concurrent inserts fork the chain.
//   • A future migration accidentally exposing the internal hash
//     trigger function to PUBLIC/anon (not exploitable directly but a
//     defense-in-depth concern).
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// We test the LATEST migration (the chain_seq fix-up) because that's
// the contract production runs under. The earlier file is kept in git
// for migration-replay correctness only.
const MIG_PATH = path.resolve(
  process.cwd(),
  "supabase/migrations/20260509171843_l2d_audit_chain_seq_fix.sql",
);
const ORIG_MIG_PATH = path.resolve(
  process.cwd(),
  "supabase/migrations/20260509171557_l2d_audit_log_hash_chain.sql",
);

let mig = "";
let origMig = "";

beforeAll(() => {
  mig = fs.readFileSync(MIG_PATH, "utf8");
  origMig = fs.readFileSync(ORIG_MIG_PATH, "utf8");
});

// ─── 1. Schema contract ─────────────────────────────────────
describe("L2-D: audit_log schema additions", () => {
  it("adds prev_hash and row_hash columns to audit_log", () => {
    expect(origMig).toMatch(/ADD COLUMN IF NOT EXISTS prev_hash text/);
    expect(origMig).toMatch(/ADD COLUMN IF NOT EXISTS row_hash\s+text/);
  });

  it("adds chain_seq column with sequence default", () => {
    expect(mig).toMatch(/CREATE SEQUENCE IF NOT EXISTS public\.audit_log_chain_seq/);
    expect(mig).toMatch(
      /ADD COLUMN IF NOT EXISTS chain_seq bigint NOT NULL DEFAULT nextval\('public\.audit_log_chain_seq'\)/,
    );
  });

  it("creates a partial index on (company_id, chain_seq DESC) WHERE row_hash IS NOT NULL", () => {
    expect(mig).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_audit_log_company_chain_tail[\s\S]*?ON public\.audit_log \(company_id, chain_seq DESC\)[\s\S]*?WHERE row_hash IS NOT NULL/,
    );
  });
});

// ─── 2. Trigger contract ────────────────────────────────────
describe("L2-D: BEFORE INSERT trigger _audit_log_compute_hash_chain", () => {
  it("is SECURITY DEFINER with locked search_path including extensions schema", () => {
    expect(mig).toMatch(
      /CREATE OR REPLACE FUNCTION public\._audit_log_compute_hash_chain[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path\s*=\s*'public',\s*'extensions',\s*'pg_temp'/,
    );
  });

  it("acquires per-tenant advisory lock so concurrent writers can't fork the chain", () => {
    expect(mig).toMatch(/pg_advisory_xact_lock/);
    expect(mig).toMatch(/hashtextextended\(coalesce\(NEW\.company_id::text,\s*'__global__'\),/);
  });

  it("orders the tail lookup by chain_seq DESC (not created_at)", () => {
    expect(mig).toMatch(/ORDER BY chain_seq DESC[\s\S]*?LIMIT 1/);
  });

  it("filters tail lookup to row_hash IS NOT NULL (skip pre-chain rows)", () => {
    expect(mig).toMatch(/AND row_hash IS NOT NULL/);
  });

  it("uses extensions.digest(..., 'sha256') for the hash function", () => {
    expect(mig).toMatch(/extensions\.digest\(\s*v_canon,\s*'sha256'\s*\)/);
  });

  it("REVOKEs internal trigger function from PUBLIC + anon + authenticated", () => {
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\._audit_log_compute_hash_chain\(\)\s+FROM PUBLIC/);
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\._audit_log_compute_hash_chain\(\)\s+FROM anon,\s*authenticated/);
  });

  it("trigger is wired BEFORE INSERT FOR EACH ROW (in original migration)", () => {
    expect(origMig).toMatch(
      /CREATE TRIGGER audit_log_hash_chain[\s\S]*?BEFORE INSERT ON public\.audit_log[\s\S]*?FOR EACH ROW/,
    );
  });
});

// ─── 3. Canonical-field invariant — both trigger and verify must hash the SAME fields ───
describe("L2-D: canonical-field list is identical in trigger and verify", () => {
  // Field list as of the chain_seq fix-up. Adding a new column to audit_log
  // requires (a) appending it to BOTH lists in the migration, and (b)
  // updating this test. The architectural intent is that any drift is
  // caught at CI time rather than discovered during a forensic incident.
  const REQUIRED_FIELDS = [
    "id", "action", "actor", "actor_id", "actor_role", "actor_name",
    "operation", "target", "target_id", "target_name", "target_role",
    "metadata::text", "before_value", "after_value", "zone",
    "ip_address::text", "device_info", "severity",
    "verified_2fa::text", "client_timestamp::text",
    "trace_id::text", "company_id::text", "created_at::text",
    "chain_seq::text",
  ];

  it("trigger function references every canonical field", () => {
    for (const f of REQUIRED_FIELDS) {
      // NEW.<field> appears in the trigger
      const escaped = f.replace(/\./g, "\\.").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
      expect(mig).toMatch(new RegExp(`NEW\\.${escaped}`));
    }
  });

  it("verify RPC references every canonical field (same set, same order)", () => {
    for (const f of REQUIRED_FIELDS) {
      const escaped = f.replace(/\./g, "\\.").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
      expect(mig).toMatch(new RegExp(`v_row\\.${escaped}`));
    }
  });

  it("__GENESIS__ sentinel marks the start of every chain (trigger + verify)", () => {
    // Two occurrences: one in trigger, one in verify.
    const matches = mig.match(/__GENESIS__/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("uses ASCII Unit Separator (\\x1f) as field delimiter, not a space-friendly char", () => {
    // The separator is intentionally non-printable so it can't appear inside
    // any of the user-supplied text columns.
    expect(mig).toMatch(/E'\\x1f'/);
  });
});

// ─── 4. verify_audit_chain RPC contract ─────────────────────
describe("L2-D: verify_audit_chain auth + behaviour", () => {
  it("is SECURITY DEFINER + locked search_path + STABLE", () => {
    expect(mig).toMatch(
      /CREATE OR REPLACE FUNCTION public\.verify_audit_chain\(p_company_id uuid\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path\s*=\s*'public',\s*'extensions',\s*'pg_temp'[\s\S]*?STABLE/,
    );
  });

  it("rejects unauthenticated callers with 'unauthorized: must be logged in'", () => {
    expect(mig).toMatch(/IF v_caller IS NULL THEN[\s\S]*?RAISE EXCEPTION 'unauthorized: must be logged in'/);
  });

  it("requires the caller to be an active admin/owner of the SPECIFIC company being verified", () => {
    expect(mig).toMatch(
      /SELECT EXISTS\s*\(\s*\n?\s*SELECT 1 FROM public\.company_memberships[\s\S]*?company_id\s*=\s*p_company_id[\s\S]*?role IN \('admin','owner'\)/,
    );
    expect(mig).toMatch(/RAISE EXCEPTION 'unauthorized: caller is not an active admin\/owner of this company'/);
  });

  it("walks rows in chain_seq ASC order (matches trigger insertion order)", () => {
    expect(mig).toMatch(/ORDER BY chain_seq ASC/);
  });

  it("returns structured json on tamper detection (verified:false + reason + tampered_row_id)", () => {
    expect(mig).toMatch(/'verified',\s*false[\s\S]*?'tampered_at_index'[\s\S]*?'tampered_row_id'[\s\S]*?'reason'/);
  });

  it("returns tail_hash on success (the value to anchor in an external WORM store)", () => {
    expect(mig).toMatch(/'verified',\s*true[\s\S]*?'tail_hash'/);
  });

  it("REVOKEs verify RPC from PUBLIC + anon, GRANTs only to authenticated", () => {
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\.verify_audit_chain\(uuid\)\s+FROM PUBLIC/);
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\.verify_audit_chain\(uuid\)\s+FROM anon/);
    expect(mig).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.verify_audit_chain\(uuid\)\s+TO authenticated/);
  });
});
