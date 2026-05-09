// ═══════════════════════════════════════════════════════════════
// SOSphere — L2-H Evidence Chain-of-Custody — invariants
// ─────────────────────────────────────────────────────────────
// Locks the contract for evidence-chain-of-custody. Companions:
//   • supabase/migrations/20260509200000_l2h_evidence_chain_of_custody.sql
//   • supabase/migrations/20260509200001_l2h_evidence_chain_uuid_cast_fix.sql
//
// What this guards against:
//   • A future migration removing the `evidence.` prefix check on
//     p_event_type — would let arbitrary action strings be inserted
//     into audit_log via the more-permissive evidence RPC, bypassing
//     log_sos_audit's role-resolution logic.
//   • A future migration removing the SHA-256 hex format validator —
//     would let arbitrary strings into audit_log.metadata.file_hash
//     and break forensic verification.
//   • A future migration weakening the SECURITY DEFINER + locked
//     search_path — opens a privilege-escalation surface.
//   • A future migration overwriting the canonical evidence_event /
//     file_kind / file_hash / vault_id fields from caller-supplied
//     p_extra — caller could fabricate a successful evidence event
//     for a different vault.
//   • A future change removing the manifest jsonb column from
//     evidence_vaults — per-file hashes would lose their server-side
//     home and the chain-of-custody story collapses to a single
//     aggregate hash again.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let mig = "";
let migFix = "";

beforeAll(() => {
  mig = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260509200000_l2h_evidence_chain_of_custody.sql"),
    "utf8",
  );
  migFix = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260509200001_l2h_evidence_chain_uuid_cast_fix.sql"),
    "utf8",
  );
});

// ─── 1. Schema additions on evidence_vaults ─────────────────
describe("L2-H: evidence_vaults columns", () => {
  it("adds manifest jsonb (full EvidenceManifest)", () => {
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS manifest\s+jsonb/);
  });

  it("adds manifest_hash text (denormalized top-level hash for indexed lookups)", () => {
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS manifest_hash text/);
  });

  it("indexes manifest_hash with WHERE manifest_hash IS NOT NULL", () => {
    expect(mig).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_evidence_vaults_manifest_hash[\s\S]*?WHERE manifest_hash IS NOT NULL/,
    );
  });
});

// ─── 2. log_evidence_event contract (latest version = fix-up) ─────
describe("L2-H: log_evidence_event RPC", () => {
  it("is SECURITY DEFINER + locked search_path", () => {
    expect(migFix).toMatch(
      /CREATE OR REPLACE FUNCTION public\.log_evidence_event[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path\s*=\s*'public',\s*'pg_temp'/,
    );
  });

  it("rejects p_event_type that doesn't start with 'evidence.'", () => {
    expect(migFix).toMatch(
      /IF p_event_type IS NULL OR NOT p_event_type LIKE 'evidence\.%' THEN[\s\S]*?RAISE EXCEPTION 'log_evidence_event: p_event_type must start with evidence\./,
    );
  });

  it("rejects p_file_hash that isn't 64-char lowercase hex", () => {
    // length(p_file_hash) <> 64 AND regex check on [0-9a-f]{64}
    expect(migFix).toMatch(/length\(p_file_hash\) <> 64/);
    expect(migFix).toMatch(/p_file_hash !~ '\^\[0-9a-f\]\{64\}\$'/);
  });

  it("casts text emergency_id to uuid inside try/except (handles legacy 'EMG-XXX' format)", () => {
    expect(migFix).toMatch(/v_emerg_uuid\s*:=\s*p_emergency_id::uuid/);
    expect(migFix).toMatch(/EXCEPTION WHEN OTHERS THEN\s*\n\s*NULL;\s*--/);
  });

  it("merges p_extra UNDER the canonical evidence keys (caller can't override)", () => {
    // The order matters: COALESCE(p_extra, '{}') is FIRST, jsonb_build_object
    // (with evidence_event, file_kind, file_hash, vault_id) is SECOND.
    // jsonb concatenation lets the right side win on key collision.
    expect(migFix).toMatch(
      /COALESCE\(p_extra, '\{\}'::jsonb\)\s*\n?\s*\|\|\s*jsonb_build_object\([\s\S]*?'evidence_event',\s*true[\s\S]*?'file_kind'[\s\S]*?'file_hash'[\s\S]*?'vault_id'/,
    );
  });

  it("inserts into audit_log with category='file_access' (so L2-D trigger covers it)", () => {
    expect(migFix).toMatch(/INSERT INTO public\.audit_log[\s\S]*?'file_access'/);
  });

  it("REVOKE'd from PUBLIC + anon; GRANTed to authenticated AND service_role", () => {
    expect(migFix).toMatch(/REVOKE EXECUTE ON FUNCTION public\.log_evidence_event\(text, text, text, text, text, jsonb\)\s+FROM PUBLIC/);
    expect(migFix).toMatch(/REVOKE EXECUTE ON FUNCTION public\.log_evidence_event\(text, text, text, text, text, jsonb\)\s+FROM anon/);
    expect(migFix).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.log_evidence_event\(text, text, text, text, text, jsonb\)\s+TO authenticated/);
    expect(migFix).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.log_evidence_event\(text, text, text, text, text, jsonb\)\s+TO service_role/);
  });
});

// ─── 3. Composition with L2-D ───────────────────────────────
describe("L2-H × L2-D: evidence events flow through the hash chain", () => {
  it("the RPC inserts into audit_log (which has the L2-D BEFORE INSERT trigger) — every evidence event is automatically chained", () => {
    // Two assertions:
    //  (a) the function does an INSERT INTO public.audit_log
    //  (b) that table has the audit_log_hash_chain trigger (from L2-D migration)
    // We only need to check (a) here — (b) is locked by the L2-D test.
    expect(migFix).toMatch(/INSERT INTO public\.audit_log/);
    // Also: the row carries the file_hash in metadata, so the chain
    // hash covers it. No separate join required to prove integrity.
    expect(migFix).toMatch(/'file_hash',\s*p_file_hash/);
  });
});
