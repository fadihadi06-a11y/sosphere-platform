// ═══════════════════════════════════════════════════════════════
// SOSphere — L2-B SOS Dispatch Attempts Ledger — invariants
// ─────────────────────────────────────────────────────────────
// Locks the contract for the per-channel dispatch ledger introduced
// by 20260509190000_l2b_sos_dispatch_attempts.sql.
//
// What this guards against:
//   • A future migration loosening the channel/outcome CHECK
//     constraints — would let arbitrary string values into the ledger
//     and silently break the get_sos_delivery_summary aggregator.
//   • A future migration removing the per-tenant RLS read policy —
//     would expose every tenant's dispatch failures to every other
//     tenant's admin.
//   • A future migration exposing the writer RPC to authenticated
//     callers — would let a logged-in user fabricate SOS delivery
//     records.
//   • A future migration breaking the idempotency guard on
//     update_sos_dispatch_attempt_outcome — would let Twilio's "send
//     three identical statusCallbacks" behaviour double-count a
//     successful delivery as 3 successes.
//   • A future migration relaxing the SECURITY DEFINER + locked
//     search_path on any of the RPCs — exposes a privilege-escalation
//     surface.
//   • A future migration weakening the auth gate on
//     get_sos_delivery_summary — would let a worker read another
//     tenant's emergency or admin tools see emergencies they don't
//     manage.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let mig = "";

beforeAll(() => {
  mig = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260509190000_l2b_sos_dispatch_attempts.sql"),
    "utf8",
  );
});

// ─── 1. Schema contract ────────────────────────────────────
describe("L2-B: sos_dispatch_attempts table shape", () => {
  it("creates the table with the canonical channel set", () => {
    expect(mig).toMatch(
      /CHECK \(channel IN \('push','sms','tts_call','bridge_call','conference','voice','email'\)\)/,
    );
  });

  it("creates the table with the canonical outcome set", () => {
    expect(mig).toMatch(
      /CHECK \(outcome IN \('sent','failed','breaker_open','invalid','timeout','skipped','delivered','undelivered'\)\)/,
    );
  });

  it("constrains breaker_state to NULL or one of the L2-A states", () => {
    expect(mig).toMatch(
      /CHECK \(breaker_state IS NULL OR breaker_state IN \('closed','open','half_open'\)\)/,
    );
  });

  it("indexes the failure-mode partial index for ops dashboards", () => {
    expect(mig).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_dispatch_attempts_failure[\s\S]*?WHERE outcome IN \('failed','breaker_open','timeout','undelivered'\)/,
    );
  });
});

// ─── 2. RLS contract ───────────────────────────────────────
describe("L2-B: RLS policies — append-only + per-tenant read", () => {
  it("ENABLEs + FORCEs RLS", () => {
    expect(mig).toMatch(/ALTER TABLE public\.sos_dispatch_attempts ENABLE ROW LEVEL SECURITY/);
    expect(mig).toMatch(/ALTER TABLE public\.sos_dispatch_attempts FORCE ROW LEVEL SECURITY/);
  });

  it("authenticated users can read their own SOS attempts (self_read policy)", () => {
    expect(mig).toMatch(
      /CREATE POLICY dispatch_attempts_self_read[\s\S]*?USING \(user_id = auth\.uid\(\)\)/,
    );
  });

  it("admins/owners can read company-scoped rows (company_admin_read policy)", () => {
    expect(mig).toMatch(
      /CREATE POLICY dispatch_attempts_company_admin_read[\s\S]*?role IN \('admin','owner'\)/,
    );
  });

  it("does NOT grant INSERT/UPDATE/DELETE to authenticated — service_role only writes", () => {
    // Only SELECT goes to authenticated; ALL goes to service_role.
    expect(mig).toMatch(/GRANT SELECT ON public\.sos_dispatch_attempts TO authenticated/);
    expect(mig).toMatch(/GRANT\s+ALL\s+ON public\.sos_dispatch_attempts TO service_role/);
    // Negative assertion: no INSERT policy for authenticated.
    expect(mig).not.toMatch(/CREATE POLICY[\s\S]*?FOR INSERT[\s\S]*?TO authenticated/);
    expect(mig).not.toMatch(/CREATE POLICY[\s\S]*?FOR UPDATE[\s\S]*?TO authenticated/);
    expect(mig).not.toMatch(/CREATE POLICY[\s\S]*?FOR DELETE[\s\S]*?TO authenticated/);
  });
});

