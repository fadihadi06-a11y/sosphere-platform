// ═══════════════════════════════════════════════════════════════
// L5-SEC-9 (2026-05-12) — evidence-changes per-user scope +
//                          verify_audit_chain post-cutoff NULL guard
// ─────────────────────────────────────────────────────────────
// Pre-launch security review (Low severity, two findings bundled):
//
// L5-SEC-9a: evidence-changes global Realtime channel
//   evidence-store.ts broadcast/subscribed to a bare global channel
//   name 'evidence-changes'. Any authenticated subscriber could
//   observe other users' evidence activity timing + IDs (no PHI in
//   the payload but enumeration + activity-timing was leaked).
//   Fix: scope channel name to evidence-changes:<auth.uid()> via a
//   small evidenceChannelName() helper. Skip broadcast + subscribe
//   when no session — localStorage path still handles same-browser
//   sync.
//
// L5-SEC-9b: verify_audit_chain silently skipped NULL row_hash rows
//   The function iterated only `row_hash IS NOT NULL` rows, letting
//   a service_role attacker (or future trigger-bypass bug) hide a
//   backdated row by setting row_hash=NULL.
//   Fix: pre-iteration guard returns verified:false if any row with
//   created_at >= 2026-05-09 has row_hash IS NULL.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const READ = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

let evidenceStore = "";
let migration = "";

beforeAll(() => {
  evidenceStore = READ("src/app/components/evidence-store.ts");
  migration     = READ("supabase/migrations/20260512190000_l5_sec_9_verify_chain_legacy_null_guard.sql");
});

describe("L5-SEC-9a: evidence-changes scoped channel (post-R-2: company-scoped)", () => {
  it("defines resolveEvidenceChannelName() that resolves company via DB RPC", () => {
    // R-2 superseded the L5-SEC-9 per-user helper with an async
    // company-scoped resolver. The contract here is that ONE of the
    // two helpers exists: post-R-2 it's resolveEvidenceChannelName.
    expect(evidenceStore).toMatch(
      /async function resolveEvidenceChannelName\(\)\s*:\s*Promise<string\s*\|\s*null>/,
    );
    expect(evidenceStore).toMatch(/supabase\.rpc\(\s*["']get_my_company_id["']\s*\)/);
  });

  it("imports getStoredUser from safe-rpc", () => {
    expect(evidenceStore).toMatch(/import\s*\{[^}]*getStoredUser[^}]*\}\s+from\s+["']\.\/api\/safe-rpc["']/);
  });

  it("broadcast + subscribe sites await the company-scoped resolver", () => {
    // Both call sites should reference resolveEvidenceChannelName().
    const matches = evidenceStore.match(/resolveEvidenceChannelName\(\)/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("regression guard: NO bare supabase.channel('evidence-changes') with global name", () => {
    expect(evidenceStore).not.toMatch(/supabase\s*\.\s*channel\(\s*["']evidence-changes["']\s*\)/);
  });

  it("regression guard: NO per-user `evidence-changes:${u.id}` template (R-2 superseded)", () => {
    expect(evidenceStore).not.toMatch(/`evidence-changes:\$\{u\.id\}`/);
  });

  it("L5-SEC-9 / R-2 marker comments present", () => {
    expect(evidenceStore).toMatch(/(L5-SEC-9|R-2)[^a-zA-Z]/);
    expect(evidenceStore).toMatch(/`evidence-changes:\$\{data\}`/);
  });
});

describe("L5-SEC-9b: verify_audit_chain pre-iteration NULL guard", () => {
  it("declares v_legacy_cutoff = 2026-05-09 (the L2-D chain install date)", () => {
    expect(migration).toMatch(/v_legacy_cutoff\s+timestamptz\s*:=\s*'2026-05-09[^']*'/);
  });

  it("counts post-cutoff rows with row_hash IS NULL BEFORE iterating", () => {
    expect(migration).toMatch(
      /SELECT\s+count\(\*\)\s+INTO\s+v_post_cutoff_null[\s\S]{0,400}row_hash\s+IS\s+NULL/i,
    );
  });

  it("returns verified:false with reason='post_cutoff_null_hash_row_present' if count > 0", () => {
    expect(migration).toMatch(/v_post_cutoff_null\s*>\s*0/);
    expect(migration).toMatch(/['"]post_cutoff_null_hash_row_present['"]/);
    expect(migration).toMatch(/['"]verified['"]\s*,\s*false/);
  });

  it("retains the per-row hash + prev_hash chain checks (no regression)", () => {
    expect(migration).toMatch(/prev_hash\s+mismatch/i);
    expect(migration).toMatch(/row_hash\s+mismatch/i);
  });

  it("preserves SECDEF + caller-admin guard (auth.uid() + company_memberships check)", () => {
    expect(migration).toMatch(/SECURITY DEFINER/);
    expect(migration).toMatch(/v_caller\s+uuid\s*:=\s*auth\.uid\(\)/);
    expect(migration).toMatch(/company_memberships[\s\S]{0,200}role IN \('admin','owner'\)/);
  });


  it("L5-SEC-9b marker comment present in migration + function COMMENT", () => {
    expect(migration).toMatch(/L5-SEC-9b[^a-zA-Z]/);
    expect(migration).toMatch(/COMMENT ON FUNCTION public\.verify_audit_chain[\s\S]+?L5-SEC-9b/);
  });
});
