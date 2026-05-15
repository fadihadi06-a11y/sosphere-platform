// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — stripe-e2e-test-probe (R-19 #18)
// ─────────────────────────────────────────────────────────────────────────
// THE GAP THIS CLOSES
//   R-19 Phase 1-5 unit/contract tests + stripe-webhook-test-probe verified
//   the webhook IN ISOLATION. But the verify_jwt=true bug (#17) showed that
//   gateway-level config can break the integration even when our code is
//   correct. To catch the next "config drift" class of bug we need a TRUE
//   end-to-end test: real Stripe API → real webhook → real DB row.
//
// WHAT THIS PROBE DOES
//   PHASE 1 — DB SETUP
//     • Creates a test auth user (e2e-probe-<runId>@sosphere.internal)
//     • Creates a test company (name='SOSphere e2e probe <runId>')
//     • Creates a DPA acceptance row (R-19 #16 requires this for B2B)
//   PHASE 2 — STRIPE
//     • Creates a Stripe customer (metadata.companyId=<test company>)
//     • Attaches pm_card_visa (Stripe test payment method, always works)
//     • Creates a subscription using STRIPE_PRICE_STARTER_MONTHLY
//   PHASE 3 — WAIT FOR WEBHOOK
//     • Polls subscriptions table every 1s for up to 15s waiting for the
//       row created by customer.subscription.created webhook
//   PHASE 4 — CLEANUP (best-effort, always runs)
//     • DELETE Stripe subscription, customer
//     • DELETE subscriptions row, DPA row, company row, auth user
//
// AUTH
//   PROBE_SECRET bearer (same as the other 6 probes).
//
// REQUIRED SECRETS
//   PROBE_SECRET, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   STRIPE_SECRET_KEY, STRIPE_PRICE_STARTER_MONTHLY
//
// NOT ON CRON
//   Manual / workflow_dispatch only. Each run creates + deletes 1 Stripe
//   customer + 1 subscription in test mode. Stripe Dashboard will show the
//   activity for ~30 days then they're auto-purged from test mode.
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