// ─── 3. Writer RPC contract ────────────────────────────────
describe("L2-B: record_sos_dispatch_attempt", () => {
  it("is SECURITY DEFINER + locked search_path", () => {
    expect(mig).toMatch(
      /CREATE OR REPLACE FUNCTION public\.record_sos_dispatch_attempt[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path\s*=\s*'public',\s*'pg_temp'/,
    );
  });

  it("REVOKE'd from PUBLIC + anon + authenticated; service_role only", () => {
    expect(mig).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.record_sos_dispatch_attempt\([\s\S]*?\)\s+FROM PUBLIC/,
    );
    expect(mig).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.record_sos_dispatch_attempt\([\s\S]*?\)\s+FROM anon, authenticated/,
    );
    expect(mig).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.record_sos_dispatch_attempt\([\s\S]*?\)\s+TO service_role/,
    );
  });
});

// ─── 4. Final-state writeback RPC contract ─────────────────
describe("L2-B: update_sos_dispatch_attempt_outcome — idempotent writeback", () => {
  it("filters on completed_at IS NULL — second callback is a no-op", () => {
    expect(mig).toMatch(/WHERE provider_sid = p_provider_sid[\s\S]*?AND completed_at IS NULL/);
  });

  it("rejects empty/null provider_sid (defensive — Twilio always sends one)", () => {
    expect(mig).toMatch(
      /IF p_provider_sid IS NULL OR length\(p_provider_sid\) = 0 THEN[\s\S]*?RETURN 0/,
    );
  });

  it("computes duration_ms from attempted_at to completed_at, never negative", () => {
    expect(mig).toMatch(
      /duration_ms\s*=\s*GREATEST\(0,\s*EXTRACT\(EPOCH FROM \(now\(\) - attempted_at\)\)::int \* 1000\)/,
    );
  });

  it("REVOKE'd from PUBLIC + anon + authenticated; service_role only", () => {
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\.update_sos_dispatch_attempt_outcome\(text, text, text\)\s+FROM PUBLIC/);
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\.update_sos_dispatch_attempt_outcome\(text, text, text\)\s+FROM anon, authenticated/);
    expect(mig).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.update_sos_dispatch_attempt_outcome\(text, text, text\)\s+TO service_role/);
  });
});

// ─── 5. Read-side aggregator contract ──────────────────────
describe("L2-B: get_sos_delivery_summary", () => {
  it("is SECURITY DEFINER + locked search_path + STABLE", () => {
    expect(mig).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_sos_delivery_summary\(p_emergency_id text\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path\s*=\s*'public',\s*'pg_temp'[\s\S]*?STABLE/,
    );
  });

  it("rejects unauthenticated callers with 'unauthorized: must be logged in'", () => {
    expect(mig).toMatch(/IF v_caller IS NULL THEN[\s\S]*?RAISE EXCEPTION 'unauthorized: must be logged in'/);
  });

  it("authorizes (a) SOS owner OR (b) active admin/owner of the company", () => {
    // Owner check
    expect(mig).toMatch(/IF v_session\.user_id = v_caller THEN[\s\S]*?v_authorized := true/);
    // Admin/owner check
    expect(mig).toMatch(
      /v_session\.company_id IS NOT NULL AND EXISTS \([\s\S]*?role IN \('admin','owner'\)[\s\S]*?v_authorized := true/,
    );
    expect(mig).toMatch(
      /RAISE EXCEPTION 'unauthorized: caller is neither the SOS owner nor an admin\/owner of the company'/,
    );
  });

  it("classifies 'sent' AND 'delivered' as successful channels (Twilio queues then delivers)", () => {
    // Both states must count as success for the per-contact reach computation.
    expect(mig).toMatch(/FILTER \(WHERE outcome IN \('sent','delivered'\)\)/);
  });

  it("returns the canonical jsonb shape (reached_any, total_contacts, contacts[])", () => {
    expect(mig).toMatch(/'reached_any',\s*COALESCE\(v_reached_any/);
    expect(mig).toMatch(/'all_contacts_reached'/);
    expect(mig).toMatch(/'total_contacts'/);
    expect(mig).toMatch(/'reached_contacts'/);
    expect(mig).toMatch(/'contacts',\s*COALESCE\(v_contacts, '\[\]'::jsonb\)/);
  });

  it("REVOKE'd from PUBLIC + anon, GRANTed to authenticated (auth gate is internal)", () => {
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_sos_delivery_summary\(text\)\s+FROM PUBLIC/);
    expect(mig).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_sos_delivery_summary\(text\)\s+FROM anon/);
    expect(mig).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.get_sos_delivery_summary\(text\)\s+TO authenticated/);
  });
});
