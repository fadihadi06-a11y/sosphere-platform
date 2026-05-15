// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — stripe-e2e-test-probe (R-19 #18 + #21: COMPREHENSIVE)
// ─────────────────────────────────────────────────────────────────────────
// SCOPE
//   This is the comprehensive end-to-end Stripe integration test. It exercises
//   every reasonably-testable scenario against the live deployed webhook, so
//   we know the entire payment integration is sound BEFORE the first paid
//   customer arrives. The user said "this is money, no room for error" —
//   this probe is the answer.
//
// PHASES (run sequentially in one invocation; each has its own setup + cleanup)
//
//   1. CREATE              create a new B2B sub → expect subscriptions row
//                          with tier=starter, seat_quantity=1.
//   2. UPDATE              update the sub's quantity to 5 → expect
//                          seat_quantity=5 propagated to DB.
//   3. CANCEL              DELETE the sub → expect status='canceled'.
//   4. CUSTOMER_DELETE     DELETE the customer → expect stripe_customer_id
//                          NULL + status='canceled' (R-19 #6).
//   5. UNMAPPED_PRICE      create sub with a price NOT in env vars → expect
//                          row in stripe_unmapped_events (R-19 retry path).
//   6. DPA_BLOCK           create sub WITHOUT DPA acceptance → expect row
//                          in ops_alerts + NO row in subscriptions (R-19 #16).
//
// Each phase returns {pass, ms, reason?, details}.
// Overall pass = all phases pass.
//
// AUTH: PROBE_SECRET bearer (same as the other 6 probes).
// ENV: PROBE_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY,
//      STRIPE_PRICE_STARTER_MONTHLY
//
// NOT ON CRON: manual / workflow_dispatch only. ~60-90 seconds per run.
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
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

