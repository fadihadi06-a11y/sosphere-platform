// ═══════════════════════════════════════════════════════════════
// SOSphere — Data retention cron source-pinning (CRIT-#16)
// ─────────────────────────────────────────────────────────────
// Pins the contract of supabase/migrations/20260428110000_crit16_data_retention_cron.sql
// against regression. If a future refactor:
//   • removes pg_cron enable
//   • drops a cleanup_* function
//   • shortens or lengthens TTLs without updating privacy-page.tsx
//   • removes the audit_log writer
//   • removes REVOKE EXECUTE
//   • removes SECURITY DEFINER / SET search_path
//   • drops a cron.schedule entry
// …the test fails loudly. This is the legal-compliance backstop —
// privacy-page.tsx §5 promises 90-day emergency / 30-day location
// retention; these tests prove the SQL still honors those promises.
//
// Style: pure source-pinning. Reads the migration file as text and
// checks for required substrings. No DB connection, no Deno, no
// runtime side-effects — runs cleanly in vitest under Node.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let migration  = "";
let privacyPage = "";

beforeAll(() => {
  const cwd = process.cwd();
  migration = fs.readFileSync(
    path.resolve(cwd, "supabase/migrations/20260428110000_crit16_data_retention_cron.sql"),
    "utf8",
  );
  privacyPage = fs.readFileSync(
    path.resolve(cwd, "src/app/components/privacy-page.tsx"),
    "utf8",
  );
});

