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

async function upsertSubscription(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  sub: StripeSubscription,
  planIdOverride?: string,
): Promise<void> {
  const priceId = sub.items?.data?.[0]?.price?.id;
  // Best-effort plan id recovery: Checkout session metadata carries it;
  // otherwise we fall back to a price-id lookup table the admin sets via
  // env (e.g. STRIPE_PRICE_GROWTH_MONTHLY -> "growth"). A missing plan
  // just means the UI label is less specific — not a blocker.
  const planId = planIdOverride || sub.metadata?.planId || lookupPlanByPriceEnv(priceId);

  await supabase.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_customer_id: sub.customer,
      stripe_subscription_id: sub.id,
      stripe_price_id: priceId,
      tier: planId || "starter",
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
  const plans = ["starter", "growth", "business", "enterprise"];
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

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.client_reference_id;
        const subId = session.subscription;
        if (!userId || !subId) break;

        // Hydrate full subscription object — the session only has the id.
        const sub = await stripeGet(`/subscriptions/${subId}`);
        await upsertSubscription(supabase, userId, sub, session.metadata?.planId);
        console.log(`[stripe-webhook] checkout.session.completed user=${userId} sub=${subId}`);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        // Resolve userId from our own table via the customer id — we
        // wrote it during checkout.session.completed.
        const { data: row } = await supabase
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_customer_id", sub.customer)
          .maybeSingle();
        if (!row?.user_id) {
          console.warn(
            `[stripe-webhook] no user mapped to customer ${sub.customer} — skipping ${event.type}`,
          );
          break;
        }
        await upsertSubscription(supabase, row.user_id, sub);
        console.log(`[stripe-webhook] ${event.type} user=${row.user_id}`);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await supabase
          .from("subscriptions")
          .update({
            status: "canceled",
            cancel_at_period_end: true,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", sub.id);
        console.log(`[stripe-webhook] subscription deleted sub=${sub.id}`);
        break;
      }

      case "invoice.payment_failed": {
        const inv = event.data.object;
        // Flip status to past_due so the app can nudge the user.
        if (inv.subscription) {
          await supabase
            .from("subscriptions")
            .update({ status: "past_due", updated_at: new Date().toISOString() })
            .eq("stripe_subscription_id", inv.subscription);
        }
        console.log(`[stripe-webhook] payment_failed sub=${inv.subscription}`);
        break;
      }

      default:
        // No-op for events we don't handle — Stripe retries on 5xx only.
        break;
    }
  } catch (err) {
    console.error("[stripe-webhook] handler error:", err);
    // Return 200 so Stripe doesn't retry indefinitely on a bug in our
    // handler. The event is logged and can be replayed manually.
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
