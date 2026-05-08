// ═══════════════════════════════════════════════════════════════
// SOSphere — L1 OBSERVABILITY architectural invariants
// ─────────────────────────────────────────────────────────────
// Locks in the contracts established by the L1 observability work
// (trace_id + client_claimed_at + server_received_at). A future
// refactor that drops any of these breaks CI before it ships.
//
// Pinned contracts:
//   1. CLIENT-SIDE TRIGGER — sos-server-trigger.ts generates a
//      trace_id (UUID) AND a client_claimed_at (ISO string) at the
//      top of triggerServerSOS(), then propagates both through
//      fetchSOS() to the edge function.
//   2. HTTP HEADER — fetchSOS() sets the X-SOS-Trace-Id header
//      from the trace_id.
//   3. EDGE FUNCTION RECEIPT — sos-alert/index.ts reads
//      X-SOS-Trace-Id (or body fallback), captures
//      server_received_at = new Date().toISOString(), and persists
//      all three to sos_sessions (insert path AND update path).
//   4. MIGRATION — the 2026-05-08 L1 migration adds the three
//      columns to sos_sessions and trace_id to audit_log.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const READ = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

let trigger = "";
let edgeFn  = "";
let migration = "";

beforeAll(() => {
  trigger   = READ("src/app/components/sos-server-trigger.ts");
  edgeFn    = READ("supabase/functions/sos-alert/index.ts");
  migration = READ("supabase/migrations/20260508130000_l1_observability_trace_id_timestamps.sql");
});

describe("L1-A: client-side trace_id generation + propagation", () => {
  it("triggerServerSOS generates a trace_id (UUID v4 or fallback)", () => {
    expect(trigger).toMatch(/const\s+traceId\s*=/);
    expect(trigger).toMatch(/crypto\.randomUUID\(\)/);
  });

  it("triggerServerSOS captures clientClaimedAt at button-press time", () => {
    expect(trigger).toMatch(/const\s+clientClaimedAt\s*=/);
    expect(trigger).toMatch(/new\s+Date\(\)\.toISOString\(\)/);
  });

  it("triggerServerSOS passes traceId + clientClaimedAt in the trigger body", () => {
    // The body sent to fetchSOS must include both fields so the server
    // can persist them on first row write.
    expect(trigger).toMatch(/traceId,/);
    expect(trigger).toMatch(/clientClaimedAt,/);
  });

  it("fetchSOS accepts traceId in opts and sets X-SOS-Trace-Id header", () => {
    expect(trigger).toMatch(/traceId\?\s*:\s*string/);
    expect(trigger).toMatch(/headers\["X-SOS-Trace-Id"\]\s*=\s*opts\.traceId/);
  });
});

describe("L1-A/B: server-side reception + persistence", () => {
  it("sos-alert reads the X-SOS-Trace-Id header (with body fallback)", () => {
    expect(edgeFn).toMatch(/req\.headers\.get\(\s*["']X-SOS-Trace-Id["']\s*\)/);
    expect(edgeFn).toMatch(/\.traceId\b/);
  });

  it("sos-alert captures server_received_at at top of trigger handler", () => {
    expect(edgeFn).toMatch(/const\s+serverReceivedAt\s*=\s*new\s+Date\(\)\.toISOString\(\)/);
  });

  it("sos-alert reads clientClaimedAt from payload", () => {
    expect(edgeFn).toMatch(/clientClaimedAt\b/);
  });

  it("sos_sessions UPSERT writes trace_id + client_claimed_at + server_received_at", () => {
    // We look for all three field names in the upsert object literal.
    // Each must appear as a key, and traceId / clientClaimedAt /
    // serverReceivedAt must appear as values.
    expect(edgeFn).toMatch(/trace_id:\s*traceId/);
    expect(edgeFn).toMatch(/client_claimed_at:\s*clientClaimedAt/);
    expect(edgeFn).toMatch(/server_received_at:\s*serverReceivedAt/);
  });

  it("sos_sessions atomic-claim UPDATE also writes the three columns", () => {
    // The UPDATE path runs when prewarm pre-created the row. It must
    // also stamp trace_id so the row is queryable post-incident.
    // We assert both occurrences (upsert AND update) by counting >= 2.
    const traceMatches = edgeFn.match(/trace_id:\s*traceId/g) ?? [];
    expect(traceMatches.length).toBeGreaterThanOrEqual(2);
    const clientMatches = edgeFn.match(/client_claimed_at:\s*clientClaimedAt/g) ?? [];
    expect(clientMatches.length).toBeGreaterThanOrEqual(2);
    const serverMatches = edgeFn.match(/server_received_at:\s*serverReceivedAt/g) ?? [];
    expect(serverMatches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("L1: migration adds the columns + indices", () => {
  it("adds trace_id, client_claimed_at, server_received_at to sos_sessions", () => {
    expect(migration).toMatch(/ALTER TABLE public\.sos_sessions[\s\S]*ADD COLUMN[\s\S]*trace_id\s+uuid/);
    expect(migration).toMatch(/client_claimed_at\s+timestamptz/);
    expect(migration).toMatch(/server_received_at\s+timestamptz/);
  });

  it("adds trace_id to audit_log", () => {
    expect(migration).toMatch(/ALTER TABLE public\.audit_log[\s\S]*ADD COLUMN[\s\S]*trace_id\s+uuid/);
  });

  it("creates indices on trace_id for fast pivot queries", () => {
    expect(migration).toMatch(/CREATE INDEX[\s\S]*idx_sos_sessions_trace_id/);
    expect(migration).toMatch(/CREATE INDEX[\s\S]*idx_audit_log_trace_id/);
  });

  it("documents the rollback hint for emergency revert", () => {
    expect(migration).toMatch(/Rollback hint/i);
    expect(migration).toMatch(/DROP COLUMN/);
  });
});
