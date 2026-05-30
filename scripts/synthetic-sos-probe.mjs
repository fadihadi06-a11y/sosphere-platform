#!/usr/bin/env node
/**
 * Synthetic SOS Probe — Lighthouse L6 (always-on monitoring)
 *
 * Doctrine ref: PHASE_0_DOCTRINE.md §2 L6 + PHASE_0_TESTING_PHILOSOPHY.md §1 Tier 9
 * Step plan: PHASE_0_STEP_PLAN.md (enables P0-Z10 verification)
 *
 * Purpose:
 *   The only check that proves the LIVE PRODUCTION SOS path actually works. Static
 *   analysis (L1-L4) cannot tell you whether sos-alert is currently dispatching
 *   correctly in production — only this probe can.
 *
 * What it does:
 *   1. Calls the `sos-alert` Edge Function with `{ probe: true, probeId: <uuid> }`
 *      in the body. The function is required to recognize this shape and:
 *        - Skip actual SMS/voice/push dispatch (no real notification sent)
 *        - Still run the full pipeline (auth, RLS, breaker, rate-limit, audit_log write)
 *        - Return a structured ack: { ok, probeId, durationMs, stagesExecuted }
 *   2. Asserts the ack arrives within SLO_MS (5000ms by default).
 *   3. Asserts the body shape matches the contract (mutant-resistant per Testing
 *      Philosophy §6: any missing field fails loudly with a structural diff).
 *   4. On 2 consecutive failures, exits 2 (PagerDuty-page in CI) and prints a runbook URL.
 *
 * World-class refs:
 *   - Google SRE Workbook Ch. 4 (SLOs) + Ch. 6 (Alerting on SLOs)
 *   - Stripe — "How we test Stripe in production" (continuous synthetic checks)
 *   - Datadog Synthetics canonical model
 *   - PagerDuty alerting best practices (signal:noise > 5:1)
 *
 * Cadence: run every 15 minutes via scheduled-task / GitHub Actions cron.
 *
 * Usage:
 *   node scripts/synthetic-sos-probe.mjs                       # one-shot
 *   node scripts/synthetic-sos-probe.mjs --runs 3 --sleep 10   # 3 runs, 10s apart (chaos mode)
 *   node scripts/synthetic-sos-probe.mjs --env staging         # probe staging instead of prod
 *
 * Required env:
 *   SOSPHERE_SUPABASE_URL          — e.g. https://<proj>.supabase.co
 *   SOSPHERE_SUPABASE_ANON_KEY     — anon key (for the sign-in call only)
 *   SOSPHERE_PROBE_EMAIL           — probe-user email (e.g. probe@sosphere.internal)
 *   SOSPHERE_PROBE_PASSWORD        — probe-user password (stored as GH secret)
 *   SOSPHERE_PROBE_REGION          — informational label: "iad", "fra", "dxb" (default: "local")
 *   SOSPHERE_PROBE_RUNBOOK_URL     — link emitted in alerts (default: README#runbook)
 *
 * Auth model: the script signs in with email+password at startup to obtain
 * a fresh JWT. This keeps the secret material long-lived (passwords don't
 * expire) while the in-process JWT stays short-lived as Supabase recommends.
 * Backwards-compat: SOSPHERE_PROBE_JWT is still accepted as a fallback
 * (pre-2026-05 behavior) — set EITHER the email/password pair OR the JWT.
 *
 * Exit codes:
 *   0 — all runs green
 *   1 — at least one run failed but threshold not breached (informational)
 *   2 — consecutive-failure threshold breached → page on-call
 */

import { randomUUID } from 'node:crypto';
import process from 'node:process';

// ─── SLO + alert thresholds ─────────────────────────────────────────────────
const SLO_MS = Number(process.env.SOSPHERE_SOS_PROBE_SLO_MS ?? 5000);
const PAGE_AFTER_CONSECUTIVE_FAILURES = Number(
  process.env.SOSPHERE_SOS_PROBE_PAGE_AFTER ?? 2,
);

// ─── CLI parsing (minimal, dependency-free) ─────────────────────────────────
function parseArgs(argv) {
  const opts = { runs: 1, sleepSec: 0, env: 'production' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') opts.runs = Number(argv[++i]);
    else if (a === '--sleep') opts.sleepSec = Number(argv[++i]);
    else if (a === '--env') opts.env = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: synthetic-sos-probe.mjs [--runs N] [--sleep SEC] [--env staging|production]');
      process.exit(0);
    }
  }
  return opts;
}

// ─── Required env validation ────────────────────────────────────────────────
function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(JSON.stringify({
      level: 'fatal',
      event: 'probe_misconfigured',
      missing: name,
      runbook: process.env.SOSPHERE_PROBE_RUNBOOK_URL ?? 'README.md#probe-runbook',
    }));
    process.exit(2);
  }
  return v;
}

// ─── Structured log emitter (one JSON object per line for log aggregators) ──
function emit(payload) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...payload }) + '\n');
}

// ─── Mutant-resistant contract assertion ────────────────────────────────────
const REQUIRED_ACK_FIELDS = ['ok', 'probeId', 'durationMs', 'stagesExecuted'];

