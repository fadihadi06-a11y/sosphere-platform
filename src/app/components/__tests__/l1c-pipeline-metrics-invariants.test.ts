// ═══════════════════════════════════════════════════════════════
// SOSphere — L1-C pipeline_metrics architectural invariants
// ─────────────────────────────────────────────────────────────
// Locks the contract for sos_pipeline_metrics — schema + 5 RPCs +
// idempotency patterns + RLS policies. A future refactor that drops
// any of these breaks CI before it ships.
//
// Companion to:
//   • supabase/migrations/20260508150000_l1c_sos_pipeline_metrics.sql (schema)
//   • supabase/migrations/20260508160000_l1c_pipeline_metrics_rpcs.sql (RPCs)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const READ = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

let schemaMig = "";
let rpcsMig = "";

beforeAll(() => {
  schemaMig = READ("supabase/migrations/20260508150000_l1c_sos_pipeline_metrics.sql");
  rpcsMig   = READ("supabase/migrations/20260508160000_l1c_pipeline_metrics_rpcs.sql");
});

// ─── 1. SCHEMA INVARIANTS ─────────────────────────────────────
describe("L1-C: sos_pipeline_metrics schema", () => {
  it("table is keyed on trace_id (PRIMARY KEY)", () => {
    expect(schemaMig).toMatch(/trace_id\s+uuid\s+PRIMARY KEY/);
  });

  it("captures all 5 timing markers needed for forensic timeline", () => {
    for (const col of [
      "client_claimed_at",
      "server_received_at",
      "primary_alert_dispatched_at",
      "responder_acked_at",
      "ended_at",
    ]) {
      expect(schemaMig).toContain(col);
    }
  });

  it("captures all 4 computed duration fields", () => {
    for (const col of [
      "client_to_server_ms",
      "server_to_dispatch_ms",
      "press_to_ack_ms",
      "total_session_ms",
    ]) {
      expect(schemaMig).toContain(col);
    }
  });

  it("pipeline_status has CHECK constraint with 5 valid states", () => {
    expect(schemaMig).toMatch(
      /pipeline_status[\s\S]*?CHECK[\s\S]*?'in_progress'[\s\S]*?'success'[\s\S]*?'partial'[\s\S]*?'failed'[\s\S]*?'cancelled'/,
    );
  });

  it("channel_used has CHECK constraint listing all transport types", () => {
    expect(schemaMig).toMatch(
      /channel_used[\s\S]*?CHECK[\s\S]*?'push'[\s\S]*?'sms'[\s\S]*?'voice'/,
    );
  });

  it("is_synthetic and is_drill flags both default false", () => {
    expect(schemaMig).toMatch(/is_synthetic\s+boolean\s+NOT NULL\s+DEFAULT\s+false/);
    expect(schemaMig).toMatch(/is_drill\s+boolean\s+NOT NULL\s+DEFAULT\s+false/);
  });

  it("declares 5 partial indexes for hot-path queries", () => {
    const indexCount = (schemaMig.match(/CREATE INDEX/g) ?? []).length;
    expect(indexCount).toBeGreaterThanOrEqual(5);
  });

  it("RLS is ENABLED + FORCED (deny-by-default for non-service-role)", () => {
    expect(schemaMig).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(schemaMig).toMatch(/FORCE ROW LEVEL SECURITY/);
  });

  it("two SELECT policies: self-read + company-admin-read", () => {
    expect(schemaMig).toMatch(/CREATE POLICY pipeline_metrics_self_read[\s\S]*?user_id\s*=\s*auth\.uid\(\)/);
    expect(schemaMig).toMatch(
      /CREATE POLICY pipeline_metrics_company_admin_read[\s\S]*?company_memberships[\s\S]*?role IN \('admin','owner'\)/,
    );
  });

  it("no INSERT/UPDATE/DELETE policies for authenticated (RPC-only writes)", () => {
    expect(schemaMig).not.toMatch(/CREATE POLICY[\s\S]*FOR INSERT[\s\S]*authenticated/);
    expect(schemaMig).not.toMatch(/CREATE POLICY[\s\S]*FOR UPDATE[\s\S]*authenticated/);
    expect(schemaMig).not.toMatch(/CREATE POLICY[\s\S]*FOR DELETE[\s\S]*authenticated/);
  });

  it("touch trigger maintains updated_at on every UPDATE", () => {
    expect(schemaMig).toMatch(/_sos_pipeline_metrics_touch[\s\S]*?NEW\.updated_at\s*:=\s*now\(\)/);
    expect(schemaMig).toMatch(/CREATE TRIGGER sos_pipeline_metrics_touch[\s\S]*?BEFORE UPDATE/);
  });
});

