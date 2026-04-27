// SOSphere - Stripe Webhook Handler
// v6 (B-17): civilian plans + civilian subscriptions schema.
// v7 (G-29 B-20 2026-04-26): event-id dedup. Pre-fix Stripe at-least-once
//    delivery could fire `customer.subscription.deleted` twice within ms,
//    re-running the cancel update + re-broadcasting. Now we INSERT the
//    event_id into `processed_stripe_events` BEFORE business logic; if
//    the insert is a no-op (ON CONFLICT DO NOTHING) we return 200 with
//    `{deduped: true}` and skip processing.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") || "";
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function verifyStripeSignature(body: string, sigHeader: string, secret: string): Promise<boolean> {
  try {
    const parts = Object.fromEntries(
      sigHeader.split(",").map((s) => { const [k, ...v] = s.split("="); return [k, v.join("=")]; }),
    );
    const t = parts.t; const v1 = parts.v1;
    if (!t || !v1) return false;
    // W3-7 (B-20, 2026-04-26): one-sided check + small future-skew tolerance.
    // Stripe's recommended check is `now - t > tolerance` only. The prior
    // `Math.abs` accepted a `t` up to 5 minutes in the FUTURE, doubling
    // the replay window. We now accept up to 60s of clock drift forward
    // (NTP-skew tolerance) and 300s backward (Stripe's recommendation).
    const tNum = Number(t);
    const now = Date.now() / 1000;
    if (!Number.isFinite(tNum)) return false;
    if (now - tNum > 300) return false;   // too old → reject
    if (tNum - now > 60)  return false;   // future-dated by > 60s → reject
    const signedPayload = `${t}.${body}`;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
    const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hex.length !== v1.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

interface StripeSubscription {
  id: string; customer: string; status: string;
  current_period_end: number; cancel_at_period_end: boolean;
  items: { data: Array<{ price: { id: string; product: string } }> };
  metadata?: Record<string, string>;
}

class UnmappedPriceError extends Error {
  constructor(public priceId: string | undefined) {
    super(`Unmapped Stripe price id: ${priceId ?? "(missing)"}`);
    this.name = "UnmappedPriceError";
  }
}

async function upsertSubscription(supabase: ReturnType<typeof createClient>, userId: string, sub: StripeSubscription, planIdOverride?: string): Promise<void> {
  const priceId = sub.items?.data?.[0]?.price?.id;
  const planId = planIdOverride || sub.metadata?.planId || lookupPlanByPriceEnv(priceId);
  if (!planId) {
    console.warn(`[stripe-webhook] unmapped price id=${priceId ?? "(none)"} (user=${userId})`);
    throw new UnmappedPriceError(priceId);
  }
  await supabase.from("subscriptions").upsert({
    user_id: userId,
    stripe_customer_id: sub.customer,
    stripe_subscription_id: sub.id,
    stripe_price_id: priceId,
    tier: planId,
    status: sub.status,
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    cancel_at_period_end: sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
}

function lookupPlanByPriceEnv(priceId: string | undefined): string | null {
  if (!priceId) return null;
  const plans = ["starter", "growth", "business", "enterprise", "basic", "elite"];
  const cycles = ["monthly", "annual"];
  for (const p of plans) {
    for (const c of cycles) {
      if (Deno.env.get(`STRIPE_PRICE_${p.toUpperCase()}_${c.toUpperCase()}`) === priceId) return p;
    }
  }
  return null;
}

async function stripeGet(path: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET}` },
  });
  return res.json();
}

// G-29 (B-20): atomic event-id dedup. Returns true if this is the FIRST
// time we have seen this event_id; false if it's a duplicate (already
// processed). Safe-default on DB error: return true so we DO process
// the event — missing the dedup row is far less harmful than failing
// to record a real subscription change.
async function claimStripeEventOnce(
  supabase: ReturnType<typeof createClient>,
  evtId: string,
  evtType: string,
): Promise<boolean> {
  if (!evtId || evtId === "(unknown)") return true;
  try {
    const { data, error } = await supabase
      .from("processed_stripe_events")
      .insert({ event_id: evtId, event_type: evtType })
      .select("event_id")
      .maybeSingle();
    if (error) {
      // Postgres unique-violation code = 23505. supabase-js surfaces it
      // as { code: "23505" }. ANY other error is treated as fail-OPEN.
      if ((error as any)?.code === "23505") return false;
      console.warn(`[stripe-webhook] claimStripeEventOnce DB error (fail-open):`, error.message);
      return true;
    }
    return !!data;
  } catch (err) {
    console.warn(`[stripe-webhook] claimStripeEventOnce threw (fail-open):`, err);
    return true;
  }
}

serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
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
  try { event = JSON.parse(body); } catch { return new Response("Invalid JSON", { status: 400 }); }

  const supabase = createClient(SUPA_URL, SUPA_KEY);
  const evtId = event?.id || "(unknown)";
  const evtType = event?.type || "(unknown)";

  // G-29: dedup BEFORE business logic. Idempotent on event_id.
  const isFirstSeen = await claimStripeEventOnce(supabase, evtId, evtType);
  if (!isFirstSeen) {
    console.log(`[stripe-webhook] duplicate event ignored: id=${evtId} type=${evtType}`);
    return new Response(JSON.stringify({ received: true, deduped: true, id: evtId, type: evtType }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.client_reference_id;
        const subId = session.subscription;
        if (!userId || !subId) {
          console.log(`[stripe-webhook] ${evtType} id=${evtId} missing userId/subId, skipping`);
          break;
        }
        const sub = await stripeGet(`/subscriptions/${subId}`);
        await upsertSubscription(supabase, userId, sub, session.metadata?.planId);
        console.log(`[stripe-webhook] ${evtType} id=${evtId} user=${userId} sub=${subId}`);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const { data: row, error: selErr } = await supabase
          .from("subscriptions").select("user_id")
          .eq("stripe_customer_id", sub.customer).maybeSingle();
        if (selErr) {
          console.error(`[stripe-webhook] ${evtType} id=${evtId} DB select failed:`, selErr);
          return new Response(JSON.stringify({ error: "db_read_failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
        if (!row?.user_id) {
          console.warn(`[stripe-webhook] ${evtType} id=${evtId} no user mapped to customer ${sub.customer}`);
          break;
        }
        await upsertSubscription(supabase, row.user_id, sub);
        console.log(`[stripe-webhook] ${evtType} id=${evtId} user=${row.user_id}`);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const { error: updErr } = await supabase.from("subscriptions").update({
          status: "canceled", cancel_at_period_end: true, updated_at: new Date().toISOString(),
        }).eq("stripe_subscription_id", sub.id);
        if (updErr) {
          console.error(`[stripe-webhook] ${evtType} id=${evtId} DB update failed:`, updErr);
          return new Response(JSON.stringify({ error: "db_update_failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
        console.log(`[stripe-webhook] ${evtType} id=${evtId} sub=${sub.id}`);
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object;
        if (inv.subscription) {
          const { error: updErr } = await supabase.from("subscriptions")
            .update({ status: "past_due", updated_at: new Date().toISOString() })
            .eq("stripe_subscription_id", inv.subscription);
          if (updErr) {
            console.error(`[stripe-webhook] ${evtType} id=${evtId} DB update failed:`, updErr);
            return new Response(JSON.stringify({ error: "db_update_failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
          }
        }
        console.log(`[stripe-webhook] ${evtType} id=${evtId} sub=${inv.subscription}`);
        break;
      }
      default:
        console.log(`[stripe-webhook] ${evtType} id=${evtId} ignored (not handled)`);
        break;
    }
  } catch (err) {
    if (err instanceof UnmappedPriceError) {
      // CRIT-#9 (2026-04-27): previously this DELETEd the dedup row
      // unconditionally — every Stripe retry (~24 over 3 days) re-attempted
      // and got the same error, flooding logs and stripe_unmapped_events.
      // Now we keep the dedup row after retry_count >= 24 so Stripe sees
      // a clean 200 next time and stops retrying. The event remains in
      // stripe_unmapped_events for ops reconciliation.
      let shouldRollback = true;
      try {
        const { data: existing } = await supabase
          .from("stripe_unmapped_events")
          .select("retry_count")
          .eq("event_id", evtId)
          .maybeSingle();
        const prevRetryCount = (existing?.retry_count as number | undefined) ?? 0;
        if (prevRetryCount >= 24) {
          // Stripe's effective retry budget exhausted — let the event
          // sit in the recovery table and tell Stripe "OK" so it stops.
          shouldRollback = false;
          console.warn(`[stripe-webhook] event ${evtId} exceeded retry budget (${prevRetryCount}); breaking loop, leaving dedup row in place`);
        }
      } catch { /* probe is best-effort */ }
      if (shouldRollback) {
        try {
          await supabase.from("processed_stripe_events").delete().eq("event_id", evtId);
        } catch { /* best-effort */ }
      }
      try {
        const userId = (event?.data?.object?.client_reference_id as string | undefined)
          || (event?.data?.object?.metadata?.userId as string | undefined) || null;
        const customerId = (event?.data?.object?.customer as string | undefined) || null;
        const { data: persistData, error: persistErr } = await supabase.rpc("record_stripe_unmapped_event", {
          p_event_id: evtId, p_event_type: evtType, p_price_id: err.priceId ?? null,
          p_user_id: userId, p_customer_id: customerId, p_raw_event: event, p_reason: "unmapped_price",
        });
        if (persistErr) console.error(`[stripe-webhook] CRITICAL persist failed id=${evtId}:`, persistErr);
        else {
          const row = Array.isArray(persistData) ? persistData[0] : persistData;
          console.warn(`[stripe-webhook] UNMAPPED_PRICE persisted id=${evtId} retry_count=${row?.out_retry_count ?? "?"}`);
        }
      } catch (persistEx) {
        console.error(`[stripe-webhook] CRITICAL stripe_unmapped_events threw id=${evtId}:`, persistEx);
      }
      // CRIT-#9: when retry budget exhausted, return 200 so Stripe
      // doesn't keep retrying. Operator gets the row in stripe_unmapped_events.
      const finalStatus = shouldRollback ? 503 : 200;
      const finalBody = shouldRollback
        ? { error: "unmapped_price_pending_recovery", priceId: err.priceId }
        : { received: true, deferred: true, reason: "unmapped_price_retry_budget_exhausted", event_id: evtId };
      return new Response(JSON.stringify(finalBody),
        { status: finalStatus, headers: { "Content-Type": "application/json" } });
    }
    // Roll back dedup row so Stripe can retry against a healthy worker.
    try { await supabase.from("processed_stripe_events").delete().eq("event_id", evtId); } catch {}
    console.error(`[stripe-webhook] ${evtType} id=${evtId} handler error (recoverable):`, err);
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ received: true, id: evtId, type: evtType }), {
    headers: { "Content-Type": "application/json" },
  });
});
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  