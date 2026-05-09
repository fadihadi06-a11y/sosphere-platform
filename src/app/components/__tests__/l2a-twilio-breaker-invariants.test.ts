// ═══════════════════════════════════════════════════════════════
// SOSphere — L2-A Twilio Circuit Breaker — invariants
// ─────────────────────────────────────────────────────────────
// Locks the contract for the Twilio circuit breaker. Companion to:
//   • supabase/migrations/20260509180000_l2a_twilio_circuit_breaker.sql
//   • supabase/functions/_shared/twilio-breaker.ts
//   • supabase/functions/twilio-call/index.ts (wired)
//   • supabase/functions/twilio-sms/index.ts  (wired)
//
// Guards against:
//   • Future refactor removing the breaker check from a Twilio edge
//     function — would re-introduce the thundering-herd failure mode.
//   • Future tweak weakening the SECURITY DEFINER + locked search_path
//     on the breaker RPCs — opens a privilege-escalation surface.
//   • Future change exposing the breaker RPCs to anon/authenticated —
//     anyone could short-circuit production Twilio dispatch.
//   • Future change to the failure-record path that forgets to
//     decrement on success / increment on failure.
//   • Drift in the THRESHOLD / WINDOW / COOL_DOWN constants between
//     migration and any client that depends on them.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let mig = "";
let helper = "";
let twilioCall = "";
let twilioSms = "";

beforeAll(() => {
  mig = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260509180000_l2a_twilio_circuit_breaker.sql"),
    "utf8",
  );
  helper = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/_shared/twilio-breaker.ts"),
    "utf8",
  );
  twilioCall = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/twilio-call/index.ts"),
    "utf8",
  );
  twilioSms = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/twilio-sms/index.ts"),
    "utf8",
  );
});

// ─── 1. Schema + RPC contract ──────────────────────────────
describe("L2-A: twilio_breaker_state table + RPCs", () => {
  it("creates the breaker state table with the correct CHECK constraint", () => {
    expect(mig).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.twilio_breaker_state[\s\S]*?CHECK \(state IN \('closed', 'open', 'half_open'\)\)/,
    );
  });

  it("seeds the 'global' breaker key (so the first check never fails)", () => {
    expect(mig).toMatch(/INSERT INTO public\.twilio_breaker_state \(key\) VALUES \('global'\)\s+ON CONFLICT \(key\) DO NOTHING/);
  });

  it("ENABLEs + FORCEs RLS and grants only to service_role", () => {
    expect(mig).toMatch(/ALTER TABLE public\.twilio_breaker_state ENABLE ROW LEVEL SECURITY/);
    expect(mig).toMatch(/ALTER TABLE public\.twilio_breaker_state FORCE ROW LEVEL SECURITY/);
    expect(mig).toMatch(/GRANT\s+ALL ON public\.twilio_breaker_state TO service_role/);
    expect(mig).toMatch(/REVOKE ALL ON public\.twilio_breaker_state FROM anon, authenticated/);
  });

  it("twilio_breaker_check is SECURITY DEFINER + locked search_path", () => {
    expect(mig).toMatch(
      /CREATE OR REPLACE FUNCTION public\.twilio_breaker_check[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path\s*=\s*'public',\s*'pg_temp'/,
    );
  });

  it("twilio_breaker_record is SECURITY DEFINER + locked search_path", () => {
    expect(mig).toMatch(
      /CREATE OR REPLACE FUNCTION public\.twilio_breaker_record[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path\s*=\s*'public',\s*'pg_temp'/,
    );
  });

  it("THRESHOLD = 5 failures, WINDOW = 30s, COOL_DOWN = 30s — frozen contract", () => {
    expect(mig).toMatch(/v_threshold int := 5/);
    expect(mig).toMatch(/v_window\s+interval := interval '30 seconds'/);
    expect(mig).toMatch(/v_cool_down\s+interval := interval '30 seconds'/);
  });

  it("breaker RPCs are REVOKE'd from PUBLIC + anon + authenticated; GRANT only to service_role", () => {
    for (const fn of ["twilio_breaker_check", "twilio_breaker_record"]) {
      expect(mig).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]*?FROM PUBLIC`));
      expect(mig).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]*?FROM anon, authenticated`));
      expect(mig).toMatch(new RegExp(`GRANT\\s+EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]*?TO service_role`));
    }
  });
});

