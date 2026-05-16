// ═══════════════════════════════════════════════════════════════
// R-19 Phase 5 (2026-05-15) — webhook self-test + ops_alerts + DPA gate
// ─────────────────────────────────────────────────────────────
// FINDINGS THIS PHASE FIXES
//
//   #12 LOW → MEDIUM — Stripe retry-budget exhaustion was invisible.
//     When stripe_unmapped_events.retry_count reaches 24, the webhook
//     returns 200 to Stripe to stop retries — but no operator-facing
//     signal was emitted. A paying customer could sit in free-tier limbo
//     over an unattended weekend. Fix: insert ops_alerts row on
//     exhaustion (severity=high, category=stripe_unmapped_price_exhausted)
//     so the operator dashboard / scheduled query picks it up.
//
//   #16 LOW → MEDIUM — DPA acceptance was only enforced at the in-app
//     start_company_trial gate. An owner with direct Stripe Dashboard
//     access could create a subscription via the Stripe API, bypassing
//     in-app DPA acceptance entirely. The webhook would write the row →
//     company starts paying for Elite while having NEVER legally
//     accepted DPA. Fix: defensive lookup of company_dpa_acceptances
//     before B2B upsert. Zero rows → block upsert + ops_alerts row.
//
//   NEW Probe — stripe-webhook-test-probe smoke-tests the webhook after
//     every deploy. Three critical paths: valid event (200), replay
//     (200 deduped), invalid signature (400). Static contract tests
//     already prove the new event handlers; this probe proves the
//     INFRASTRUCTURE (signature + dedup + default branch) still works
//     end-to-end after deploy.
//
// CONTRACT (locked by this test)
//   - ops_alerts migration has all the right columns + RLS lockdown
//   - Stripe webhook inserts ops_alerts row at retry exhaustion
//   - Stripe webhook blocks B2B upsert when no DPA acceptance
//   - DPA lookup failure fails OPEN (don't block legit B2B on DB hiccup)
//   - Self-test probe exists + structures the 3 test paths correctly
//   - Probe signs with the project's STRIPE_WEBHOOK_SECRET
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let webhookSrc = "";
let migrationSrc = "";
let probeSrc = "";

beforeAll(() => {
  webhookSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/stripe-webhook/index.ts"),
    "utf8",
  );
  migrationSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260515160000_r19p5_ops_alerts.sql"),
    "utf8",
  );
  probeSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/stripe-webhook-test-probe/index.ts"),
    "utf8",
  );
});

