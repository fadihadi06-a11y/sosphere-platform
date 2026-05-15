// ═══════════════════════════════════════════════════════════════
// R-13 (2026-05-15) — pipeline_metrics probe classification
// ─────────────────────────────────────────────────────────────
// THE BUG R-13 CLOSED
//   Pre-R-13: sos-alert's call to record_sos_pipeline_started did NOT
//   pass p_user_id or p_is_synthetic. Every probe-triggered SOS landed
//   in sos_pipeline_metrics with user_id=NULL and is_synthetic=false,
//   polluting the dashboard. After 15 probe runs we had 15 rows that
//   looked like "real emergencies, all channels failed" — but they
//   were probes using invalid contact phones. Misleading for ops + a
//   false-alarm source.
//
// THE FIX (commit set)
//   1. authenticate() returns email alongside userId
//   2. isSyntheticCaller = email?.endsWith('@sosphere.internal')
//      (reserved domain; no real user can register there)
//   3. record_sos_pipeline_started now receives p_user_id and
//      p_is_synthetic at trigger time
//   4. Data migration 20260515000000_*.sql backfills the 15 pre-R-13
//      probe rows from is_synthetic=false to is_synthetic=true.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let sosAlert = "";
let migration = "";
let lockfile = "";

beforeAll(() => {
  sosAlert  = fs.readFileSync(path.resolve(process.cwd(), "supabase/functions/sos-alert/index.ts"), "utf8");
  migration = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260515000000_r13_pipeline_metrics_probe_classification.sql"), "utf8");
  lockfile  = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations.lock.json"), "utf8");
});

describe("R-13: sos-alert authenticate() returns email alongside userId", () => {
  it("authenticate signature includes email in return type", () => {
    expect(sosAlert).toMatch(
      /async function authenticate\([^)]*\):\s*Promise<\s*\{\s*userId:\s*string\s*\|\s*null;\s*email:\s*string\s*\|\s*null;/,
    );
  });

  it("authenticate's happy-path return includes user.email", () => {
    expect(sosAlert).toMatch(/return\s*\{\s*userId:\s*user\.id,\s*email:\s*\(user\.email[^}]+\}/);
  });
});

describe("R-13: sos-alert detects probe callers via @sosphere.internal email", () => {
  it("computes isSyntheticCaller from auth.email", () => {
    expect(sosAlert).toMatch(/const isSyntheticCaller\s*=\s*typeof auth\.email\s*===\s*["']string["']/);
    expect(sosAlert).toMatch(/auth\.email\.endsWith\(\s*["']@sosphere\.internal["']\s*\)/);
  });

  it("record_sos_pipeline_started call includes p_user_id and p_is_synthetic", () => {
    // Match the RPC call block with both new parameters.
    expect(sosAlert).toMatch(
      /supabase\.rpc\(\s*["']record_sos_pipeline_started["'][\s\S]{0,500}p_user_id:\s*authUserId[\s\S]{0,300}p_is_synthetic:\s*isSyntheticCaller/,
    );
  });
});

describe("R-13: backfill migration is well-formed + registered", () => {
  it("migration filters by @sosphere.internal emails for probe detection", () => {
    expect(migration).toMatch(/email\s+LIKE\s+['"]%@sosphere\.internal['"]/);
  });

  it("migration is idempotent (WHERE is_synthetic=false guards against re-apply)", () => {
    expect(migration).toMatch(/WHERE\s+m\.is_synthetic\s*=\s*false/i);
  });

  it("migration updates sos_pipeline_metrics is_synthetic to true", () => {
    expect(migration).toMatch(/UPDATE\s+public\.sos_pipeline_metrics[\s\S]{0,300}is_synthetic\s*=\s*true/i);
  });

  it("migration adds an updated COMMENT documenting the rule", () => {
    expect(migration).toMatch(
      /COMMENT\s+ON\s+COLUMN\s+public\.sos_pipeline_metrics\.is_synthetic[\s\S]{0,400}@sosphere\.internal/,
    );
  });

  it("migration is registered in migrations.lock.json", () => {
    expect(lockfile).toMatch(/r13_pipeline_metrics_probe_classification/);
  });
});