// ─── 2. RPC INVARIANTS — all 5 functions exist + are SECURITY DEFINER ──
describe("L1-C: 5 RPCs exist with locked search_path", () => {
  const RPC_NAMES = [
    "record_sos_pipeline_started",
    "record_sos_pipeline_dispatched",
    "record_sos_pipeline_acked",
    "record_sos_pipeline_escalated",
    "record_sos_pipeline_ended",
  ];

  it.each(RPC_NAMES)("%s is SECURITY DEFINER with locked search_path", (name) => {
    const re = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path\\s*=\\s*'public',\\s*'pg_temp'`,
    );
    expect(rpcsMig).toMatch(re);
  });

  it.each(RPC_NAMES)("%s is GRANTed to service_role only (not authenticated)", (name) => {
    const grantRe = new RegExp(
      `GRANT EXECUTE ON FUNCTION public\\.${name}[\\s\\S]*?TO service_role`,
    );
    expect(rpcsMig).toMatch(grantRe);
    // Negative — should NOT grant to authenticated for write RPCs
    const badGrantRe = new RegExp(
      `GRANT EXECUTE ON FUNCTION public\\.${name}[\\s\\S]*?TO authenticated`,
    );
    expect(rpcsMig).not.toMatch(badGrantRe);
  });
});

// ─── 3. IDEMPOTENCY INVARIANTS — every RPC must dedupe correctly ──
describe("L1-C: idempotency contract — every RPC safe to retry", () => {
  it("started uses ON CONFLICT DO NOTHING (insert idempotency)", () => {
    expect(rpcsMig).toMatch(
      /record_sos_pipeline_started[\s\S]*?ON CONFLICT \(trace_id\) DO NOTHING/,
    );
  });

  it("dispatched updates only when primary_alert_dispatched_at IS NULL (first wins)", () => {
    expect(rpcsMig).toMatch(
      /record_sos_pipeline_dispatched[\s\S]*?WHERE trace_id = p_trace_id\s*\n\s*AND primary_alert_dispatched_at IS NULL/,
    );
  });

  it("acked updates only when responder_acked_at IS NULL (first wins)", () => {
    expect(rpcsMig).toMatch(
      /record_sos_pipeline_acked[\s\S]*?WHERE trace_id = p_trace_id\s*\n\s*AND responder_acked_at IS NULL/,
    );
  });

  it("escalated uses GREATEST() so re-fires of same stage are no-ops", () => {
    expect(rpcsMig).toMatch(
      /record_sos_pipeline_escalated[\s\S]*?GREATEST\(watchdog_escalations,\s*p_stage\)/,
    );
  });

  it("ended updates only when pipeline_status = 'in_progress' (first end wins)", () => {
    expect(rpcsMig).toMatch(
      /record_sos_pipeline_ended[\s\S]*?WHERE trace_id = p_trace_id\s*\n\s*AND pipeline_status = 'in_progress'/,
    );
  });
});

// ─── 4. SERVER-AUTHORITATIVE COMPUTATION ──────────────────────
describe("L1-C: durations computed by Postgres, not client", () => {
  it("client_to_server_ms is computed in started RPC", () => {
    expect(rpcsMig).toMatch(
      /record_sos_pipeline_started[\s\S]*?EXTRACT\(EPOCH FROM \(v_received - p_client_claimed_at\)\)\s*\*\s*1000/,
    );
  });

  it("server_to_dispatch_ms is computed in dispatched RPC", () => {
    expect(rpcsMig).toMatch(
      /record_sos_pipeline_dispatched[\s\S]*?EXTRACT\(EPOCH FROM \(v_dispatched - server_received_at\)\)\s*\*\s*1000/,
    );
  });

  it("press_to_ack_ms is computed in acked RPC (client press → ack delta)", () => {
    expect(rpcsMig).toMatch(
      /record_sos_pipeline_acked[\s\S]*?EXTRACT\(EPOCH FROM \(v_acked - client_claimed_at\)\)\s*\*\s*1000/,
    );
  });

  it("total_session_ms is computed in ended RPC", () => {
    expect(rpcsMig).toMatch(
      /record_sos_pipeline_ended[\s\S]*?EXTRACT\(EPOCH FROM \(v_ended - client_claimed_at\)\)\s*\*\s*1000/,
    );
  });
});

// ─── 5. VALIDATION GUARDS ─────────────────────────────────────
describe("L1-C: RPC argument validation rejects invalid input", () => {
  it("escalated rejects stage outside 1..5", () => {
    expect(rpcsMig).toMatch(
      /record_sos_pipeline_escalated[\s\S]*?p_stage < 1 OR p_stage > 5[\s\S]*?RAISE EXCEPTION 'invalid escalation stage/,
    );
  });

  it("ended rejects status not in the CHECK domain", () => {
    expect(rpcsMig).toMatch(
      /record_sos_pipeline_ended[\s\S]*?p_status NOT IN \('success','partial','failed','cancelled'\)[\s\S]*?RAISE EXCEPTION 'invalid pipeline_status/,
    );
  });
});

// ─── 6. SECURITY GRANT POSTURE (REVOKE PUBLIC + anon) ─────────
describe("L1-C: write-path RPCs are NOT callable by anon", () => {
  let revokeMig = "";
  beforeAll(() => {
    revokeMig = READ("supabase/migrations/20260508170000_l1c_security_revoke_anon_from_write_rpcs.sql");
  });

  const RPCS_SR_ONLY = [
    "record_sos_pipeline_started",
    "record_sos_pipeline_dispatched",
    "record_sos_pipeline_acked",
    "record_sos_pipeline_escalated",
    "record_sos_pipeline_ended",
  ];

  it.each(RPCS_SR_ONLY)("%s revokes from PUBLIC", (rpc) => {
    const re = new RegExp("REVOKE EXECUTE ON FUNCTION public\\." + rpc + "[\\s\\S]*?FROM PUBLIC");
    expect(revokeMig).toMatch(re);
  });

  it.each(RPCS_SR_ONLY)("%s revokes from anon AND authenticated", (rpc) => {
    const re = new RegExp("REVOKE EXECUTE ON FUNCTION public\\." + rpc + "[\\s\\S]*?FROM anon, authenticated");
    expect(revokeMig).toMatch(re);
  });

  it("log_sos_audit revokes from anon (keeps authenticated)", () => {
    // Anchored within a single REVOKE statement (terminated by ';').
    expect(revokeMig).toMatch(/REVOKE EXECUTE ON FUNCTION public\.log_sos_audit\([^;]*?\)\s+FROM anon\s*;/);
    // Negative: NO REVOKE statement (single-line scoped) targets authenticated for log_sos_audit.
    expect(revokeMig).not.toMatch(/REVOKE EXECUTE ON FUNCTION public\.log_sos_audit\([^;]*?\)\s+FROM\s+anon,\s*authenticated\s*;/);
  });
});

