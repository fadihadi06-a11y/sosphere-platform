// ═══════════════════════════════════════════════════════════════
// R-2 (2026-05-13) — evidence-changes company-scoped channel
// ─────────────────────────────────────────────────────────────
// SUPERSEDES the L5-SEC-9 per-user scoping band-aid. The privacy
// model is COMPANY: same-company members observe each other's
// evidence pipeline; cross-company subscribers excluded.
//
// This suite pins:
//   • DB resolver get_my_company_id() exists with 3-tier fallback
//   • evidence-store imports the resolver via supabase.rpc
//   • Channel name is `evidence-changes:<companyId>` (NOT per-user)
//   • Module-level cache reduces RPC calls on hot path
//   • Both broadcast + subscribe sites use the company channel
//   • Regression guards: no `evidence-changes:${u.id}` per-user
//     pattern and no bare `evidence-changes` global pattern remain
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const READ = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

let migration = "";
let evidenceStore = "";

beforeAll(() => {
  migration     = READ("supabase/migrations/20260513130000_r2_get_my_company_id_resolver.sql");
  evidenceStore = READ("src/app/components/evidence-store.ts");
});

describe("R-2: DB resolver get_my_company_id()", () => {
  it("is SECURITY DEFINER + STABLE + search_path locked", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.get_my_company_id/);
    expect(migration).toMatch(/SECURITY DEFINER/);
    expect(migration).toMatch(/STABLE/);
    expect(migration).toMatch(/search_path = 'public', 'pg_temp'/);
  });

  it("returns NULL when auth.uid() is NULL (anon)", () => {
    expect(migration).toMatch(/IF v_caller IS NULL THEN RETURN NULL/);
  });

  it("Tier 1: profile.active_company_id", () => {
    expect(migration).toMatch(/SELECT active_company_id INTO v_company_id FROM public\.profiles/);
  });

  it("Tier 2: single admin/owner membership", () => {
    expect(migration).toMatch(/role IN \('owner','super_admin','admin'\)/);
  });

  it("Tier 3: single any-role membership", () => {
    // Second count(DISTINCT m.company_id) without role filter
    const blocks = migration.match(/count\(DISTINCT m\.company_id\)/g) || [];
    expect(blocks.length).toBeGreaterThanOrEqual(2);
  });

  it("granted to authenticated + service_role", () => {
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_my_company_id\(\)\s+TO authenticated,\s*service_role/);
  });
});

describe("R-2: evidence-store uses company channel via resolver", () => {
  it("calls supabase.rpc('get_my_company_id')", () => {
    expect(evidenceStore).toMatch(/supabase\.rpc\(\s*["']get_my_company_id["']\s*\)/);
  });

  it("channel name is `evidence-changes:${companyId}` (NOT user-scoped)", () => {
    expect(evidenceStore).toMatch(/`evidence-changes:\$\{data\}`/);
    // Regression: ensure the per-user template literal is gone
    expect(evidenceStore).not.toMatch(/`evidence-changes:\$\{u\.id\}`/);
  });

  it("module-level cache prevents repeated RPC on hot path", () => {
    expect(evidenceStore).toMatch(/let\s+_cachedCompanyChannel/);
    expect(evidenceStore).toMatch(/let\s+_cachedForUserId/);
  });

  it("resolveEvidenceChannelName is async and returns null on no auth", () => {
    expect(evidenceStore).toMatch(/async function resolveEvidenceChannelName\(\)\s*:\s*Promise<string\s*\|\s*null>/);
    expect(evidenceStore).toMatch(/if\s*\(!u\?\.id\)\s*\{[\s\S]{0,200}return\s+null/);
  });

  it("broadcast site awaits the resolver before sending", () => {
    expect(evidenceStore).toMatch(/resolveEvidenceChannelName\(\)\.then\([\s\S]{0,400}supabase\.channel\(name\)\.send/);
  });

  it("subscribe site awaits the resolver before subscribing", () => {
    expect(evidenceStore).toMatch(
      /resolveEvidenceChannelName\(\)\.then\([\s\S]{0,500}supabase\s*\.?\s*\n?\s*\.channel\(name\)/,
    );
  });

  it("regression guard: NO bare 'evidence-changes' global channel remains", () => {
    expect(evidenceStore).not.toMatch(/supabase\s*\.\s*channel\(\s*["']evidence-changes["']\s*\)/);
  });
});

describe("R-2: marker comments", () => {
  it("evidence-store explicitly notes it supersedes the L5-SEC-9 per-user scoping", () => {
    expect(evidenceStore).toMatch(/R-2[^a-zA-Z][\s\S]{0,400}company-scoped/i);
    expect(evidenceStore).toMatch(/Supersedes the L5-SEC-9 per-user band-aid/i);
  });

  it("migration COMMENT documents 3-tier fallback", () => {
    expect(migration).toMatch(/COMMENT ON FUNCTION public\.get_my_company_id[\s\S]+?Tier 1[\s\S]+?Tier 2[\s\S]+?Tier 3/i);
  });
});