interface PhaseResult {
  name: string;
  pass: boolean;
  reason?: string;
  ms: number;
  details?: Record<string, unknown>;
}

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
  const authHeader = req.headers.get("Authorization") || "";
  if (!constantTimeEquals(authHeader, `Bearer ${probeSecret}`)) return jsonResponse({ error: "unauthorized" }, 401, corsHeaders);

  const supaUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const priceId   = Deno.env.get("STRIPE_PRICE_STARTER_MONTHLY");
  if (!supaUrl || !serviceKey || !stripeKey || !priceId) {
    return jsonResponse({ error: "env_missing" }, 500, corsHeaders);
  }
  if (!stripeKey.startsWith("sk_test_")) {
    return jsonResponse({ error: "live_mode_refused" }, 400, corsHeaders);
  }

  const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });
  const runId = crypto.randomUUID().slice(0, 8);
  const runStart = performance.now();

  // ── Helper: Stripe HTTP wrapper ────────────────────────────────────────
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
      const txt = await res.text().catch(() => "(no body)");
      throw new Error(`Stripe ${method} ${path}: ${res.status} ${txt.slice(0, 250)}`);
    }
    return res.json();
  }

  // ── Helper: poll DB until predicate is true or timeout ─────────────────
  async function pollUntil<T>(
    table: string,
    filterCol: string,
    filterVal: string,
    predicate: (row: Record<string, unknown> | null) => boolean,
    maxAttempts = POLL_MAX_ATTEMPTS,
  ): Promise<{ row: Record<string, unknown> | null; attempts: number }> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const { data } = await admin.from(table).select("*").eq(filterCol, filterVal).maybeSingle();
      if (predicate(data as Record<string, unknown> | null)) {
        return { row: data as Record<string, unknown> | null, attempts: i + 1 };
      }
    }
    return { row: null, attempts: maxAttempts };
  }

  // ── Helper: create a probe-test company + DPA + auth user ──────────────
  async function createTestFixtures(
    phaseName: string,
    opts: { withDPA: boolean } = { withDPA: true },
  ): Promise<{ userId: string; companyId: string; dpaId: string | null; email: string }> {
    const email = `e2e-${runId}-${phaseName}@sosphere.internal`;
    const password = crypto.randomUUID() + crypto.randomUUID();
    const { data: u, error: uErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (uErr || !u?.user) throw new Error(`createUser: ${uErr?.message}`);
    const userId = u.user.id;
    const { data: c, error: cErr } = await admin.from("companies").insert({
      name: `SOSphere e2e ${runId}/${phaseName}`,
      owner_user_id: userId,
      plan: "starter",
      country: "SA",
      employee_estimate: 5,
    }).select("id").single();
    if (cErr || !c) throw new Error(`createCompany: ${cErr?.message}`);
    const companyId = c.id as string;
    let dpaId: string | null = null;
    if (opts.withDPA) {
      const { data: d, error: dErr } = await admin.from("company_dpa_acceptances").insert({
        company_id: companyId,
        dpa_version: "v1-e2e",
        signer_user_id: userId,
        signer_full_name: "E2E Probe",
        signer_title: "Tester",
        signer_email: email,
      }).select("id").single();
      if (dErr || !d) throw new Error(`createDPA: ${dErr?.message}`);
      dpaId = d.id as string;
    }
    return { userId, companyId, dpaId, email };
  }

  async function cleanupTestFixtures(f: { userId: string; companyId: string; dpaId: string | null }) {
    try { await admin.from("subscriptions").delete().eq("company_id", f.companyId); } catch {}
    try { if (f.dpaId) await admin.from("company_dpa_acceptances").delete().eq("id", f.dpaId); } catch {}
    try { await admin.from("ops_alerts").delete().like("title", `%${f.companyId}%`); } catch {}
    try { await admin.from("stripe_unmapped_events").delete().eq("user_id", f.userId); } catch {}
    try { await admin.from("companies").delete().eq("id", f.companyId); } catch {}
    try { await admin.auth.admin.deleteUser(f.userId); } catch {}
  }

  // ── Helper: create Stripe customer + attach PM + sub ──────────────────
  async function createStripeStack(
    companyId: string,
    email: string,
    options: { priceOverride?: string; quantity?: number } = {},
  ): Promise<{ customerId: string; subId: string }> {
    const cust = await stripeCall("/customers", {
      email,
      "metadata[companyId]": companyId,
      "metadata[probe_run_id]": runId,
    });
    const customerId = cust!.id as string;
    const pm = await stripeCall(`/payment_methods/pm_card_visa/attach`, { customer: customerId });
    const pmId = pm!.id as string;
    await stripeCall(`/customers/${customerId}`, { "invoice_settings[default_payment_method]": pmId });
    const subParams: Record<string, string> = {
      customer: customerId,
      "items[0][price]": options.priceOverride ?? priceId!,
      default_payment_method: pmId,
      "metadata[companyId]": companyId,
      "metadata[probe_run_id]": runId,
    };
    if (options.quantity !== undefined) subParams["items[0][quantity]"] = String(options.quantity);
    const sub = await stripeCall("/subscriptions", subParams);
    return { customerId, subId: sub!.id as string };
  }

  async function deleteStripeStack(customerId: string, subId?: string) {
    if (subId) { try { await stripeCall(`/subscriptions/${subId}`, {}, "DELETE"); } catch {} }
    try { await stripeCall(`/customers/${customerId}`, {}, "DELETE"); } catch {}
  }

  // ══════════════════════════════════════════════════════════════════════
  // PHASE 1 — CREATE
  // ══════════════════════════════════════════════════════════════════════
  async function phase_CREATE(): Promise<PhaseResult> {
    const t0 = performance.now();
    const fixtures = await createTestFixtures("create").catch((e) => ({ error: String(e) }));
    if ("error" in fixtures) return { name: "CREATE", pass: false, reason: `setup: ${fixtures.error}`, ms: Math.round(performance.now() - t0) };
    let stack: { customerId: string; subId: string } | null = null;
    try {
      stack = await createStripeStack(fixtures.companyId, fixtures.email);
      const { row, attempts } = await pollUntil(
        "subscriptions", "stripe_customer_id", stack.customerId,
        (r) => r !== null && r.status === "active" && r.tier === "starter",
      );
      if (!row) return { name: "CREATE", pass: false, reason: `no row after ${attempts}s`, ms: Math.round(performance.now() - t0) };
      return { name: "CREATE", pass: true, ms: Math.round(performance.now() - t0), details: { pollAttempts: attempts, tier: row.tier, seat_quantity: row.seat_quantity } };
    } catch (e) {
      return { name: "CREATE", pass: false, reason: String(e).slice(0, 200), ms: Math.round(performance.now() - t0) };
    } finally {
      if (stack) await deleteStripeStack(stack.customerId, stack.subId);
      await cleanupTestFixtures(fixtures);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // PHASE 2 — UPDATE (seat_quantity propagation)
  // ══════════════════════════════════════════════════════════════════════
  async function phase_UPDATE(): Promise<PhaseResult> {
    const t0 = performance.now();
    const fixtures = await createTestFixtures("update").catch((e) => ({ error: String(e) }));
    if ("error" in fixtures) return { name: "UPDATE", pass: false, reason: `setup: ${fixtures.error}`, ms: Math.round(performance.now() - t0) };
    let stack: { customerId: string; subId: string } | null = null;
    try {
      stack = await createStripeStack(fixtures.companyId, fixtures.email, { quantity: 1 });
      // Wait for initial CREATE row
      const initial = await pollUntil("subscriptions", "stripe_customer_id", stack.customerId, (r) => r !== null && r.seat_quantity === 1);
      if (!initial.row) return { name: "UPDATE", pass: false, reason: "initial CREATE row never landed", ms: Math.round(performance.now() - t0) };
      // Fetch the subscription to get items[0].id (the subscription-item ID,
      // like si_xxx — NOT the subscription ID). Stripe needs this to know
      // which item to mutate.
      const subRes = await fetch(`${STRIPE_API}/subscriptions/${stack.subId}`, {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      if (!subRes.ok) throw new Error(`fetch sub: ${subRes.status}`);
      const subData = await subRes.json();
      const subItemId = subData?.items?.data?.[0]?.id;
      if (!subItemId) throw new Error("no subscription item id");
      // Now update quantity to 5 using the item ID
      await stripeCall(`/subscriptions/${stack.subId}`, {
        "items[0][id]": subItemId,
        "items[0][quantity]": "5",
        proration_behavior: "none", // avoid pro-ration invoice
      });
      // Wait for seat_quantity to flip to 5
      const updated = await pollUntil("subscriptions", "stripe_customer_id", stack.customerId, (r) => r !== null && r.seat_quantity === 5);
      if (!updated.row) return { name: "UPDATE", pass: false, reason: `seat_quantity did not flip to 5 after ${updated.attempts}s`, ms: Math.round(performance.now() - t0), details: { initial_seat: initial.row.seat_quantity } };
      return { name: "UPDATE", pass: true, ms: Math.round(performance.now() - t0), details: { pollAttempts: updated.attempts, seat_quantity: updated.row.seat_quantity } };
    } catch (e) {
      return { name: "UPDATE", pass: false, reason: String(e).slice(0, 200), ms: Math.round(performance.now() - t0) };
    } finally {
      if (stack) await deleteStripeStack(stack.customerId, stack.subId);
      await cleanupTestFixtures(fixtures);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // PHASE 3 — CANCEL (subscription.deleted)
  // ══════════════════════════════════════════════════════════════════════
  async function phase_CANCEL(): Promise<PhaseResult> {
    const t0 = performance.now();
    const fixtures = await createTestFixtures("cancel").catch((e) => ({ error: String(e) }));
    if ("error" in fixtures) return { name: "CANCEL", pass: false, reason: `setup: ${fixtures.error}`, ms: Math.round(performance.now() - t0) };
    let stack: { customerId: string; subId: string } | null = null;
    try {
      stack = await createStripeStack(fixtures.companyId, fixtures.email);
      const created = await pollUntil("subscriptions", "stripe_customer_id", stack.customerId, (r) => r !== null && r.status === "active");
      if (!created.row) return { name: "CANCEL", pass: false, reason: "initial CREATE never landed", ms: Math.round(performance.now() - t0) };
      // Cancel the sub
      await stripeCall(`/subscriptions/${stack.subId}`, {}, "DELETE");
      stack.subId = ""; // mark as deleted so cleanup doesn't try again
      // Wait for status to flip to canceled
      const canceled = await pollUntil("subscriptions", "stripe_customer_id", stack.customerId, (r) => r !== null && r.status === "canceled");
      if (!canceled.row) return { name: "CANCEL", pass: false, reason: `status did not flip to canceled after ${canceled.attempts}s`, ms: Math.round(performance.now() - t0) };
      return { name: "CANCEL", pass: true, ms: Math.round(performance.now() - t0), details: { pollAttempts: canceled.attempts, status: canceled.row.status } };
    } catch (e) {
      return { name: "CANCEL", pass: false, reason: String(e).slice(0, 200), ms: Math.round(performance.now() - t0) };
    } finally {
      if (stack) await deleteStripeStack(stack.customerId, stack.subId);
      await cleanupTestFixtures(fixtures);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // PHASE 4 — CUSTOMER_DELETE (R-19 #6)
  // ══════════════════════════════════════════════════════════════════════
  async function phase_CUSTOMER_DELETE(): Promise<PhaseResult> {
    const t0 = performance.now();
    const fixtures = await createTestFixtures("custdel").catch((e) => ({ error: String(e) }));
    if ("error" in fixtures) return { name: "CUSTOMER_DELETE", pass: false, reason: `setup: ${fixtures.error}`, ms: Math.round(performance.now() - t0) };
    let stack: { customerId: string; subId: string } | null = null;
    try {
      stack = await createStripeStack(fixtures.companyId, fixtures.email);
      await pollUntil("subscriptions", "stripe_customer_id", stack.customerId, (r) => r !== null && r.status === "active");
      // Delete customer (Stripe auto-cancels the subscription)
      await stripeCall(`/customers/${stack.customerId}`, {}, "DELETE");
      stack.customerId = ""; stack.subId = "";
      // Wait for stripe_customer_id to be NULLed
      // We can't poll by stripe_customer_id (it's been nullified). Poll by company_id instead.
      const deleted = await pollUntil("subscriptions", "company_id", fixtures.companyId,
        (r) => r !== null && r.stripe_customer_id === null && r.status === "canceled");
      if (!deleted.row) return { name: "CUSTOMER_DELETE", pass: false, reason: `IDs not nullified after ${deleted.attempts}s`, ms: Math.round(performance.now() - t0) };
      return { name: "CUSTOMER_DELETE", pass: true, ms: Math.round(performance.now() - t0), details: { pollAttempts: deleted.attempts, status: deleted.row.status, stripe_customer_id: deleted.row.stripe_customer_id } };
    } catch (e) {
      return { name: "CUSTOMER_DELETE", pass: false, reason: String(e).slice(0, 200), ms: Math.round(performance.now() - t0) };
    } finally {
      if (stack) await deleteStripeStack(stack.customerId, stack.subId);
      await cleanupTestFixtures(fixtures);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // PHASE 5 — UNMAPPED_PRICE (negative test: stripe_unmapped_events should fire)
  // ══════════════════════════════════════════════════════════════════════
  async function phase_UNMAPPED_PRICE(): Promise<PhaseResult> {
    const t0 = performance.now();
    const fixtures = await createTestFixtures("unmapped").catch((e) => ({ error: String(e) }));
    if ("error" in fixtures) return { name: "UNMAPPED_PRICE", pass: false, reason: `setup: ${fixtures.error}`, ms: Math.round(performance.now() - t0) };
    let stack: { customerId: string; subId: string } | null = null;
    let unmappedPriceId: string | null = null;
    try {
      // Create a one-off product + price NOT in any env var
      const prod = await stripeCall("/products", { name: `e2e-unmapped-${runId}` });
      const prodId = prod!.id as string;
      const price = await stripeCall("/prices", { product: prodId, unit_amount: "100", currency: "usd", "recurring[interval]": "month" });
      unmappedPriceId = price!.id as string;
      stack = await createStripeStack(fixtures.companyId, fixtures.email, { priceOverride: unmappedPriceId });
      // The webhook should log to stripe_unmapped_events because lookupPlanByPriceEnv returns null
      const result = await pollUntil("stripe_unmapped_events", "user_id", fixtures.userId, (r) => r !== null);
      if (!result.row) {
        // Try by customer_id since that's what the handler logs
        const altResult = await pollUntil("stripe_unmapped_events", "customer_id", stack.customerId, (r) => r !== null, 3);
        if (!altResult.row) return { name: "UNMAPPED_PRICE", pass: false, reason: "stripe_unmapped_events row never appeared", ms: Math.round(performance.now() - t0) };
        return { name: "UNMAPPED_PRICE", pass: true, ms: Math.round(performance.now() - t0), details: { pollAttempts: altResult.attempts, retry_count: altResult.row.retry_count } };
      }
      return { name: "UNMAPPED_PRICE", pass: true, ms: Math.round(performance.now() - t0), details: { pollAttempts: result.attempts, retry_count: result.row.retry_count } };
    } catch (e) {
      return { name: "UNMAPPED_PRICE", pass: false, reason: String(e).slice(0, 200), ms: Math.round(performance.now() - t0) };
    } finally {
      // Cleanup: delete stripe_unmapped_events row, stripe stack, fixtures
      try { await admin.from("stripe_unmapped_events").delete().eq("user_id", fixtures.userId); } catch {}
      if (stack) await deleteStripeStack(stack.customerId, stack.subId);
      // Note: Stripe doesn't allow programmatically deleting prices once created in test mode.
      // They auto-purge after ~30 days. The unmappedPriceId leaks; acceptable for test mode.
      await cleanupTestFixtures(fixtures);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // PHASE 6 — DPA_BLOCK (R-19 #16: B2B sub without DPA must be blocked)
  // ══════════════════════════════════════════════════════════════════════
  async function phase_DPA_BLOCK(): Promise<PhaseResult> {
    const t0 = performance.now();
    // Create fixtures WITHOUT DPA
    const fixtures = await createTestFixtures("dpablock", { withDPA: false }).catch((e) => ({ error: String(e) }));
    if ("error" in fixtures) return { name: "DPA_BLOCK", pass: false, reason: `setup: ${fixtures.error}`, ms: Math.round(performance.now() - t0) };
    let stack: { customerId: string; subId: string } | null = null;
    try {
      stack = await createStripeStack(fixtures.companyId, fixtures.email);
      // Webhook should: (a) not write subscriptions row, (b) write ops_alerts row
      // Wait briefly for the webhook to process
      await new Promise((r) => setTimeout(r, 6000));
      // Verify no subscriptions row was written
      const { data: subRow } = await admin.from("subscriptions").select("id").eq("company_id", fixtures.companyId).maybeSingle();
      if (subRow) return { name: "DPA_BLOCK", pass: false, reason: "subscriptions row was written despite missing DPA — security bypass!", ms: Math.round(performance.now() - t0) };
      // Verify ops_alerts row exists
      const { data: alerts } = await admin.from("ops_alerts").select("*").eq("category", "subscription_without_dpa").limit(20);
      const ourAlert = (alerts || []).find((a) => {
        const md = (a.metadata as Record<string, unknown>) || {};
        return md.company_id === fixtures.companyId;
      });
      if (!ourAlert) return { name: "DPA_BLOCK", pass: false, reason: "ops_alerts row not written — DPA gate logged nothing!", ms: Math.round(performance.now() - t0) };
      return { name: "DPA_BLOCK", pass: true, ms: Math.round(performance.now() - t0), details: { alert_id: ourAlert.id, severity: ourAlert.severity } };
    } catch (e) {
      return { name: "DPA_BLOCK", pass: false, reason: String(e).slice(0, 200), ms: Math.round(performance.now() - t0) };
    } finally {
      // Cleanup the ops_alerts row we triggered
      try { await admin.from("ops_alerts").delete().eq("category", "subscription_without_dpa").like("title", `%${fixtures.companyId}%`); } catch {}
      if (stack) await deleteStripeStack(stack.customerId, stack.subId);
      await cleanupTestFixtures(fixtures);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // RUN ALL PHASES
  // ══════════════════════════════════════════════════════════════════════
  const phases: PhaseResult[] = [];
  phases.push(await phase_CREATE());
  phases.push(await phase_UPDATE());
  phases.push(await phase_CANCEL());
  phases.push(await phase_CUSTOMER_DELETE());
  phases.push(await phase_UNMAPPED_PRICE());
  phases.push(await phase_DPA_BLOCK());

  const totalMs = Math.round(performance.now() - runStart);
  const allPass = phases.every((p) => p.pass);
  return jsonResponse({
    pass: allPass,
    runId,
    passed: phases.filter((p) => p.pass).length,
    failed: phases.filter((p) => !p.pass).length,
    total: phases.length,
    totalMs,
    phases,
  }, 200, corsHeaders);
});
