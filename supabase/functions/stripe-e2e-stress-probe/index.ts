// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — stripe-e2e-stress-probe (R-19 #22)
// ─────────────────────────────────────────────────────────────────────────
// PHASES (5)
//   1. PLAN_UPGRADE   create starter sub → change price to growth → expect
//                     tier='growth' in DB.
//   2. SEAT_OVERFLOW  create sub with quantity=1500 → expect DB
//                     seat_quantity=1000 (clamped by R-19 #7 cap).
//   3. CONCURRENT     5 parallel CREATE flows → expect 5 rows, no dedup loss.
//   4. OUT_OF_ORDER   pre-stamp subs.last_stripe_event_at = NOW → inject a
//                     crafted customer.subscription.updated event with
//                     event.created = NOW-3600 → expect row UNCHANGED
//                     (R-19 #10 ordering guard).
//   5. PAYMENT_FAIL   create sub with pm_card_chargeDeclined → expect
//                     status='incomplete' in DB.
//
// AUTH: PROBE_SECRET. ENV: same as stripe-e2e-test-probe + STRIPE_WEBHOOK_SECRET
// for crafting signed events in phase 4.
//
// NOT ON CRON: manual / workflow_dispatch only.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_API = "https://api.stripe.com/v1";
const POLL_INTERVAL_MS = 1000;
const POLL_MAX_ATTEMPTS = 15;

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function jsonResponse(body: unknown, status = 200, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function signLikeStripe(body: string, secret: string, timestamp: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${body}`));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

interface PhaseResult { name: string; pass: boolean; reason?: string; ms: number; details?: Record<string, unknown> }

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, corsHeaders);

  const probeSecret = Deno.env.get("PROBE_SECRET");
  if (!probeSecret || probeSecret.length < 16) return jsonResponse({ error: "probe_misconfigured" }, 500, corsHeaders);
  if (!constantTimeEquals(req.headers.get("Authorization") || "", `Bearer ${probeSecret}`)) {
    return jsonResponse({ error: "unauthorized" }, 401, corsHeaders);
  }

  const supaUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const whSecret  = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const priceStarter = Deno.env.get("STRIPE_PRICE_STARTER_MONTHLY");
  const priceGrowth  = Deno.env.get("STRIPE_PRICE_GROWTH_MONTHLY");
  if (!supaUrl || !serviceKey || !stripeKey || !whSecret || !priceStarter || !priceGrowth) {
    return jsonResponse({ error: "env_missing", needs: "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_STARTER_MONTHLY, STRIPE_PRICE_GROWTH_MONTHLY" }, 500, corsHeaders);
  }
  if (!stripeKey.startsWith("sk_test_")) return jsonResponse({ error: "live_mode_refused" }, 400, corsHeaders);

  const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });
  const webhookUrl = `${supaUrl}/functions/v1/stripe-webhook`;
  const runId = crypto.randomUUID().slice(0, 8);
  const runStart = performance.now();

  // ── Helpers ────────────────────────────────────────────────────────────
  async function stripeCall(path: string, params: Record<string, string>, method: "POST" | "DELETE" = "POST"): Promise<Record<string, unknown> | null> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) body.append(k, v);
    const res = await fetch(`${STRIPE_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: method === "POST" ? body : undefined,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Stripe ${method} ${path}: ${res.status} ${txt.slice(0, 200)}`);
    }
    return res.json();
  }

  async function pollUntil(table: string, col: string, val: string, predicate: (r: Record<string, unknown> | null) => boolean, maxAttempts = POLL_MAX_ATTEMPTS): Promise<{ row: Record<string, unknown> | null; attempts: number }> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const { data } = await admin.from(table).select("*").eq(col, val).maybeSingle();
      if (predicate(data as Record<string, unknown> | null)) return { row: data as Record<string, unknown> | null, attempts: i + 1 };
    }
    return { row: null, attempts: maxAttempts };
  }

  async function makeFixtures(phaseName: string, opts: { withDPA?: boolean } = {}): Promise<{ userId: string; companyId: string; dpaId: string | null; email: string }> {
    const withDPA = opts.withDPA !== false;
    const email = `e2es-${runId}-${phaseName}@sosphere.internal`;
    // 2026-06-06 R-4-family hotfix: bcrypt 72-byte cap + strict policy.
    const password = "Aa1!" + crypto.randomUUID();
    const { data: u, error: uErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (uErr || !u?.user) throw new Error(`user: ${uErr?.message}`);
    const { data: c, error: cErr } = await admin.from("companies").insert({
      name: `e2e-stress ${runId}/${phaseName}`,
      owner_user_id: u.user.id, plan: "starter", country: "SA", employee_estimate: 5,
    }).select("id").single();
    if (cErr || !c) throw new Error(`company: ${cErr?.message}`);
    let dpaId: string | null = null;
    if (withDPA) {
      const { data: d, error: dErr } = await admin.from("company_dpa_acceptances").insert({
        company_id: c.id, dpa_version: "v1-e2e", signer_user_id: u.user.id,
        signer_full_name: "Stress", signer_title: "Probe", signer_email: email,
      }).select("id").single();
      if (dErr || !d) throw new Error(`dpa: ${dErr?.message}`);
      dpaId = d.id as string;
    }
    return { userId: u.user.id, companyId: c.id as string, dpaId, email };
  }

  async function cleanFixtures(f: { userId: string; companyId: string; dpaId: string | null }) {
    try { await admin.from("subscriptions").delete().eq("company_id", f.companyId); } catch {}
    try { if (f.dpaId) await admin.from("company_dpa_acceptances").delete().eq("id", f.dpaId); } catch {}
    try { await admin.from("companies").delete().eq("id", f.companyId); } catch {}
    try { await admin.auth.admin.deleteUser(f.userId); } catch {}
  }

  async function createSub(companyId: string, email: string, opts: { price?: string; quantity?: number; pm?: string } = {}): Promise<{ customerId: string; subId: string }> {
    const cust = await stripeCall("/customers", { email, "metadata[companyId]": companyId, "metadata[probe_run_id]": runId });
    const customerId = cust!.id as string;
    const pmToken = opts.pm ?? "pm_card_visa";
    const pm = await stripeCall(`/payment_methods/${pmToken}/attach`, { customer: customerId });
    const pmId = pm!.id as string;
    await stripeCall(`/customers/${customerId}`, { "invoice_settings[default_payment_method]": pmId });
    const subParams: Record<string, string> = {
      customer: customerId,
      "items[0][price]": opts.price ?? priceStarter!,
      default_payment_method: pmId,
      "metadata[companyId]": companyId,
      "metadata[probe_run_id]": runId,
    };
    if (opts.quantity !== undefined) subParams["items[0][quantity]"] = String(opts.quantity);
    // For PAYMENT_FAIL phase the first invoice MUST be attempted (default is "default_incomplete" but we want it to try)
    subParams["payment_behavior"] = "error_if_incomplete"; // safer default
    let sub: Record<string, unknown> | null;
    try {
      sub = await stripeCall("/subscriptions", subParams);
    } catch (e) {
      // For PAYMENT_FAIL, error_if_incomplete causes immediate failure → retry with default
      if (String(e).includes("incomplete")) {
        delete subParams["payment_behavior"];
        sub = await stripeCall("/subscriptions", subParams);
      } else { throw e; }
    }
    return { customerId, subId: sub!.id as string };
  }

  async function delSub(customerId: string, subId?: string) {
    if (subId) try { await stripeCall(`/subscriptions/${subId}`, {}, "DELETE"); } catch {}
    if (customerId) try { await stripeCall(`/customers/${customerId}`, {}, "DELETE"); } catch {}
  }

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 1 — PLAN_UPGRADE (starter → growth)
  // ════════════════════════════════════════════════════════════════════════
  async function phase_PLAN_UPGRADE(): Promise<PhaseResult> {
    const t0 = performance.now();
    let f: Awaited<ReturnType<typeof makeFixtures>> | null = null;
    let s: { customerId: string; subId: string } | null = null;
    try {
      f = await makeFixtures("upgrade");
      s = await createSub(f.companyId, f.email);
      const created = await pollUntil("subscriptions", "stripe_customer_id", s.customerId, (r) => r !== null && r.tier === "starter");
      if (!created.row) return { name: "PLAN_UPGRADE", pass: false, reason: "starter sub never landed", ms: Math.round(performance.now() - t0) };
      // Fetch sub to get item ID
      const subRes = await fetch(`${STRIPE_API}/subscriptions/${s.subId}`, { headers: { Authorization: `Bearer ${stripeKey}` } });
      const subData = await subRes.json();
      const subItemId = subData?.items?.data?.[0]?.id;
      if (!subItemId) throw new Error("no item id");
      // Change price to growth
      await stripeCall(`/subscriptions/${s.subId}`, {
        "items[0][id]": subItemId, "items[0][price]": priceGrowth!, proration_behavior: "none",
      });
      const upgraded = await pollUntil("subscriptions", "stripe_customer_id", s.customerId, (r) => r !== null && r.tier === "growth");
      if (!upgraded.row) return { name: "PLAN_UPGRADE", pass: false, reason: `tier did not flip to growth after ${upgraded.attempts}s`, ms: Math.round(performance.now() - t0) };
      return { name: "PLAN_UPGRADE", pass: true, ms: Math.round(performance.now() - t0), details: { from: created.row.tier, to: upgraded.row.tier, pollAttempts: upgraded.attempts } };
    } catch (e) {
      return { name: "PLAN_UPGRADE", pass: false, reason: String(e).slice(0, 200), ms: Math.round(performance.now() - t0) };
    } finally {
      if (s && f) await delSub(s.customerId, s.subId);
      if (f) await cleanFixtures(f);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 2 — SEAT_OVERFLOW (quantity 1500 → clamped to 1000)
  // ════════════════════════════════════════════════════════════════════════
  async function phase_SEAT_OVERFLOW(): Promise<PhaseResult> {
    const t0 = performance.now();
    let f: Awaited<ReturnType<typeof makeFixtures>> | null = null;
    let s: { customerId: string; subId: string } | null = null;
    try {
      f = await makeFixtures("overflow");
      s = await createSub(f.companyId, f.email, { quantity: 1500 });
      const result = await pollUntil("subscriptions", "stripe_customer_id", s.customerId, (r) => r !== null && r.seat_quantity !== null);
      if (!result.row) return { name: "SEAT_OVERFLOW", pass: false, reason: "no row landed", ms: Math.round(performance.now() - t0) };
      const seat = result.row.seat_quantity as number;
      if (seat !== 1000) return { name: "SEAT_OVERFLOW", pass: false, reason: `seat_quantity=${seat}, expected 1000 (clamp)`, ms: Math.round(performance.now() - t0) };
      return { name: "SEAT_OVERFLOW", pass: true, ms: Math.round(performance.now() - t0), details: { stripe_sent: 1500, db_stored: seat, pollAttempts: result.attempts } };
    } catch (e) {
      return { name: "SEAT_OVERFLOW", pass: false, reason: String(e).slice(0, 200), ms: Math.round(performance.now() - t0) };
    } finally {
      if (s && f) await delSub(s.customerId, s.subId);
      if (f) await cleanFixtures(f);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 3 — CONCURRENT (5 parallel CREATEs)
  // ════════════════════════════════════════════════════════════════════════
  async function phase_CONCURRENT(): Promise<PhaseResult> {
    const t0 = performance.now();
    const N = 5;
    const fixtures: Array<Awaited<ReturnType<typeof makeFixtures>>> = [];
    const stacks: Array<{ customerId: string; subId: string } | null> = [];
    try {
      for (let i = 0; i < N; i++) fixtures.push(await makeFixtures(`conc${i}`));
      // Fire all 5 createSubs in parallel
      const subs = await Promise.all(fixtures.map((f, i) => createSub(f.companyId, f.email).catch((e) => ({ err: String(e), idx: i }))));
      const subErrors = subs.filter((s): s is { err: string; idx: number } => "err" in s);
      if (subErrors.length > 0) {
        for (let i = 0; i < N; i++) stacks.push(null);
        return { name: "CONCURRENT", pass: false, reason: `${subErrors.length}/${N} sub creates failed: ${JSON.stringify(subErrors).slice(0, 200)}`, ms: Math.round(performance.now() - t0) };
      }
      const validSubs = subs as Array<{ customerId: string; subId: string }>;
      validSubs.forEach((s) => stacks.push(s));
      // Poll each subscription in parallel until all 5 are landed
      const results = await Promise.all(validSubs.map((s) =>
        pollUntil("subscriptions", "stripe_customer_id", s.customerId, (r) => r !== null && r.status === "active")
      ));
      const landed = results.filter((r) => r.row !== null).length;
      if (landed !== N) {
        return { name: "CONCURRENT", pass: false, reason: `${landed}/${N} rows landed`, ms: Math.round(performance.now() - t0) };
      }
      return { name: "CONCURRENT", pass: true, ms: Math.round(performance.now() - t0), details: { N, landed, max_poll_attempts: Math.max(...results.map((r) => r.attempts)) } };
    } catch (e) {
      return { name: "CONCURRENT", pass: false, reason: String(e).slice(0, 200), ms: Math.round(performance.now() - t0) };
    } finally {
      await Promise.all(stacks.map((s, i) => s && fixtures[i] ? delSub(s.customerId, s.subId) : Promise.resolve()));
      await Promise.all(fixtures.map((f) => cleanFixtures(f)));
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 4 — OUT_OF_ORDER (R-19 #10 ordering guard)
  // ════════════════════════════════════════════════════════════════════════
  async function phase_OUT_OF_ORDER(): Promise<PhaseResult> {
    const t0 = performance.now();
    let f: Awaited<ReturnType<typeof makeFixtures>> | null = null;
    let s: { customerId: string; subId: string } | null = null;
    try {
      f = await makeFixtures("ordering");
      s = await createSub(f.companyId, f.email);
      const initial = await pollUntil("subscriptions", "stripe_customer_id", s.customerId, (r) => r !== null && r.status === "active");
      if (!initial.row) return { name: "OUT_OF_ORDER", pass: false, reason: "initial sub never landed", ms: Math.round(performance.now() - t0) };
      const initialEventAt = initial.row.last_stripe_event_at as string;

      // Now craft a webhook event with event.created MUCH OLDER than initialEventAt
      // (1 hour earlier). The handler should SKIP the upsert (R-19 #10 ordering guard).
      const oldTimestamp = Math.floor(new Date(initialEventAt).getTime() / 1000) - 3600;
      const evtId = `evt_e2e_stale_${runId}`;
      const fakeEvent = {
        id: evtId,
        type: "customer.subscription.updated",
        object: "event",
        created: oldTimestamp,
        data: {
          object: {
            id: s.subId,
            customer: s.customerId,
            status: "active",
            cancel_at_period_end: true,  // a STALE state we want to NOT see in DB
            current_period_end: Math.floor(Date.now()/1000) + 86400,
            items: { data: [{ id: "si_stale", price: { id: priceStarter, product: "prod_stale" }, quantity: 1 }] },
            metadata: { companyId: f.companyId, probe_run_id: runId },
          },
        },
      };
      const body = JSON.stringify(fakeEvent);
      const sig = await signLikeStripe(body, whSecret!, Math.floor(Date.now() / 1000));
      const r = await fetch(webhookUrl, {
        method: "POST",
        headers: { "stripe-signature": sig, "Content-Type": "application/json" },
        body,
      });
      const rBody = await r.text();
      // The webhook should return 200 (it processed the dedup successfully)
      // BUT the upsert should have been SKIPPED by the ordering guard.
      // The cancel_at_period_end should still be FALSE in the row.
      await new Promise((rr) => setTimeout(rr, 2000));
      const { data: after } = await admin.from("subscriptions").select("cancel_at_period_end, last_stripe_event_at").eq("stripe_customer_id", s.customerId).maybeSingle();
      const cancelAtPE = (after as any)?.cancel_at_period_end;
      const passOrdering = cancelAtPE === false; // row was NOT updated
      return {
        name: "OUT_OF_ORDER",
        pass: passOrdering,
        reason: passOrdering ? undefined : `cancel_at_period_end=${cancelAtPE} — stale event was applied!`,
        ms: Math.round(performance.now() - t0),
        details: { webhook_status: r.status, webhook_body_first_120: rBody.slice(0, 120), cancel_at_period_end_after: cancelAtPE },
      };
    } catch (e) {
      return { name: "OUT_OF_ORDER", pass: false, reason: String(e).slice(0, 200), ms: Math.round(performance.now() - t0) };
    } finally {
      // Also clean up the dedup row from our crafted event
      try { await admin.from("processed_stripe_events").delete().eq("event_id", `evt_e2e_stale_${runId}`); } catch {}
      if (s && f) await delSub(s.customerId, s.subId);
      if (f) await cleanFixtures(f);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 5 — PAYMENT_FAIL (charge declined → status='incomplete')
  // ════════════════════════════════════════════════════════════════════════
  async function phase_PAYMENT_FAIL(): Promise<PhaseResult> {
    const t0 = performance.now();
    let f: Awaited<ReturnType<typeof makeFixtures>> | null = null;
    let s: { customerId: string; subId: string } | null = null;
    try {
      f = await makeFixtures("payfail");
      // pm_card_chargeDeclined → Stripe declines the first charge,
      // subscription is created with status='incomplete'.
      s = await createSub(f.companyId, f.email, { pm: "pm_card_chargeDeclined" });
      // Wait for the row to land with any status. We accept 'incomplete'
      // OR 'past_due' (Stripe sometimes assigns either depending on the
      // exact flow).
      const result = await pollUntil("subscriptions", "stripe_customer_id", s.customerId,
        (r) => r !== null && (r.status === "incomplete" || r.status === "past_due"));
      if (!result.row) {
        // Fetch what we DID get
        const { data: anyRow } = await admin.from("subscriptions").select("status").eq("stripe_customer_id", s.customerId).maybeSingle();
        return { name: "PAYMENT_FAIL", pass: false, reason: `expected status incomplete or past_due, got ${(anyRow as any)?.status ?? "no row"}`, ms: Math.round(performance.now() - t0) };
      }
      return { name: "PAYMENT_FAIL", pass: true, ms: Math.round(performance.now() - t0), details: { status: result.row.status, pollAttempts: result.attempts } };
    } catch (e) {
      // Some "error_if_incomplete" paths throw on createSub when the charge declines.
      // That's an acceptable outcome — it means Stripe refused to even create the sub.
      // BUT: it means no webhook fires either, so DB has no row. Verify the throw came
      // from charge decline (not infrastructure).
      const errStr = String(e);
      if (errStr.includes("Your card was declined") || errStr.includes("card_declined")) {
        return { name: "PAYMENT_FAIL", pass: true, ms: Math.round(performance.now() - t0), details: { mode: "stripe_refused_at_create", error: errStr.slice(0, 120) } };
      }
      return { name: "PAYMENT_FAIL", pass: false, reason: errStr.slice(0, 200), ms: Math.round(performance.now() - t0) };
    } finally {
      if (s && f) await delSub(s.customerId, s.subId);
      if (f) await cleanFixtures(f);
    }
  }

  // ── Run all phases ─────────────────────────────────────────────────────
  const phases: PhaseResult[] = [];
  phases.push(await phase_PLAN_UPGRADE());
  phases.push(await phase_SEAT_OVERFLOW());
  phases.push(await phase_CONCURRENT());
  phases.push(await phase_OUT_OF_ORDER());
  phases.push(await phase_PAYMENT_FAIL());

  const totalMs = Math.round(performance.now() - runStart);
  const allPass = phases.every((p) => p.pass);
  return jsonResponse({
    pass: allPass, runId,
    passed: phases.filter((p) => p.pass).length,
    failed: phases.filter((p) => !p.pass).length,
    total: phases.length,
    totalMs, phases,
  }, 200, corsHeaders);
});