interface StepResult { name: string; ok: boolean; ms: number; data?: unknown; error?: string }

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, corsHeaders);

  const probeSecret = Deno.env.get("PROBE_SECRET");
  if (!probeSecret || probeSecret.length < 16) {
    return jsonResponse({ error: "probe_misconfigured" }, 500, corsHeaders);
  }
  const authHeader = req.headers.get("Authorization") || "";
  if (!constantTimeEquals(authHeader, `Bearer ${probeSecret}`)) {
    return jsonResponse({ error: "unauthorized" }, 401, corsHeaders);
  }

  const supaUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const priceId   = Deno.env.get("STRIPE_PRICE_STARTER_MONTHLY");
  if (!supaUrl || !serviceKey || !stripeKey || !priceId) {
    return jsonResponse({
      error: "env_missing",
      hint: "Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, STRIPE_PRICE_STARTER_MONTHLY",
    }, 500, corsHeaders);
  }
  if (!stripeKey.startsWith("sk_test_")) {
    return jsonResponse({ error: "live_mode_refused", hint: "This probe is TEST MODE only" }, 400, corsHeaders);
  }

  const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });
  const runId = crypto.randomUUID().slice(0, 8);
  const runStart = performance.now();
  const steps: StepResult[] = [];

  // Track created resources for cleanup, even on failure
  let testUserId: string | null = null;
  let testCompanyId: string | null = null;
  let testDpaId: string | null = null;
  let stripeCustomerId: string | null = null;
  let stripeSubscriptionId: string | null = null;
  // R-19 #18 fix: pm_card_visa is a SHARED test token. When attached to a
  // customer, Stripe CLONES it and gives the clone a new pm_xxx ID. We
  // must capture and use that cloned ID — the bare pm_card_visa string
  // is only valid as an attach source, not as a default_payment_method.
  let attachedPaymentMethodId: string | null = null;

  async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    const t0 = performance.now();
    try {
      const data = await fn();
      steps.push({ name, ok: true, ms: Math.round(performance.now() - t0) });
      return data;
    } catch (e) {
      steps.push({ name, ok: false, ms: Math.round(performance.now() - t0), error: String(e).slice(0, 300) });
      return null;
    }
  }

  async function stripeCall(path: string, params: Record<string, string>): Promise<Record<string, unknown> | null> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) body.append(k, v);
    const res = await fetch(`${STRIPE_API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "(no body)");
      throw new Error(`Stripe ${path}: ${res.status} ${txt.slice(0, 200)}`);
    }
    return res.json();
  }

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 1 — DB SETUP
  // ════════════════════════════════════════════════════════════════════════
  const testEmail = `e2e-probe-${runId}@sosphere.internal`;
  await step("create_test_user", async () => {
    const password = crypto.randomUUID() + crypto.randomUUID();
    const { data, error } = await admin.auth.admin.createUser({
      email: testEmail, password, email_confirm: true,
    });
    if (error || !data?.user) throw new Error(error?.message ?? "no user");
    testUserId = data.user.id;
  });

  await step("create_test_company", async () => {
    if (!testUserId) throw new Error("no test user");
    const { data, error } = await admin.from("companies").insert({
      name: `SOSphere e2e probe ${runId}`,
      owner_user_id: testUserId,
      plan: "starter",
      country: "SA",
      employee_estimate: 5,
    }).select("id").single();
    if (error || !data) throw new Error(error?.message ?? "no insert");
    testCompanyId = data.id as string;
  });

  await step("create_test_dpa_acceptance", async () => {
    if (!testCompanyId || !testUserId) throw new Error("setup not complete");
    const { data, error } = await admin.from("company_dpa_acceptances").insert({
      company_id: testCompanyId,
      dpa_version: "v1-e2e-probe",
      signer_user_id: testUserId,
      signer_full_name: "E2E Probe Tester",
      signer_title: "Probe Runner",
      signer_email: testEmail,
    }).select("id").single();
    if (error || !data) throw new Error(error?.message ?? "no insert");
    testDpaId = data.id as string;
  });

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 2 — STRIPE
  // ════════════════════════════════════════════════════════════════════════
  await step("stripe_create_customer", async () => {
    if (!testCompanyId) throw new Error("no company");
    const cust = await stripeCall("/customers", {
      email: testEmail,
      "metadata[companyId]": testCompanyId,
      "metadata[probe_run_id]": runId,
    });
    stripeCustomerId = cust!.id as string;
  });

  await step("stripe_attach_payment_method", async () => {
    if (!stripeCustomerId) throw new Error("no customer");
    const result = await stripeCall(`/payment_methods/pm_card_visa/attach`, { customer: stripeCustomerId });
    if (!result?.id) throw new Error("no pm id returned from attach");
    attachedPaymentMethodId = result.id as string;
  });

  await step("stripe_set_default_payment_method", async () => {
    if (!stripeCustomerId || !attachedPaymentMethodId) throw new Error("no customer or pm");
    // Use the cloned PM id captured during attach (NOT the literal pm_card_visa,
    // which is the shared test token, not a customer-owned PM).
    await stripeCall(`/customers/${stripeCustomerId}`, {
      "invoice_settings[default_payment_method]": attachedPaymentMethodId,
    });
  });

  let subscriptionDebugData: Record<string, unknown> | null = null;
  await step("stripe_create_subscription", async () => {
    if (!stripeCustomerId || !testCompanyId || !attachedPaymentMethodId) throw new Error("setup incomplete");
    const sub = await stripeCall("/subscriptions", {
      customer: stripeCustomerId,
      "items[0][price]": priceId!,
      default_payment_method: attachedPaymentMethodId,
      "metadata[companyId]": testCompanyId,
      "metadata[probe_run_id]": runId,
    });
    stripeSubscriptionId = sub!.id as string;
    // R-19 debug: capture key Stripe payload structure so we can diagnose
    // metadata + items shape issues without console.log digging.
    subscriptionDebugData = {
      id: sub!.id,
      status: sub!.status,
      metadata: sub!.metadata,
      current_period_end_at_root: (sub as any).current_period_end ?? null,
      items_data_length: Array.isArray((sub as any).items?.data) ? (sub as any).items.data.length : null,
      items_0_price_id: (sub as any).items?.data?.[0]?.price?.id ?? null,
      items_0_current_period_end: (sub as any).items?.data?.[0]?.current_period_end ?? null,
      items_0_quantity: (sub as any).items?.data?.[0]?.quantity ?? null,
    };
  });

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 3 — WAIT FOR WEBHOOK
  // ════════════════════════════════════════════════════════════════════════
  let webhookFired = false;
  let dbSubscriptionRow: Record<string, unknown> | null = null;
  await step("poll_subscriptions_for_webhook_row", async () => {
    if (!stripeCustomerId) throw new Error("no customer to look up");
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const { data } = await admin
        .from("subscriptions")
        .select("*")
        .eq("stripe_customer_id", stripeCustomerId)
        .maybeSingle();
      if (data) {
        webhookFired = true;
        dbSubscriptionRow = data;
        return;
      }
    }
    throw new Error(`No subscriptions row appeared in ${POLL_MAX_ATTEMPTS}s of polling`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 4 — CLEANUP (best-effort, always runs)
  // ════════════════════════════════════════════════════════════════════════
  if (stripeSubscriptionId) {
    await step("cleanup_stripe_subscription", async () => {
      // Stripe cancellation = DELETE on subscription endpoint
      const res = await fetch(`${STRIPE_API}/subscriptions/${stripeSubscriptionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "(no body)");
        throw new Error(`Stripe DELETE /subscriptions/${stripeSubscriptionId}: ${res.status} ${txt.slice(0, 200)}`);
      }
    });
  }
  if (stripeCustomerId) {
    await step("cleanup_stripe_customer", async () => {
      await fetch(`${STRIPE_API}/customers/${stripeCustomerId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
    });
  }
  if (stripeCustomerId) {
    await step("cleanup_subscriptions_row", async () => {
      await admin.from("subscriptions").delete().eq("stripe_customer_id", stripeCustomerId!);
    });
  }
  if (testDpaId) {
    await step("cleanup_dpa", async () => {
      await admin.from("company_dpa_acceptances").delete().eq("id", testDpaId!);
    });
  }
  if (testCompanyId) {
    await step("cleanup_company", async () => {
      await admin.from("companies").delete().eq("id", testCompanyId!);
    });
  }
  if (testUserId) {
    await step("cleanup_test_user", async () => {
      await admin.auth.admin.deleteUser(testUserId!);
    });
  }

  const totalMs = Math.round(performance.now() - runStart);
  const allOk = steps.every((s) => s.ok);
  const setupOk = steps.slice(0, 7).every((s) => s.ok); // phases 1+2+3 (everything except cleanup)

  return jsonResponse({
    pass: setupOk && webhookFired,
    runId,
    webhookFired,
    setupSucceeded: setupOk,
    allStepsClean: allOk,
    totalMs,
    subscriptionDebugData,
    dbSubscriptionRow: dbSubscriptionRow ? {
      id: dbSubscriptionRow.id,
      company_id: dbSubscriptionRow.company_id,
      stripe_customer_id: dbSubscriptionRow.stripe_customer_id,
      stripe_subscription_id: dbSubscriptionRow.stripe_subscription_id,
      status: dbSubscriptionRow.status,
      tier: dbSubscriptionRow.tier,
      plan: dbSubscriptionRow.plan,
      seat_quantity: dbSubscriptionRow.seat_quantity,
      last_stripe_event_at: dbSubscriptionRow.last_stripe_event_at,
    } : null,
    steps,
  }, 200, corsHeaders);
});
