// SOSphere - Stripe Webhook Handler
// v8 (AUTH-5 P2 / 2026-05-06): B2B routing — metadata.companyId on the
//    Checkout Session is now treated as the canonical target for upserts.
//    Civilian (user_id) flow remains the default when companyId is absent.
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

/**
 * AUTH-5 P2 (2026-05-06): polymorphic upsert.
 *
 * Old behaviour: always wrote `user_id`, conflict-resolved on `user_id`.
 * New behaviour: caller passes EITHER `userId` or `companyId` — never
 * both. The function uses the appropriate UNIQUE constraint:
 *   - civilian: ON CONFLICT (user_id)
 *   - company:  ON CONFLICT (company_id)  ← partial unique index added
 *                                            in 20260506100000.
 *
 * The `tier`/`plan` mapping is unchanged; an unmapped price still throws
 * UnmappedPriceError so the existing recovery path (stripe_unmapped_events)
 * keeps working.
 */
type UpsertTarget = { kind: "user"; userId: string } | { kind: "company"; companyId: string };

async function upsertSubscription(
  supabase: ReturnType<typeof createClient>,
  target: UpsertTarget,
  sub: StripeSubscription,
  planIdOverride?: string,
): Promise<void> {
  const priceId = sub.items?.data?.[0]?.price?.id;
  const planId = planIdOverride || sub.metadata?.planId || lookupPlanByPriceEnv(priceId);
  if (!planId) {
    const tag = target.kind === "user" ? `user=${target.userId}` : `company=${target.companyId}`;
    console.warn(`[stripe-webhook] unmapped price id=${priceId ?? "(none)"} (${tag})`);
    throw new UnmappedPriceError(priceId);
  }
  // Trial deadline: when Stripe reports status='trialing' the subscription
  // object exposes trial_end (unix). Mirror it to subscriptions.trial_ends_at
  // so the in-app countdown stays accurate after Stripe takes over the
  // lifecycle.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trialEnd = (sub as any).trial_end;
  const row: Record<string, unknown> = {
    stripe_customer_id: sub.customer,
    stripe_subscription_id: sub.id,
    stripe_price_id: priceId,
    tier: planId,
    plan: planId,
    status: sub.status,
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    cancel_at_period_end: sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  };
  if (trialEnd && Number.isFinite(trialEnd)) {
    row.trial_ends_at = new Date(trialEnd * 1000).toISOString();
  }
  if (target.kind === "user") {
    row.user_id = target.userId;
    await supabase.from("subscriptions").upsert(row, { onConflict: "user_id" });
  } else {
    row.company_id = target.companyId;
    await supabase.from("subscriptions").upsert(row, { onConflict: "company_id" });
  }
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
  // R-19 Phase 1 (#11): throw on non-2xx so transient Stripe API errors
  // (5xx, 401, 429) don't masquerade as UnmappedPriceError. Without this,
  // a brief Stripe outage causes us to pollute stripe_unmapped_events and
  // burn through the 24-retry budget on what's really just a transient issue.
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET}` },
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "(no body)");
    throw new Error(`stripe_api_error: ${res.status} ${path}: ${errBody.slice(0, 200)}`);
  }
  return res.json();
}

// G-29 / R-19 Phase 1 (#1, #2): atomic event-id dedup with fail-CLOSED
// semantics. Returns:
//   { ok: true,  isFirstSeen: true  } — first time we have seen this event
//   { ok: true,  isFirstSeen: false } — duplicate (23505 unique violation)
//   { ok: false, isFirstSeen: false } — DB unavailable; caller must 503
// Fail-CLOSED on unknown DB errors so Stripe retries (instead of us
// double-processing). Pre-R-19 this was fail-OPEN — replay-attack window
// during DB degradation. Now: if dedup can't run, we don't process.
async function claimStripeEventOnce(
  supabase: ReturnType<typeof createClient>,
  evtId: string,
  evtType: string,
): Promise<{ ok: boolean; isFirstSeen: boolean }> {
  if (!evtId || evtId === "(unknown)") return { ok: true, isFirstSeen: true };
  try {
    const { data, error } = await supabase
      .from("processed_stripe_events")
      .insert({ event_id: evtId, event_type: evtType })
      .select("event_id")
      .maybeSingle();
    if (error) {
      if ((error as any)?.code === "23505") return { ok: true, isFirstSeen: false };
      console.error(`[stripe-webhook] claimStripeEventOnce DB error (fail-CLOSED):`, error.message);
      return { ok: false, isFirstSeen: false };
    }
    return { ok: true, isFirstSeen: !!data };
  } catch (err) {
    console.error(`[stripe-webhook] claimStripeEventOnce threw (fail-CLOSED):`, err);
    return { ok: false, isFirstSeen: false };
  }
}

// R-19 Phase 1 (#2): typed error so the catch block at the end of the
// switch rolls back the dedup row. Previously, inline `return 500` paths
// bypassed the catch entirely, leaving the dedup row in place forever —
// Stripe retried and got 200 deduped, but our DB never reflected the event.
class DbHandlerError extends Error {
  constructor(public readonly stage: string, public readonly cause?: unknown) {
    super(`db_handler_error: ${stage}: ${cause instanceof Error ? cause.message : String(cause)}`);
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

  // G-29 / R-19 Phase 1: dedup BEFORE business logic. Idempotent on event_id.
  const claim = await claimStripeEventOnce(supabase, evtId, evtType);
  if (!claim.ok) {
    // DB unavailable; fail-CLOSED. Return 503 so Stripe retries against
    // a healthy worker rather than us double-processing.
    return new Response(JSON.stringify({ error: "dedup_unavailable" }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
  }
  if (!claim.isFirstSeen) {
    console.log(`[stripe-webhook] duplicate event ignored: id=${evtId} type=${evtType}`);
    return new Response(JSON.stringify({ received: true, deduped: true, id: evtId, type: evtType }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId    = session.client_reference_id;
        const companyId = session.metadata?.companyId as string | undefined;
        const subId     = session.subscription;
        if (!subId || (!userId && !companyId)) {
          console.log(`[stripe-webhook] ${evtType} id=${evtId} missing target/subId, skipping`);
          break;
        }
        const sub = await stripeGet(`/subscriptions/${subId}`);
        const target: UpsertTarget = companyId
          ? { kind: "company", companyId }
          : { kind: "user", userId: userId as string };
        await upsertSubscription(supabase, target, sub, session.metadata?.planId);
        // Audit #5 / B1 (2026-04-29): record the paid-plan transition.
        // Required for compliance + GDPR export. Fire-and-forget — Stripe
        // already retries the webhook on failure, no need to fail twice.
        await supabase.rpc("log_sos_audit", {
          p_action: "stripe_checkout_completed",
          p_actor_user_id: userId,
          p_actor_level: companyId ? "owner" : "user",
          p_category: "billing",
          p_operation: "CREATE",
          p_metadata: {
            stripe_event_id: evtId,
            stripe_event_type: evtType,
            subscription_id: subId,
            plan_id: session.metadata?.planId || null,
            company_id: companyId || null,
          },
        }).then((r: { error?: unknown }) => {
          if (r.error) console.warn(`[stripe-webhook] audit failed for ${evtType}:`, r.error);
        });
        console.log(`[stripe-webhook] ${evtType} id=${evtId} ${companyId ? `company=${companyId}` : `user=${userId}`} sub=${subId}`);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        // AUTH-5 P2: look up both user_id and company_id columns. If neither
        // is present yet (first-touch race with checkout.session.completed)
        // we fall back to the metadata.companyId on the Stripe subscription
        // object itself — Stripe carries metadata across to subscription
        // events when set on the Checkout Session.
        const { data: row, error: selErr } = await supabase
          .from("subscriptions").select("user_id, company_id")
          .eq("stripe_customer_id", sub.customer).maybeSingle();
        if (selErr) {
          // R-19 Phase 1 (#2): throw so the catch block rolls back the
          // dedup row. Otherwise Stripe's retry hits the dedup branch and
          // returns 200, but our DB never reflects this event → permanent drift.
          throw new DbHandlerError("subscription_select_failed", selErr);
        }
        const metadataCompanyId = (sub as { metadata?: Record<string, string> }).metadata?.companyId as string | undefined;
        const target: UpsertTarget | null =
          row?.company_id   ? { kind: "company", companyId: row.company_id as string }
        : row?.user_id      ? { kind: "user",    userId:    row.user_id as string }
        : metadataCompanyId ? { kind: "company", companyId: metadataCompanyId }
        : null;
        if (!target) {
          console.warn(`[stripe-webhook] ${evtType} id=${evtId} no user/company mapped to customer ${sub.customer}`);
          break;
        }
        await upsertSubscription(supabase, target, sub);
        // Audit #5 / B1: record the subscription change.
        await supabase.rpc("log_sos_audit", {
          p_action: "stripe_subscription_changed",
          p_actor_user_id: target.kind === "user" ? target.userId : (row?.user_id ?? null),
          p_actor_level: target.kind === "company" ? "owner" : "user",
          p_category: "billing",
          p_operation: "UPDATE",
          p_metadata: {
            stripe_event_id: evtId,
            stripe_event_type: evtType,
            subscription_id: sub.id,
            status: sub.status,
            cancel_at_period_end: sub.cancel_at_period_end,
            company_id: target.kind === "company" ? target.companyId : null,
          },
        }).then((r: { error?: unknown }) => {
          if (r.error) console.warn(`[stripe-webhook] audit failed for ${evtType}:`, r.error);
        });
        console.log(`[stripe-webhook] ${evtType} id=${evtId} ${target.kind}=${target.kind === "user" ? target.userId : target.companyId}`);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const { error: updErr } = await supabase.from("subscriptions").update({
          status: "canceled", cancel_at_period_end: true, updated_at: new Date().toISOString(),
        }).eq("stripe_subscription_id", sub.id);
        if (updErr) {
          throw new DbHandlerError("subscription_delete_update_failed", updErr);
        }
        // Audit #5 / B1: record the cancellation.
        // We re-fetch the user_id so the audit row is correlated.
        const { data: deletedRow } = await supabase
          .from("subscriptions").select("user_id, company_id")
          .eq("stripe_subscription_id", sub.id).maybeSingle();
        if (deletedRow?.user_id || deletedRow?.company_id) {
          await supabase.rpc("log_sos_audit", {
            p_action: "stripe_subscription_cancelled",
            p_actor_user_id: deletedRow.user_id,
            p_actor_level: "user",
            p_category: "billing",
            p_operation: "DELETE",
            p_metadata: {
              stripe_event_id: evtId,
              stripe_event_type: evtType,
              subscription_id: sub.id,
              company_id: deletedRow?.company_id ?? null,
            },
          }).then((r: { error?: unknown }) => {
            if (r.error) console.warn(`[stripe-webhook] audit failed for ${evtType}:`, r.error);
          });
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
            throw new DbHandlerError("invoice_payment_failed_update_failed", updErr);
          }
        }
        // Audit #5 / B1: record payment failure for forensics.
        if (inv.subscription) {
          const { data: failRow } = await supabase
            .from("subscriptions").select("user_id, company_id")
            .eq("stripe_subscription_id", inv.subscription).maybeSingle();
          if (failRow?.user_id || failRow?.company_id) {
            await supabase.rpc("log_sos_audit", {
              p_action: "stripe_payment_failed",
              p_actor_user_id: failRow.user_id,
              p_actor_level: "user",
              p_category: "billing",
              p_operation: "UPDATE",
              p_metadata: {
                stripe_event_id: evtId,
                stripe_event_type: evtType,
                subscription_id: inv.subscription,
                amount_due: inv.amount_due || null,
                attempt_count: inv.attempt_count || null,
                company_id: failRow?.company_id ?? null,
              },
            }).then((r: { error?: unknown }) => {
              if (r.error) console.warn(`[stripe-webhook] audit failed for ${evtType}:`, r.error);
            });
          }
        }
        console.log(`[stripe-webhook] ${evtType} id=${evtId} sub=${inv.subscription}`);
        break;
      }
      // ── R-19 #3 (HIGH): handle disputes / chargebacks ──────────────────
      // Customer disputed the charge with their bank. Funds are withdrawn
      // from our balance — service must stop immediately. Pre-R-19, the
      // subscription stayed `active` and the user kept Elite features
      // until the next renewal failed ~30 days later.
      case "charge.dispute.created":
      case "charge.dispute.funds_withdrawn": {
        const dispute = event.data.object;
        // Stripe disputes reference a charge, not a subscription directly.
        // Look up the charge → invoice → subscription chain.
        const charge = await stripeGet(`/charges/${dispute.charge}`);
        const subId = charge?.invoice
          ? (await stripeGet(`/invoices/${charge.invoice}`))?.subscription
          : null;
        if (!subId) {
          console.warn(`[stripe-webhook] ${evtType} id=${evtId} no subscription for charge ${dispute.charge}`);
          break;
        }
        const { error: updErr } = await supabase.from("subscriptions").update({
          status: "canceled",
          cancel_at_period_end: false,
          updated_at: new Date().toISOString(),
        }).eq("stripe_subscription_id", subId);
        if (updErr) throw new DbHandlerError("dispute_cancel_failed", updErr);
        const { data: disputedRow } = await supabase
          .from("subscriptions").select("user_id, company_id")
          .eq("stripe_subscription_id", subId).maybeSingle();
        if (disputedRow?.user_id || disputedRow?.company_id) {
          await supabase.rpc("log_sos_audit", {
            p_action: "stripe_subscription_disputed",
            p_actor_user_id: disputedRow?.user_id ?? null,
            p_actor_level: disputedRow?.company_id ? "owner" : "user",
            p_category: "billing",
            p_operation: "UPDATE",
            p_metadata: {
              stripe_event_id: evtId,
              stripe_event_type: evtType,
              subscription_id: subId,
              dispute_id: dispute.id,
              reason: dispute.reason ?? null,
              amount: dispute.amount ?? null,
              company_id: disputedRow?.company_id ?? null,
            },
          }).then((r: { error?: unknown }) => {
            if (r.error) console.warn(`[stripe-webhook] audit failed for ${evtType}:`, r.error);
          });
        }
        console.log(`[stripe-webhook] ${evtType} id=${evtId} sub=${subId} reason=${dispute.reason}`);
        break;
      }

      // ── R-19 #4 (HIGH): EU 3DS / SCA challenge ─────────────────────────
      // Stripe needs customer interaction (3D Secure for PSD2 SCA compliance).
      // We store the hosted_invoice_url so the UI can surface a banner →
      // user completes authentication → renewal succeeds → next webhook
      // (invoice.payment_succeeded) clears the URL. Pre-R-19, EU customers
      // silently dropped to past_due after ~7 days of no action.
      case "invoice.payment_action_required": {
        const inv = event.data.object;
        if (!inv.subscription) {
          console.warn(`[stripe-webhook] ${evtType} id=${evtId} no subscription on invoice`);
          break;
        }
        const { error: updErr } = await supabase.from("subscriptions").update({
          requires_action_url: inv.hosted_invoice_url ?? null,
          updated_at: new Date().toISOString(),
        }).eq("stripe_subscription_id", inv.subscription);
        if (updErr) throw new DbHandlerError("payment_action_required_update_failed", updErr);
        console.log(`[stripe-webhook] ${evtType} id=${evtId} sub=${inv.subscription} action_url set`);
        break;
      }

      // ── Clear requires_action_url on successful renewal ────────────────
      // Paired with #4 — when the user completes 3DS and Stripe charges
      // them, the URL is no longer relevant. Clear it so the UI hides
      // the banner.
      case "invoice.payment_succeeded": {
        const inv = event.data.object;
        if (!inv.subscription) break;
        const { error: updErr } = await supabase.from("subscriptions").update({
          requires_action_url: null,
          updated_at: new Date().toISOString(),
        }).eq("stripe_subscription_id", inv.subscription)
          .not("requires_action_url", "is", null); // only touch rows that had a flag
        if (updErr) throw new DbHandlerError("payment_succeeded_clear_failed", updErr);
        console.log(`[stripe-webhook] ${evtType} id=${evtId} sub=${inv.subscription} cleared action_url`);
        break;
      }

      // ── R-19 #5 (MEDIUM): 3 days before trial ends ─────────────────────
      // Mark the row so the mobile app can surface a "Your trial ends in
      // 3 days" banner. Idempotent — repeated webhook fires don't matter,
      // we just update the timestamp.
      case "customer.subscription.trial_will_end": {
        const sub = event.data.object;
        const { error: updErr } = await supabase.from("subscriptions").update({
          trial_ending_notified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("stripe_subscription_id", sub.id);
        if (updErr) throw new DbHandlerError("trial_will_end_update_failed", updErr);
        console.log(`[stripe-webhook] ${evtType} id=${evtId} sub=${sub.id} trial_ending warning marked`);
        break;
      }

      // ── R-19 #6 (MEDIUM): Stripe customer was deleted ──────────────────
      // Operator deleted the customer in Stripe Dashboard (cleanup, GDPR
      // erasure, etc.). The subscription is orphaned. We null out the
      // stripe_customer_id so the next portal call doesn't 502 against a
      // dead customer, and set status=canceled.
      case "customer.deleted": {
        const cust = event.data.object;
        const { error: updErr } = await supabase.from("subscriptions").update({
          stripe_customer_id: null,
          stripe_subscription_id: null,
          status: "canceled",
          cancel_at_period_end: false,
          updated_at: new Date().toISOString(),
        }).eq("stripe_customer_id", cust.id);
        if (updErr) throw new DbHandlerError("customer_deleted_update_failed", updErr);
        console.log(`[stripe-webhook] ${evtType} id=${evtId} customer=${cust.id} nullified`);
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
