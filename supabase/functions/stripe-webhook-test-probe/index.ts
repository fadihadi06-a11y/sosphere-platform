// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — stripe-webhook-test-probe (R-19 Phase 5)
// ─────────────────────────────────────────────────────────────────────────
// WHAT THIS DOES
//   Sends signed test events to the deployed stripe-webhook endpoint and
//   asserts the three critical paths work end-to-end after deploy:
//
//     1. VALID signature + ignored event type  → 200 "ignored (not handled)"
//        Proves: signature verification + dedup INSERT + default branch
//     2. REPLAY of same event_id                → 200 { deduped: true }
//        Proves: dedup catches duplicate event_id
//     3. INVALID signature                      → 400 "Invalid signature"
//        Proves: signature rejection path
//
//   Why only these 3? End-to-end testing of the new handlers (#3 dispute,
//   #4 3DS, #5 trial_will_end, #6 customer.deleted) requires REAL Stripe
//   side state (a charge, an invoice, a subscription). Faking those events
//   would trigger the #8 checkout-fallback path, which then hits Stripe
//   API for a session that doesn't exist → 5xx. The static contract tests
//   from Phase 1-4 (64 invariants) already lock the new-handler code paths;
//   live integration testing is best done via Stripe Dashboard → Send test
//   webhook OR `stripe trigger event.type` from the CLI.
//
// AUTH
//   PROBE_SECRET bearer (same pattern as the other 5 probes).
//
// REQUIRED SUPABASE SECRETS
//   PROBE_SECRET                 (bearer auth on this endpoint)
//   STRIPE_WEBHOOK_SECRET        (used to sign the test events the same way
//                                 Stripe signs real ones)
//   SUPABASE_URL                 (auto-set — used to reach stripe-webhook)
//
// USAGE
//   curl -X POST "$URL/stripe-webhook-test-probe" \
//     -H "Authorization: Bearer $PROBE_SECRET"
//
// NOT ON CRON
//   Manual / workflow_dispatch only. Each run inserts (then rolls back)
//   one processed_stripe_events row for the dedup test.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function jsonResponse(body: unknown, status = 200, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** Mirror of stripe-webhook's signing algorithm — same code path, same
 *  HMAC-SHA256 over `${t}.${body}`. Produces a header in the exact form
 *  Stripe uses: `t=<unix>,v1=<hex>`. */
async function signLikeStripe(body: string, secret: string, timestamp: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${body}`));
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestamp},v1=${hex}`;
}

interface TestResult {
  name: string;
  pass: boolean;
  expectedStatus: number;
  actualStatus: number;
  expectedBodyContains?: string;
  actualBody: string;
  notes?: string;
}

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, corsHeaders);

  // ── Auth ────────────────────────────────────────────────────────────────
  const probeSecret = Deno.env.get("PROBE_SECRET");
  if (!probeSecret || probeSecret.length < 16) {
    return jsonResponse({ error: "probe_misconfigured" }, 500, corsHeaders);
  }
  const authHeader = req.headers.get("Authorization") || "";
  if (!constantTimeEquals(authHeader, `Bearer ${probeSecret}`)) {
    return jsonResponse({ error: "unauthorized" }, 401, corsHeaders);
  }

  // ── Env ────────────────────────────────────────────────────────────────
  const stripeSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!stripeSecret) {
    return jsonResponse({
      error: "stripe_webhook_secret_missing",
      hint: "Set via: npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_... --project-ref ...",
    }, 500, corsHeaders);
  }
  if (!supaUrl || !serviceKey) {
    return jsonResponse({ error: "env_missing" }, 500, corsHeaders);
  }

  const webhookUrl = `${supaUrl}/functions/v1/stripe-webhook`;
  const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });
  const runId = crypto.randomUUID();
  const results: TestResult[] = [];

  // ── Test 1: VALID signature + ignored event type → 200 + "ignored" ───
  // We use a deliberately-unknown event type so the handler default-
  // branches without trying to look anything up in Stripe or our DB.
  const evtId1 = `evt_probe_${runId.slice(0, 12)}`;
  const body1 = JSON.stringify({
    id: evtId1,
    type: "probe.test.ignored",
    object: "event",
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: "probe_dummy" } },
  });
  const sig1 = await signLikeStripe(body1, stripeSecret, Math.floor(Date.now() / 1000));
  const r1 = await fetch(webhookUrl, {
    method: "POST",
    headers: { "stripe-signature": sig1, "Content-Type": "application/json" },
    body: body1,
  });
  const body1Text = await r1.text();
  results.push({
    name: "valid signature + ignored event",
    pass: r1.status === 200 && /received[\s\S]{0,40}true/.test(body1Text),
    expectedStatus: 200,
    actualStatus: r1.status,
    expectedBodyContains: '"received":true',
    actualBody: body1Text.slice(0, 300),
  });

  // ── Test 2: REPLAY same event id → 200 + { deduped: true } ───────────
  const r2 = await fetch(webhookUrl, {
    method: "POST",
    headers: { "stripe-signature": sig1, "Content-Type": "application/json" },
    body: body1,
  });
  const body2Text = await r2.text();
  results.push({
    name: "replay (same event id) → deduped",
    pass: r2.status === 200 && /deduped[\s\S]{0,20}true/.test(body2Text),
    expectedStatus: 200,
    actualStatus: r2.status,
    expectedBodyContains: '"deduped":true',
    actualBody: body2Text.slice(0, 300),
  });

  // ── Test 3: INVALID signature → 400 ──────────────────────────────────
  const evtId3 = `evt_probe_${runId.slice(0, 12)}_bad`;
  const body3 = JSON.stringify({
    id: evtId3,
    type: "probe.test.ignored",
    object: "event",
    created: Math.floor(Date.now() / 1000),
    data: { object: {} },
  });
  // Sign with WRONG secret
  const sig3 = await signLikeStripe(body3, "wrong-secret-deliberately", Math.floor(Date.now() / 1000));
  const r3 = await fetch(webhookUrl, {
    method: "POST",
    headers: { "stripe-signature": sig3, "Content-Type": "application/json" },
    body: body3,
  });
  const body3Text = await r3.text();
  results.push({
    name: "invalid signature → 400",
    pass: r3.status === 400,
    expectedStatus: 400,
    actualStatus: r3.status,
    expectedBodyContains: "Invalid signature",
    actualBody: body3Text.slice(0, 300),
  });

  // ── Cleanup: remove the dedup rows we created so this probe is idempotent
  try {
    await admin.from("processed_stripe_events").delete().eq("event_id", evtId1);
    await admin.from("processed_stripe_events").delete().eq("event_id", evtId3);
  } catch (e) {
    console.warn("[stripe-webhook-test-probe] cleanup error:", String(e).slice(0, 200));
  }

  const pass = results.every((r) => r.pass);
  return jsonResponse(
    {
      pass,
      runId,
      passed: results.filter((r) => r.pass).length,
      failed: results.filter((r) => !r.pass).length,
      total: results.length,
      results,
    },
    200,
    corsHeaders,
  );
});
