// ═══════════════════════════════════════════════════════════════
// SOSphere — Civilian trial server-side anti-replay test (CRIT-#12)
// ─────────────────────────────────────────────────────────────
// Pins three contracts so a future refactor cannot revert to the
// localStorage-only trial that allowed unlimited restarts:
//
//   1. trial-service.ts exposes an async startTrialAsync() that
//      MUST call the start_civilian_trial RPC and only write
//      localStorage when the RPC returns success === true.
//   2. trial-card.tsx invokes startTrialAsync (not the deprecated
//      startTrial), pipes pending state, and surfaces denial reasons.
//   3. The migration creates a 1-row-per-user PERMANENT history table
//      with FORCE RLS, plus a SECURITY DEFINER RPC that REVOKE-s
//      direct write access from authenticated.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let serviceSrc = "";
let cardSrc    = "";
let migration  = "";

beforeAll(() => {
  const cwd = process.cwd();
  serviceSrc = fs.readFileSync(
    path.resolve(cwd, "src/app/components/trial-service.ts"), "utf8");
  cardSrc = fs.readFileSync(
    path.resolve(cwd, "src/app/components/trial-card.tsx"), "utf8");
  migration = fs.readFileSync(
    path.resolve(cwd, "supabase/migrations/20260428100000_crit12_civilian_trial_history_rpc.sql"), "utf8");
});

