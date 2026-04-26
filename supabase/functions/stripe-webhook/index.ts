// ═══════════════════════════════════════════════════════════════
// SOSphere — Stripe Webhook Handler (P3-#10)
// Handles: POST /functions/v1/stripe-webhook
//
// Stripe sends all subscription lifecycle events here. We persist
// the active subscription state to the `subscriptions` table so
// tier gates across the app can read a single source of truth.
//
// Events we care about:
//   checkout.session.completed          — first-time subscribe
//   customer.subscription.created
//   customer.subscription.updated       — plan change, renewal, etc.
//   customer.subscription.deleted       — cancellation
//   invoice.payment_failed              — mark past_due
//
// Security:
//   • Signature verification via STRIPE_WEBHOOK_SECRET (mandatory).
//     Without this anyone could POST fake events and flip a user to
//     Elite for free. We reject unsigned requests with 400.
//   • Runs under the service-role key so it can write to the
//     subscriptions table regardless of RLS.
//
// Env vars required:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") || "";
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ─────────────────────────────────────────────────────────────
// Signature verification — Stripe's spec: the signed payload is
// `t.{body}` and the signature is HMAC-SHA256 with the webhook
// secret. The header format is `t=...,v1=...,v1=...`. We tolerate
// the documented 5-minute clock skew.
// ─────────────────────────────────────────────────────────────
async function verifyStripeSignature(
  body: string,
  sigHeader: string,
  secret: string,
): Promise<boolean> {
  try {
    const parts = Object.fromEntries(
      sigHeader.split(",").map((s) => {
        const [k, ...v] = s.split("=");
        return [k, v.join("=")];
      }),
    );
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1) return false;

    // 5-minute replay window
    const age = Math.abs(Date.now() / 1000 - Number(t));
    if (!Number.isFinite(age) || age > 300) return false;

    const signedPayload = `${t}.${body}`;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
    const hex = Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    // Constant-time compare
    if (hex.length !== v1.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Subscription upsert. We flatten Stripe's shape to the columns we
// actually consult elsewhere (tier, status, current_period_end).
// ─────────────────────────────────────────────────────────────
interface StripeSubscription {
  id: string;
  customer: string;
  status: string;                // "active" | "trialing" | "past_due" | "canceled" | ...
  current_period_end: number;    // unix seconds
  cancel_at_period_end: boolean;
  items: { data: Array<{ price: { id: string; product: string } }> };
  metadata?: Record<string, string>;
}

// B-H4: reject unmapped price IDs instead of silent downgrade — signal
// to the caller that the plan could not be resolved so the webhook
// handler can return a 400 rather than silently flipping the user to
// "starter" (which previously let an unknown premium priceId land a
// paying user on a free-tier row).
class UnmappedPriceError extends Error {
  constructor(public priceId: string | undefined) {
    super(`Unmapped Stripe price id: ${priceId ?? "(missing)"}`);
    this.name = "UnmappedPriceError";
  }
}

async function upsertSubscription(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  sub: StripeSubscription,
  planIdOverride?: string,
): Promise<void> {
  const priceId = sub.items?.data?.[0]?.price?.id;
  // Plan id recovery: prefer explicit override (Checkout session metadata),
  // then subscription metadata, then env-mapped price lookup.
  const planId = planIdOverride || sub.metadata?.planId || lookupPlanByPriceEnv(priceId);

  // B-H4: reject unmapped price IDs instead of silent downgrade
  if (!planId) {
    console.warn(
      `[stripe-webhook] unmapped price id=${priceId ?? "(none)"} — refusing to default to 'starter' (user=${userId})`
    );
    throw new UnmappedPriceError(priceId);
  }

  await supabase.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_customer_id: sub.customer,
      stripe_subscription_id: sub.id,
      stripe_price_id: priceId,
      tier: planId,
      status: sub.status,
      current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      cancel_at_period_end: sub.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}

function lookupPlanByPriceEnv(priceId: string | undefined): string | null {
  if (!priceId) return null;
  // B-17 (2026-04-25): added civilian plans so the webhook resolves
  // basic/elite priceIds without falling through to UnmappedPriceError.
  const plans = ["starter", "growth", "business", "enterprise", "basic", "elite"];
  const cycles = ["monthly", "annual"];
  for (const p of plans) {
    for (const c of cycles) {
      if (Deno.env.get(`STRIPE_PRICE_${p.toUpperCase()}_${c.toUpperCase()}`) === priceId) return p;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Stripe GET helper — used to hydrate a full subscription object
// when a webhook only gives us its id (e.g. checkout.session.completed).
// ─────────────────────────────────────────────────────────────
async function stripeGet(path: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET}` },
  });
  return res.json();
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!WEBHOOK_SECRET) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const sig = req.headers.get("stripe-signature") || "";
  const body = await req.text();
  const ok = await verifyStripeSignature(body, sig, WEBHOOK_SECRET);
  if (!ok) {
    console.warn("[stripe-webhook] signature verification failed");
    return new Response("Invalid signature", { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const supabase = createClient(SUPA_URL, SUPA_KEY);
  const evtId = event?.id || "(unknown)";
  const evtType = event?.type || "(unknown)";

  // B-H3: differentiate recoverable vs idempotent errors
  // - Recoverable (DB/Supabase/network failures) → 500 so Stripe retries.
  // - Idempotent (duplicate event, unmapped customer that resolves later
  //   via a different event ordering) → 200 so Stripe stops retrying.
  // - Config/validation errors (unmapped priceId, bad JSON) → 400.
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.client_reference_id;
        const subId = session.subscription;
        if (!userId || !subId) {
          console.log(`[stripe-webhook] ${evtType} id=${evtId} — missing userId/subId, skipping`);
          break;
        }

        // Hydrate full subscription object — the session only has the id.
        const sub = await stripeGet(`/subscriptions/${subId}`);
        await upsertSubscription(supabase, userId, sub, session.metadata?.planId);
        console.log(`[stripe-webhook] ${evtType} id=${evtId} user=${userId} sub=${subId}`);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        // Resolve userId from our own table via the customer id — we
        // wrote it during checkout.session.completed.
        const { data: row, error: selErr } = await supabase
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_customer_id", sub.customer)
          .maybeSingle();
        if (selErr) {
          // B-H3: DB read failure is recoverable — let Stripe retry.
          console.error(`[stripe-webhook] ${evtType} id=${evtId} DB select failed:`, selErr);
          return new Response(JSON.stringify({ error: "db_read_failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (!row?.user_id) {
          // B-H3: idempotent — no mapped user yet (ordering). 200 so
          // Stripe stops retrying; checkout.session.completed will
          // establish the mapping on its own retry cycle.
          console.warn(
            `[stripe-webhook] ${evtType} id=${evtId} no user mapped to customer ${sub.customer} — skipping`,
          );
          break;
        }
        await upsertSubscription(supabase, row.user_id, sub);
        console.log(`[stripe-webhook] ${evtType} id=${evtId} user=${row.user_id}`);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const { error: updErr } = await supabase
          .from("subscriptions")
          .update({
            status: "canceled",
            cancel_at_period_end: true,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", sub.id);
        if (updErr) {
          console.error(`[stripe-webhook] ${evtType} id=${evtId} DB update failed:`, updErr);
          return new Response(JSON.stringify({ error: "db_update_failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        console.log(`[stripe-webhook] ${evtType} id=${evtId} sub=${sub.id}`);
        break;
      }

      case "invoice.payment_failed": {
        const inv = event.data.object;
        // Flip status to past_due so the app can nudge the user.
        if (inv.subscription) {
          const { error: updErr } = await supabase
            .from("subscriptions")
            .update({ status: "past_due", updated_at: new Date().toISOString() })
            .eq("stripe_subscription_id", inv.subscription);
          if (updErr) {
            console.error(`[stripe-webhook] ${evtType} id=${evtId} DB update failed:`, updErr);
            return new Response(JSON.stringify({ error: "db_update_failed" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
        }
        console.log(`[stripe-webhook] ${evtType} id=${evtId} sub=${inv.subscription}`);
        break;
      }

      default:
        // B-H3: no-op for events we don't handle — log and return 200.
        console.log(`[stripe-webhook] ${evtType} id=${evtId} ignored (not handled)`);
        break;
    }
  } catch (err) {
    // ─────────────────────────────────────────────────────────────
    // B-13 (2026-04-25): the prior implementation returned 400 here,
    // which made Stripe stop retrying. The customer paid, our DB
    // never recorded the subscription. The fix is two-fold:
    //   1. Persist the raw event to stripe_unmapped_events for
    //      forensic recovery + ops visibility (idempotent on event_id).
    //   2. Return 503 so Stripe RETRIES for ~3 days. Once the operator
    //      adds the missing STRIPE_PRICE_* env mapping the next retry
    //      succeeds and a normal subscriptions row is upserted.
    // The prior 'unmapped_price = bad config = 400' framing was wrong:
    // the customer is paying NOW; downtime/misconfig is OUR problem,
    // not theirs. Treat it as a recoverable server condition.
    // ─────────────────────────────────────────────────────────────
    if (err instanceof UnmappedPriceError) {
      // Best-effort persist; even if this fails we still 5xx so Stripe
      // retries. Idempotent on event_id.
      try {
        const userId = (event?.data?.object?.client_reference_id as string | undefined)
          || (event?.data?.object?.metadata?.userId as string | undefined)
          || null;
        const customerId = (event?.data?.object?.customer as string | undefined) || null;
        // F-D (2026-04-25): use the SECURITY DEFINER RPC so retry_count
        // actually increments on conflict. supabase-js .upsert overwrites
        // and never increments computed columns.
        const { data: persistData, error: persistErr } = await supabase.rpc(
          "record_stripe_unmapped_event",
          {
            p_event_id: evtId,
            p_event_type: evtType,
            p_price_id: err.priceId ?? null,
            p_user_id: userId,
            p_customer_id: customerId,
            p_raw_event: event,
            p_reason: "unmapped_price",
          },
        );
        if (persistErr) {
          console.error(
            `[stripe-webhook] CRITICAL: persist of unmapped_price failed id=${evtId}:`,
            persistErr,
          );
        } else {
          // Surface the live retry_count + last_seen so ops dashboards
          // can correlate "Stripe is still retrying this event".
          const row = Array.isArray(persistData) ? persistData[0] : persistData;
          console.warn(
            `[stripe-webhook] UNMAPPED_PRICE persisted id=${evtId} ` +
            `retry_count=${row?.out_retry_count ?? "?"} ` +
            `last_seen=${row?.out_last_seen ?? "?"}`,
          );
        }
      } catch (persistEx) {
        console.error(
          `[stripe-webhook] CRITICAL: stripe_unmapped_events persist threw id=${evtId}:`,
          persistEx,
        );
      }
      // 503 Service Unavailable — Stripe will retry on 5xx. We do NOT
      // return 400 anymore: a paying customer must never be silently
      // dropped because of our config gap.
      return new Response(
        JSON.stringify({
          error: "unmapped_price_pending_recovery",
          priceId: err.priceId,
          message: "Event persisted for forensic recovery. Webhook will retry.",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    // Recoverable network / runtime / Supabase errors — let Stripe retry.
    console.error(`[stripe-webhook] ${evtType} id=${evtId} handler error (recoverable):`, err);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ received: true, id: evtId, type: evtType }), {
    headers: { "Content-Type": "application/json" },
  });
});