describe("R-19 #12: ops_alerts table + retry-exhaustion insertion", () => {
  it("migration creates ops_alerts with required columns", () => {
    expect(migrationSrc).toMatch(/CREATE TABLE IF NOT EXISTS public\.ops_alerts/);
    expect(migrationSrc).toMatch(/severity\s+text\s+NOT NULL CHECK[\s\S]{0,100}low[\s\S]{0,20}medium[\s\S]{0,20}high[\s\S]{0,20}critical/);
    expect(migrationSrc).toMatch(/source\s+text\s+NOT NULL/);
    expect(migrationSrc).toMatch(/category\s+text\s+NOT NULL/);
    expect(migrationSrc).toMatch(/metadata\s+jsonb\s+NOT NULL\s+DEFAULT/);
    expect(migrationSrc).toMatch(/acknowledged_at\s+timestamptz/);
  });

  it("migration locks the table to service_role (RLS + REVOKE)", () => {
    expect(migrationSrc).toMatch(/ALTER TABLE public\.ops_alerts ENABLE ROW LEVEL SECURITY/);
    expect(migrationSrc).toMatch(/REVOKE ALL ON public\.ops_alerts FROM PUBLIC, anon, authenticated/);
    expect(migrationSrc).toMatch(/GRANT ALL ON public\.ops_alerts TO service_role/);
  });

  it("migration indexes the two main operator queries", () => {
    // 1. "Unacknowledged alerts, newest first" — partial index
    expect(migrationSrc).toMatch(/idx_ops_alerts_pending[\s\S]{0,200}WHERE acknowledged_at IS NULL/);
    // 2. "By category, newest first"
    expect(migrationSrc).toMatch(/idx_ops_alerts_category/);
  });

  it("webhook inserts ops_alerts row when retry_count >= 24", () => {
    expect(webhookSrc).toMatch(
      /prevRetryCount\s*>=\s*24[\s\S]{0,800}\.from\(\s*["']ops_alerts["']\s*\)\.insert\(/,
    );
    expect(webhookSrc).toMatch(/category:\s*["']stripe_unmapped_price_exhausted["']/);
    expect(webhookSrc).toMatch(/severity:\s*["']high["']/);
  });

  it("ops_alerts insert failure is non-fatal (best-effort)", () => {
    // The alert insert must NOT throw out of the catch handler — if it
    // fails we just log and continue (the recovery row in
    // stripe_unmapped_events is still the durable record).
    expect(webhookSrc).toMatch(/ops_alerts insert failed[\s\S]{0,40}non-fatal/);
  });
});

describe("R-19 #16: defensive DPA enforcement on B2B upsert", () => {
  it("looks up company_dpa_acceptances before company-scoped upsert", () => {
    expect(webhookSrc).toMatch(
      /\.from\(\s*["']company_dpa_acceptances["']\s*\)[\s\S]{0,200}\.eq\(\s*["']company_id["']/,
    );
  });

  it("blocks upsert + inserts ops_alerts when zero acceptances exist", () => {
    expect(webhookSrc).toMatch(/no DPA acceptance on record/);
    expect(webhookSrc).toMatch(/category:\s*["']subscription_without_dpa["']/);
    expect(webhookSrc).toMatch(/return\s*\{\s*applied:\s*false,\s*reason:\s*["']dpa_not_accepted["']/);
  });

  it("FAILS OPEN on DPA-lookup DB error (don't block legit B2B during DB hiccup)", () => {
    // If the SELECT itself fails, we log and let the upsert proceed.
    // The webhook is best-effort defensive layering; we don't want a
    // transient DB error to BLOCK paying customers.
    expect(webhookSrc).toMatch(/DPA acceptance lookup failed[\s\S]{0,80}failing OPEN/);
  });

  it("only enforces on company-scoped upserts (target.kind === 'company')", () => {
    // ROBUST CHECK: split the source at the user-branch marker, then verify
    // the DPA lookup is in the SECOND half (company branch / else block),
    // not the first half (user branch). Immune to code expansion between
    // the two markers — which broke the previous bounded-regex check when
    // R-19 #20 expanded the user branch with explicit SELECT+INSERT logic.
    const userBranchIdx = webhookSrc.indexOf(`target.kind === "user"`);
    expect(userBranchIdx, "user-branch marker not found").toBeGreaterThan(0);
    const dpaIdx = webhookSrc.indexOf("company_dpa_acceptances");
    expect(dpaIdx, "DPA lookup not found").toBeGreaterThan(0);
    // DPA must come AFTER the user-branch marker (i.e., it's in the else branch)
    expect(dpaIdx).toBeGreaterThan(userBranchIdx);
    // And there must be an `else` keyword between them (we are in the company branch)
    const between = webhookSrc.slice(userBranchIdx, dpaIdx);
    expect(between, "no else block separates user branch from DPA check").toMatch(/}\s*else\s*\{/);
  });
});

describe("R-19 Phase 5: stripe-webhook-test-probe (smoke test after deploy)", () => {
  it("uses PROBE_SECRET bearer + constant-time compare (matches other 5 probes)", () => {
    expect(probeSrc).toMatch(/Deno\.env\.get\(\s*["']PROBE_SECRET["']/);
    expect(probeSrc).toMatch(/function\s+constantTimeEquals/);
    expect(probeSrc).toMatch(/constantTimeEquals\(authHeader,\s*`Bearer \$\{probeSecret\}`\)/);
  });

  it("signs with STRIPE_WEBHOOK_SECRET (same algorithm as real Stripe)", () => {
    expect(probeSrc).toMatch(/Deno\.env\.get\(\s*["']STRIPE_WEBHOOK_SECRET["']/);
    expect(probeSrc).toMatch(/HMAC[\s\S]{0,80}SHA-256/);
    expect(probeSrc).toMatch(/`t=\$\{timestamp\},v1=\$\{hex\}`/);
  });

  it("tests 3 critical paths: valid + replay + invalid signature", () => {
    expect(probeSrc).toMatch(/valid signature \+ ignored event/);
    expect(probeSrc).toMatch(/replay[\s\S]{0,40}deduped/);
    expect(probeSrc).toMatch(/invalid signature[\s\S]{0,40}400/);
  });

  it("cleans up its own dedup rows after the run (idempotent)", () => {
    expect(probeSrc).toMatch(
      /\.from\(\s*["']processed_stripe_events["']\s*\)\.delete\(\)/,
    );
  });

  it("returns pass:true only when ALL three tests pass", () => {
    expect(probeSrc).toMatch(/pass\s*=\s*results\.every\(\(r\)\s*=>\s*r\.pass\)/);
  });
});
