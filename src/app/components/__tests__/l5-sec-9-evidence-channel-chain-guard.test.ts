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

describe("L5-SEC-9a: evidence-changes per-user channel scoping", () => {
  it("defines evidenceChannelName() that derives from getStoredUser().id", () => {
    expect(evidenceStore).toMatch(/function\s+evidenceChannelName\(\)\s*:\s*string\s*\|\s*null/);
    expect(evidenceStore).toMatch(/getStoredUser\(\)/);
    expect(evidenceStore).toMatch(/`evidence-changes:\$\{u\.id\}`/);
  });

  it("imports getStoredUser from safe-rpc", () => {
    expect(evidenceStore).toMatch(/import\s*\{[^}]*getStoredUser[^}]*\}\s+from\s+["']\.\/api\/safe-rpc["']/);
  });

  it("broadcast site uses scoped name + skips when null", () => {
    expect(evidenceStore).toMatch(
      /const\s+name\s*=\s*evidenceChannelName\(\)[\s\S]{0,200}if\s*\(\s*name\s*\)\s*\{[\s\S]{0,300}supabase\.channel\(\s*name\s*\)/,
    );
  });

  it("subscribe site uses scoped name + skips when null", () => {
    // Both call sites should reference evidenceChannelName(). Count = 2.
    const matches = evidenceStore.match(/evidenceChannelName\(\)/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("regression guard: NO supabase.channel(\"evidence-changes\") with bare name", () => {
    // The bare global channel name is gone. Acceptable variants now all
    // use template literals with the user id appended.
    expect(evidenceStore).not.toMatch(/supabase\s*\.\s*channel\(\s*["']evidence-changes["']\s*\)/);
  });

  it("L5-SEC-9 marker comment present", () => {
    expect(evidenceStore).toMatch(/L5-SEC-9[^a-zA-Z]/);
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