/** Throws if `ack` does not match the contract. Returns the validated ack. */
function assertAckContract(ack, expectedProbeId) {
  if (typeof ack !== 'object' || ack === null) {
    throw new Error(`ack must be an object, got ${typeof ack}`);
  }
  const missing = REQUIRED_ACK_FIELDS.filter((k) => !(k in ack));
  if (missing.length > 0) {
    throw new Error(`ack missing required fields: ${missing.join(', ')}`);
  }
  if (ack.ok !== true) {
    throw new Error(`ack.ok must be true, got ${JSON.stringify(ack.ok)}`);
  }
  if (ack.probeId !== expectedProbeId) {
    throw new Error(`ack.probeId mismatch: expected ${expectedProbeId}, got ${ack.probeId}`);
  }
  if (typeof ack.durationMs !== 'number' || ack.durationMs < 0) {
    throw new Error(`ack.durationMs must be a non-negative number`);
  }
  if (!Array.isArray(ack.stagesExecuted) || ack.stagesExecuted.length === 0) {
    throw new Error(`ack.stagesExecuted must be a non-empty array`);
  }
  return ack;
}

// ─── One probe call ─────────────────────────────────────────────────────────
async function runOne({ supabaseUrl, jwt, region, runIndex }) {
  const probeId = randomUUID();
  const startMs = Date.now();
  let httpStatus = 0;
  let body = null;
  let error = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SLO_MS + 2000);

    const resp = await fetch(`${supabaseUrl}/functions/v1/sos-alert?action=probe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
        'X-Probe-Run': String(runIndex),
        'X-Probe-Region': region,
      },
      body: JSON.stringify({ probe: true, probeId, region, slaMs: SLO_MS }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    httpStatus = resp.status;
    body = await resp.json().catch(() => null);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const durationMs = Date.now() - startMs;

  // Determine pass/fail.
  let pass = false;
  let reason = 'unknown';
  if (error) { reason = `network/timeout: ${error}`; }
  else if (httpStatus < 200 || httpStatus >= 300) { reason = `http_${httpStatus}`; }
  else if (durationMs > SLO_MS) { reason = `slo_breach_${durationMs}ms`; }
  else {
    try {
      assertAckContract(body, probeId);
      pass = true;
      reason = 'ok';
    } catch (e) {
      reason = `ack_contract: ${e.message}`;
    }
  }

  emit({
    level: pass ? 'info' : 'error',
    event: 'sos_probe_attempt',
    probeId,
    region,
    runIndex,
    httpStatus,
    durationMs,
    sloMs: SLO_MS,
    pass,
    reason,
  });

  return { pass, durationMs, reason, probeId };
}

// ─── Sleep helper ───────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Auth helper: sign in fresh OR use pre-supplied JWT ─────────────────────
/**
 * Two supported auth modes:
 *   (a) email/password sign-in → returns a fresh JWT each run. RECOMMENDED.
 *       Set: SOSPHERE_SUPABASE_ANON_KEY + SOSPHERE_PROBE_EMAIL + SOSPHERE_PROBE_PASSWORD
 *   (b) pre-supplied JWT → set SOSPHERE_PROBE_JWT. Used for short-lived
 *       ad-hoc runs; will fail after the JWT expires (~1h default).
 */
async function obtainProbeJwt(supabaseUrl) {
  if (process.env.SOSPHERE_PROBE_JWT) return process.env.SOSPHERE_PROBE_JWT;

  const anonKey  = requireEnv('SOSPHERE_SUPABASE_ANON_KEY');
  const email    = requireEnv('SOSPHERE_PROBE_EMAIL');
  const password = requireEnv('SOSPHERE_PROBE_PASSWORD');

  const resp = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    emit({
      level: 'fatal',
      event: 'probe_signin_failed',
      httpStatus: resp.status,
      body: body.slice(0, 300),
      runbook: process.env.SOSPHERE_PROBE_RUNBOOK_URL ?? 'README.md#probe-runbook',
    });
    process.exit(2);
  }
  const data = await resp.json();
  if (!data?.access_token) {
    emit({ level: 'fatal', event: 'probe_signin_no_token', body: JSON.stringify(data).slice(0, 300) });
    process.exit(2);
  }
  return data.access_token;
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const supabaseUrl = requireEnv('SOSPHERE_SUPABASE_URL');
  const jwt = await obtainProbeJwt(supabaseUrl);
  const region = process.env.SOSPHERE_PROBE_REGION ?? 'local';

  emit({ level: 'info', event: 'probe_start', env: opts.env, region, runs: opts.runs, sloMs: SLO_MS });

  const results = [];
  let consecutiveFailures = 0;

  for (let i = 0; i < opts.runs; i++) {
    const r = await runOne({ supabaseUrl, jwt, region, runIndex: i });
    results.push(r);
    consecutiveFailures = r.pass ? 0 : consecutiveFailures + 1;
    if (consecutiveFailures >= PAGE_AFTER_CONSECUTIVE_FAILURES) {
      emit({
        level: 'fatal',
        event: 'probe_page',
        consecutiveFailures,
        threshold: PAGE_AFTER_CONSECUTIVE_FAILURES,
        runbook: process.env.SOSPHERE_PROBE_RUNBOOK_URL ?? 'README.md#probe-runbook',
        lastReason: r.reason,
      });
      process.exit(2);
    }
    if (i < opts.runs - 1 && opts.sleepSec > 0) await sleep(opts.sleepSec * 1000);
  }

  const passed = results.filter((r) => r.pass).length;
  const summary = {
    level: passed === opts.runs ? 'info' : 'warn',
    event: 'probe_summary',
    runs: opts.runs,
    passed,
    failed: opts.runs - passed,
    p50DurationMs: percentile(results.map((r) => r.durationMs), 50),
    p95DurationMs: percentile(results.map((r) => r.durationMs), 95),
    region,
  };
  emit(summary);

  process.exit(passed === opts.runs ? 0 : 1);
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

main().catch((err) => {
  emit({ level: 'fatal', event: 'probe_internal_error', message: String(err?.stack ?? err) });
  process.exit(2);
});