// ─────────────────────────────────────────────────────────────
describe("CRIT-#16 / migration structure", () => {
  it("enables pg_cron extension", () => {
    expect(migration).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_cron/i);
  });

  it("creates the per-run audit helper log_retention_cleanup", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.log_retention_cleanup\b/,
    );
  });

  it("audit helper writes to public.audit_log with action='retention_cleanup'", () => {
    // Pin the action label so dashboards / SAR queries that filter on it
    // continue to find these rows.
    expect(migration).toMatch(/INSERT INTO public\.audit_log/);
    expect(migration).toMatch(/'retention_cleanup'/);
    expect(migration).toMatch(/'system_retention_cron'/);
  });

  it("audit helper swallows its own errors so cleanup proceeds", () => {
    // EXCEPTION WHEN OTHERS clause is required — without it, an audit
    // failure would abort the cleanup transaction.
    const helperBlock = migration.match(
      /CREATE OR REPLACE FUNCTION public\.log_retention_cleanup[\s\S]*?\$function\$;/,
    );
    expect(helperBlock).not.toBeNull();
    expect(helperBlock![0]).toMatch(/EXCEPTION WHEN OTHERS THEN/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("CRIT-#16 / 7 cleanup functions exist", () => {
  const REQUIRED_FUNCTIONS = [
    "cleanup_sos_sessions",
    "cleanup_sos_queue",
    "cleanup_sos_messages",
    "cleanup_gps_trail",
    "cleanup_evidence_vaults",
    "cleanup_processed_stripe_events",
    "cleanup_idempotency_cache",
  ] as const;

  for (const fn of REQUIRED_FUNCTIONS) {
    it(`defines public.${fn}() returning bigint`, () => {
      const re = new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${fn}\\(\\)[\\s\\S]*?RETURNS bigint`,
      );
      expect(migration).toMatch(re);
    });
  }
});

// ─────────────────────────────────────────────────────────────
describe("CRIT-#16 / TTL contract matches privacy-page.tsx §5", () => {
  it("privacy-page promises 90-day emergency-data retention", () => {
    // Arabic source-of-truth check: ensure the public promise hasn't
    // been silently weakened. If the page changes, these tests must
    // be updated to match.
    expect(privacyPage).toMatch(/90 يوم/);
  });

  it("privacy-page promises 30-day routine-location retention", () => {
    expect(privacyPage).toMatch(/30 يوم/);
  });

  it("sos_sessions cleanup uses 90 days", () => {
    const block = migration.match(
      /cleanup_sos_sessions[\s\S]*?\$function\$;/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/interval '90 days'/);
  });

  it("sos_queue cleanup uses 90 days", () => {
    const block = migration.match(
      /cleanup_sos_queue\(\)[\s\S]*?\$function\$;/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/interval '90 days'/);
  });

  it("sos_messages cleanup uses 90 days", () => {
    const block = migration.match(
      /cleanup_sos_messages\(\)[\s\S]*?\$function\$;/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/interval '90 days'/);
  });

  it("gps_trail cleanup uses 30 days (privacy-page contract)", () => {
    const block = migration.match(
      /cleanup_gps_trail\(\)[\s\S]*?\$function\$;/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/interval '30 days'/);
  });

  it("evidence_vaults cleanup uses 90 days (overrides 'permanent')", () => {
    const block = migration.match(
      /cleanup_evidence_vaults\(\)[\s\S]*?\$function\$;/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/interval '90 days'/);
  });

  it("processed_stripe_events cleanup uses 30 days", () => {
    const block = migration.match(
      /cleanup_processed_stripe_events\(\)[\s\S]*?\$function\$;/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/interval '30 days'/);
  });

  it("idempotency_cache cleanup uses expires_at < now() (no fixed TTL)", () => {
    const block = migration.match(
      /cleanup_idempotency_cache\(\)[\s\S]*?\$function\$;/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/expires_at < now\(\)/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("CRIT-#16 / preserves active in-flight rows", () => {
  it("sos_sessions cleanup filters terminal statuses only (no active SOS deletion)", () => {
    // Critical safety property: never delete rows where status indicates
    // the SOS is still in flight. The terminal-state list MUST include
    // ALL of: resolved, canceled, cancelled, ended.
    const block = migration.match(
      /cleanup_sos_sessions\(\)[\s\S]*?\$function\$;/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/'resolved'/);
    expect(block![0]).toMatch(/'canceled'/);
    expect(block![0]).toMatch(/'cancelled'/);
    expect(block![0]).toMatch(/'ended'/);
    // And critically: must not delete rows with 'active' or 'prewarm' or
    // 'escalated' status — verify by absence in the IN clause.
    const inClause = block![0].match(/status IN \([^)]*\)/);
    expect(inClause).not.toBeNull();
    expect(inClause![0]).not.toMatch(/'active'/);
    expect(inClause![0]).not.toMatch(/'prewarm'/);
    expect(inClause![0]).not.toMatch(/'escalated'/);
  });

  it("sos_queue cleanup filters terminal dispatcher statuses only", () => {
    const block = migration.match(
      /cleanup_sos_queue\(\)[\s\S]*?\$function\$;/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/'resolved'/);
    expect(block![0]).toMatch(/'reviewed'/);
    expect(block![0]).toMatch(/'broadcast'/);
    expect(block![0]).toMatch(/'forwarded'/);
    // Must not include any active-state value.
    const inClause = block![0].match(/status IN \([^)]*\)/);
    expect(inClause).not.toBeNull();
    expect(inClause![0]).not.toMatch(/'active'/);
    expect(inClause![0]).not.toMatch(/'open'/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("CRIT-#16 / security hardening on every function", () => {
  const FUNCTIONS_WITH_SEC_DEFINER = [
    "log_retention_cleanup",
    "cleanup_sos_sessions",
    "cleanup_sos_queue",
    "cleanup_sos_messages",
    "cleanup_gps_trail",
    "cleanup_evidence_vaults",
    "cleanup_processed_stripe_events",
    "cleanup_idempotency_cache",
  ] as const;

  for (const fn of FUNCTIONS_WITH_SEC_DEFINER) {
    it(`${fn} declares SECURITY DEFINER`, () => {
      const re = new RegExp(
        `FUNCTION public\\.${fn}\\b[\\s\\S]*?SECURITY DEFINER[\\s\\S]*?\\$function\\$`,
      );
      expect(migration).toMatch(re);
    });

    it(`${fn} pins search_path to public, pg_temp (G-32)`, () => {
      const re = new RegExp(
        `FUNCTION public\\.${fn}\\b[\\s\\S]*?SET search_path = public, pg_temp[\\s\\S]*?\\$function\\$`,
      );
      expect(migration).toMatch(re);
    });

    it(`${fn} REVOKEs EXECUTE from authenticated and anon`, () => {
      const re = new RegExp(
        `REVOKE EXECUTE ON FUNCTION public\\.${fn}\\b[^;]*?(authenticated|anon)`,
      );
      expect(migration).toMatch(re);
    });
  }
});

// ─────────────────────────────────────────────────────────────
describe("CRIT-#16 / cron schedule contract", () => {
  const REQUIRED_JOB_NAMES = [
    "sosphere_retention_sos_sessions",
    "sosphere_retention_sos_queue",
    "sosphere_retention_sos_messages",
    "sosphere_retention_gps_trail",
    "sosphere_retention_evidence_vaults",
    "sosphere_retention_processed_stripe_events",
    "sosphere_retention_idempotency_cache",
    "sosphere_retention_old_locations",
  ] as const;

  for (const job of REQUIRED_JOB_NAMES) {
    it(`schedules cron job '${job}'`, () => {
      expect(migration).toContain(`'${job}'`);
    });
  }

  it("uses idempotent IF EXISTS / cron.unschedule pattern", () => {
    // Without unschedule-before-reschedule, re-running the migration
    // throws a duplicate-job error.
    expect(migration).toMatch(/cron\.unschedule/);
    expect(migration).toMatch(/cron\.schedule/);
  });

  it("aliases cron.job AS cj to avoid the historical 'job' ambiguity bug", () => {
    // 2026-04-28 PostgreSQL bug: bare `cron.job` reference in a DO block
    // with a `job` loop variable is flagged as ambiguous. The alias
    // (`cron.job AS cj`) and `v_*` variable prefix prevent regression.
    expect(migration).toMatch(/FROM cron\.job AS cj/);
    expect(migration).toMatch(/v_job\b/);
    expect(migration).toMatch(/v_jobs\b/);
  });

  it("post-condition probe verifies all 8 cron jobs were created", () => {
    // The DO $$ ... RAISE EXCEPTION ... END $$ block at the bottom is
    // what makes apply_migration FAIL atomically if jobs are missing.
    expect(migration).toMatch(
      /count\(\*\)[\s\S]*?cron\.job[\s\S]*?sosphere_retention_/,
    );
    expect(migration).toMatch(/<>\s*8/);
    expect(migration).toMatch(/RAISE EXCEPTION/);
  });

  it("post-condition probe verifies all 7 cleanup_* functions exist", () => {
    expect(migration).toMatch(/<>\s*7/);
    expect(migration).toMatch(
      /'cleanup_sos_sessions'[\s\S]*?'cleanup_idempotency_cache'/,
    );
  });
});

// ─────────────────────────────────────────────────────────────
describe("CRIT-#16 / audit_log itself is NOT in the cleanup set", () => {
  it("does not define a cleanup_audit_log function", () => {
    // ISO 27001 / SOC 2 / SAR responses require indefinite audit retention.
    expect(migration).not.toMatch(/cleanup_audit_log\b/);
  });

  it("does not schedule a sosphere_retention_audit_log cron job", () => {
    expect(migration).not.toMatch(/sosphere_retention_audit_log\b/);
  });

  it("does not contain DELETE FROM public.audit_log anywhere", () => {
    expect(migration).not.toMatch(/DELETE FROM public\.audit_log\b/i);
    expect(migration).not.toMatch(/DELETE FROM audit_log\b/i);
  });
});