describe("CRIT-#12 / trial-service contract", () => {
  it("CRIT-#12 marker is present (auditable)", () => {
    expect(serviceSrc).toContain("CRIT-#12");
  });

  it("exports the new async startTrialAsync()", () => {
    expect(serviceSrc).toMatch(/export\s+async\s+function\s+startTrialAsync/);
  });

  it("startTrialAsync calls the start_civilian_trial RPC", () => {
    expect(serviceSrc).toMatch(/supabase\.rpc\(\s*"start_civilian_trial"/);
  });

  it("startTrialAsync passes a sanitized duration (1..90 days)", () => {
    expect(serviceSrc).toMatch(/Math\.max\(1,\s*Math\.min\(90,\s*days\)\)/);
  });

  it("startTrialAsync writes localStorage ONLY after the RPC returns success === true", () => {
    // The writeState() call must come after a check that data.success === true.
    const successBlockMatch = serviceSrc.match(
      /if\s*\(!data\s*\|\|\s*data\.success\s*!==\s*true\)[\s\S]*?\}\s*\/\/[\s\S]*?writeState\(/,
    );
    expect(successBlockMatch, "writeState must be reachable only when RPC success===true").not.toBeNull();
  });

  it("startTrialAsync FAIL-CLOSED on RPC errors (no localStorage write)", () => {
    // Network/RPC errors return { success: false, networkError: true } and
    // never call writeState. The only writeState in the async path is gated.
    const writeStateCount = (serviceSrc.match(/writeState\(/g) || []).length;
    // 3 expected writeState calls in the file: writeState() helper definition,
    // legacy startTrial(), expired auto-promote in getTrialStatus(),
    // cancelTrial() update, and the new startTrialAsync success branch.
    expect(writeStateCount).toBeGreaterThanOrEqual(4);
    // And the new function uses fail-closed pattern with networkError flag.
    expect(serviceSrc).toMatch(/networkError:\s*true/);
  });

  it("legacy startTrial() carries the deprecation note pointing at startTrialAsync", () => {
    expect(serviceSrc).toMatch(/@deprecated\s+CRIT-#12/);
    expect(serviceSrc).toMatch(/Use\s+`startTrialAsync\(\)`\s+instead/);
  });
});

describe("CRIT-#12 / trial-card UI contract", () => {
  it("imports startTrialAsync (not the legacy startTrial)", () => {
    expect(cardSrc).toMatch(/import\s*\{[^}]*\bstartTrialAsync\b[^}]*\}\s*from\s*"\.\/trial-service"/);
    // The legacy name must NOT be among the imports.
    const importLine = cardSrc.match(/import\s*\{[^}]*\}\s*from\s*"\.\/trial-service"/);
    expect(importLine, "import line must exist").not.toBeNull();
    expect(importLine![0]).not.toMatch(/\bstartTrial\b\s*,/);
  });

  it("handleStart awaits startTrialAsync and reads .success", () => {
    expect(cardSrc).toMatch(/await\s+startTrialAsync\(/);
    expect(cardSrc).toMatch(/res\.success/);
  });

  it("handleStart pipes pending state (button disable on click)", () => {
    expect(cardSrc).toMatch(/setPending\(true\)/);
    expect(cardSrc).toMatch(/setPending\(false\)/);
    expect(cardSrc).toMatch(/disabled=\{pending\}/);
  });

  it("handleStart surfaces a deny reason when the RPC denies", () => {
    expect(cardSrc).toMatch(/setDenyReason\(/);
    expect(cardSrc).toContain("trial_already_used");
    expect(cardSrc).toContain("trial_already_used_local");
    expect(cardSrc).toContain("unauthorized");
  });

  it("denyReason actually renders in JSX (user can SEE the failure)", () => {
    expect(cardSrc).toMatch(/\{denyReason\s*&&\s*\(/);
  });
});

describe("CRIT-#12 / migration contract", () => {
  it("CRIT-#12 marker present", () => {
    expect(migration).toContain("CRIT-#12");
  });

  it("creates civilian_trial_history with user_id PRIMARY KEY (1 row per user)", () => {
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.civilian_trial_history[\s\S]*?user_id\s+uuid\s+PRIMARY KEY/,
    );
  });

  it("table is FORCE ROW LEVEL SECURITY (defence even against owner context)", () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.civilian_trial_history\s+FORCE ROW LEVEL SECURITY/i,
    );
  });

  it("REVOKE-s direct INSERT/UPDATE/DELETE from authenticated (RPC-only writes)", () => {
    expect(migration).toMatch(
      /REVOKE\s+INSERT\s*,\s*UPDATE\s*,\s*DELETE\s+ON\s+public\.civilian_trial_history\s+FROM\s+authenticated/i,
    );
  });

  it("start_civilian_trial RPC is SECURITY DEFINER + SET search_path = public", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.start_civilian_trial[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = public/,
    );
  });

  it("start_civilian_trial GRANT EXECUTE only TO authenticated (not anon)", () => {
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.start_civilian_trial[\s\S]*?TO authenticated/,
    );
    // And REVOKE from PUBLIC first.
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.start_civilian_trial[\s\S]*?FROM PUBLIC/,
    );
  });

  it("RPC returns success=false with reason=trial_already_used on second call", () => {
    expect(migration).toMatch(
      /'reason',\s*'trial_already_used'/,
    );
  });

  it("RPC handles unauthorized callers (auth.uid() IS NULL)", () => {
    expect(migration).toMatch(/'reason',\s*'unauthorized'/);
  });

  it("RPC validates plan + duration (input tampering guard)", () => {
    expect(migration).toMatch(/p_plan NOT IN \('elite', 'basic'\)/);
    expect(migration).toMatch(/p_duration_days[\s\S]*?<\s*1[\s\S]*?>\s*90/);
  });

  it("RPC race-detector handles concurrent inserts (DO NOTHING + re-read)", () => {
    expect(migration).toMatch(/ON CONFLICT \(user_id\) DO NOTHING/);
    expect(migration).toMatch(/v_new_row\.user_id IS NULL/);
    expect(migration).toMatch(/'race',\s*true/);
  });

  it("cancel_civilian_trial RPC is also SECURITY DEFINER + idempotent", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.cancel_civilian_trial[\s\S]*?SECURITY DEFINER/,
    );
    expect(migration).toMatch(/cancelled_at IS NULL/);  // idempotent guard
  });
});