// ─── 2. State-machine semantics ─────────────────────────────
describe("L2-A: breaker state transitions", () => {
  it("check() lazily transitions open → half_open after cool-down", () => {
    expect(mig).toMatch(
      /IF v_row\.state = 'open'[\s\S]*?\(v_now - v_row\.opened_at\) > v_cool_down[\s\S]*?state\s*=\s*'half_open'/,
    );
  });

  it("check() resets failure_count when last failure is older than the window (closed-state hygiene)", () => {
    expect(mig).toMatch(
      /IF v_row\.state = 'closed'[\s\S]*?v_row\.last_failure_at IS NOT NULL[\s\S]*?> v_window[\s\S]*?failure_count = 0/,
    );
  });

  it("record(success=true) closes the breaker AND resets failure_count", () => {
    expect(mig).toMatch(/IF p_success THEN[\s\S]*?state\s*=\s*'closed',\s*\n?\s*failure_count\s*=\s*0/);
  });

  it("record(success=false) on half_open immediately re-opens", () => {
    expect(mig).toMatch(/IF v_row\.state = 'half_open'[\s\S]*?state\s*=\s*'open'/);
  });

  it("record(success=false) on closed trips when failure_count >= threshold", () => {
    expect(mig).toMatch(/v_row\.state = 'closed' AND v_row\.failure_count >= v_threshold/);
  });
});

// ─── 3. Edge-side helper ────────────────────────────────────
describe("L2-A: shared twilio-breaker.ts client", () => {
  it("exports checkBreaker / recordBreaker / breakerShortCircuitResponse", () => {
    expect(helper).toMatch(/export async function checkBreaker/);
    expect(helper).toMatch(/export async function recordBreaker/);
    expect(helper).toMatch(/export function breakerShortCircuitResponse/);
  });

  it("checkBreaker fails OPEN on RPC error (a breaker-DB outage must NOT block dispatch)", () => {
    // Two failure paths (error / throw) — both return allow:true.
    expect(helper).toMatch(/check failed \(fail-open\)[\s\S]*?return\s*\{[\s\S]*?allow:\s*true/);
    expect(helper).toMatch(/check threw \(fail-open\)[\s\S]*?return\s*\{[\s\S]*?allow:\s*true/);
  });

  it("breakerShortCircuitResponse returns HTTP 503 with structured marker", () => {
    expect(helper).toMatch(/status:\s*503/);
    expect(helper).toMatch(/error:\s*["']twilio_breaker_open["']/);
    expect(helper).toMatch(/breaker:\s*\{[\s\S]*?state[\s\S]*?opened_at[\s\S]*?failure_count/);
  });
});

// ─── 4. Edge function wiring ───────────────────────────────
describe("L2-A: twilio-call + twilio-sms have the breaker wired", () => {
  for (const [name, src] of [
    ["twilio-call", () => twilioCall],
    ["twilio-sms", () => twilioSms],
  ] as const) {
    describe(name, () => {
      it("imports checkBreaker / recordBreaker / breakerShortCircuitResponse from the shared helper", () => {
        const s = src();
        expect(s).toMatch(/import\s*\{[^}]*checkBreaker[^}]*\}\s*from\s*["']\.\.\/_shared\/twilio-breaker\.ts["']/);
        expect(s).toMatch(/recordBreaker/);
        expect(s).toMatch(/breakerShortCircuitResponse/);
      });

      it("calls checkBreaker BEFORE fetch(twilioUrl) — short-circuits when not allowed", () => {
        const s = src();
        const idxCheck = s.indexOf("checkBreaker");
        const idxFetch = s.indexOf("fetch(twilioUrl");
        expect(idxCheck).toBeGreaterThan(-1);
        expect(idxFetch).toBeGreaterThan(-1);
        expect(idxCheck).toBeLessThan(idxFetch);
      });

      it("calls recordBreaker after the Twilio fetch — both on success and failure", () => {
        const s = src();
        // Success path: recordBreaker(client, twilioOk, ...)
        expect(s).toMatch(/recordBreaker\(\s*breakerClient,\s*twilioOk,\s*["']global["']\s*\)/);
        // Network-failure path: recordBreaker(client, false, ...) inside the catch
        expect(s).toMatch(/recordBreaker\(\s*breakerClient,\s*false,\s*["']global["']\s*\)/);
      });

      it("returns breakerShortCircuitResponse(...) when the breaker disallows the call", () => {
        const s = src();
        expect(s).toMatch(/if \(!breaker\.allow\)/);
        expect(s).toMatch(/breakerShortCircuitResponse\(breaker,/);
      });
    });
  }
});
