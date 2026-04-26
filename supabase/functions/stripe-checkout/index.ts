// ═══════════════════════════════════════════════════════════════
// SOSphere — Stripe Checkout Session (P3-#10)
// Handles: POST /functions/v1/stripe-checkout
//
// Creates a Stripe Checkout Session for a given plan + billing cycle
// and returns { sessionId, url } the client can redirect to.
//
// Why this edge function exists:
//   Checkout sessions MUST be created server-side — the Stripe
//   secret key cannot be embedded in the client bundle. We also
//   stamp the session's `client_reference_id` with the Supabase
//   user id so the webhook can attribute the resulting subscription
//   to the right account without trusting any client-supplied id.
//
// Request shape:
//   {
//     planId: "starter" | "growth" | "business" | "enterprise",
//     cycle:  "monthly" | "annual",
//     seats?: number,              // optional: extra-seat quantity
//     successUrl?: string,         // optional override
//     cancelUrl?:  string,
//   }
//
// Response:
//   { sessionId: string, url: string }
//
// Env vars required:
//   STRIPE_SECRET_KEY
//   STRIPE_PRICE_<PLAN>_<CYCLE>   e.g. STRIPE_PRICE_GROWTH_MONTHLY
//   STRIPE_EXTRA_SEAT_PRICE       (optional; if set, seats are billed
//                                  as a metered quantity line item)
//   SOSPHERE_BASE_URL             (for redirect fallbacks)
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// B-M1: origin allowlist via ALLOWED_ORIGINS env
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://sosphere-platform.vercel.app")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
function getCorsOrigin(req: Request): string {
  const origin = req.headers.get("origin") || "";
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}
function buildCors(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getCorsOrigin(req),
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") || "";
const STRIPE_API = "https://api.stripe.com/v1";
const BASE_URL = Deno.env.get("SOSPHERE_BASE_URL") || "https://sosphere.co";

// B-17 (2026-04-25): added civilian plans (basic, elite). The webhook's
// price→plan lookup is in sync; new STRIPE_PRICE_BASIC_* / STRIPE_PRICE_ELITE_*
// env vars must be set in Supabase secrets before going live.
type PlanId = "starter" | "growth" | "business" | "enterprise"
            | "basic" | "elite";
type Cycle = "monthly" | "annual";

function priceEnvKey(plan: PlanId, cycle: Cycle): string {
  return `STRIPE_PRICE_${plan.toUpperCase()}_${cycle.toUpperCase()}`;
}

/**
 * x-www-form-urlencoded POST to Stripe. We roll our own because Deno's
 * Stripe SDK pulls in >100 KB of Node polyfills and the surface we
 * need is tiny.
 */
async function stripePost(path: string, form: Record<string, string>): Promise<Response> {
  const body = new URLSearchParams(form).toString();
  return fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

serve(async (req: Request) => {
  // B-M1: origin allowlist via ALLOWED_ORIGINS env
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: cors,
    });
  }

  if (!STRIPE_SECRET) {
    return new Response(JSON.stringify({ error: "Stripe not configured" }), {
      status: 500,
      headers: cors,
    });
  }

  // ── Auth: the session is pinned to the JWT user. We never trust
  // a client-supplied userId — anyone could mint a checkout for
  // someone else's account and stamp it with THEIR id otherwise.
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: cors,
    });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const jwt = authHeader.replace("Bearer ", "");
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized", detail: userErr?.message }), {
      status: 401,
      headers: cors,
    });
  }
  const userId = userData.user.id;
  const userEmail = userData.user.email;

  // ── Payload validation ──
  const { planId, cycle, seats, successUrl, cancelUrl } = await req.json().catch(() => ({}));
  const validPlans: PlanId[] = ["starter", "growth", "business", "enterprise", "basic", "elite"];
  const validCycles: Cycle[] = ["monthly", "annual"];
  if (!validPlans.includes(planId) || !validCycles.includes(cycle)) {
    return new Response(JSON.stringify({ error: "Invalid plan or cycle" }), {
      status: 400,
      headers: cors,
    });
  }

  // E-16 / W3 TIER 2 (B-20, 2026-04-26): allowlist successUrl + cancelUrl
  // origins so Stripe can't be coerced into redirecting to attacker-controlled
  // domains. Pre-fix: client could send `successUrl: "https://evil.com"` →
  // Stripe redirects user post-payment with session_id leaking to attacker.
  // Post-fix: any custom URL must share origin with ALLOWED_ORIGINS;
  // mismatched origins fall back silently to the default success/cancel URL.
  function isAllowedRedirect(url: string | undefined | null): boolean {
    if (!url || typeof url !== "string") return false;
    try {
      const u = new URL(url);
      const allowedOrigins = ALLOWED_ORIGINS.map((o) => {
        try { return new URL(o).origin; } catch { return null; }
      }).filter(Boolean);
      return allowedOrigins.includes(u.origin);
    } catch { return false; }
  }
  const safeSuccess = isAllowedRedirect(successUrl) ? successUrl : `${BASE_URL}/billing?ok=1`;
  const safeCancel  = isAllowedRedirect(cancelUrl)  ? cancelUrl  : `${BASE_URL}/billing?cancelled=1`;
  if (successUrl && safeSuccess !== successUrl) {
    console.warn(`[stripe-checkout] successUrl rejected (off-allowlist): ${successUrl}`);
  }
  if (cancelUrl && safeCancel !== cancelUrl) {
    console.warn(`[stripe-checkout] cancelUrl rejected (off-allowlist): ${cancelUrl}`);
  }

  // ── Resolve the Stripe price id for this plan+cycle ──
  const priceId = Deno.env.get(priceEnvKey(planId, cycle));
  if (!priceId) {
    return new Response(
      JSON.stringify({ error: `Price env not set: ${priceEnvKey(planId, cycle)}` }),
      { status: 500, headers: cors },
    );
  }

  // ── Look up an existing Stripe customer id on file — so repeated
  // checkouts for the same user reuse the same customer record ──
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  // ── Build the Checkout Session params. `client_reference_id` is
  // the ONLY identity the webhook trusts. ──
  const form: Record<string, string> = {
    mode: "subscription",
    "payment_method_types[]": "card",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    client_reference_id: userId,
    "metadata[userId]": userId,
    "metadata[planId]": planId,
    "metadata[cycle]": cycle,
    success_url: safeSuccess + (safeSuccess.includes("?") ? "&" : "?") + "session_id={CHECKOUT_SESSION_ID}",
    cancel_url: safeCancel,
    allow_promotion_codes: "true",
  };

  // Optional: per-seat line item if the plan supports extra seats.
  const seatPrice = Deno.env.get("STRIPE_EXTRA_SEAT_PRICE");
  if (seatPrice && typeof seats === "number" && seats > 0) {
    form["line_items[1][price]"] = seatPrice;
    form["line_items[1][quantity]"] = String(seats);
  }

  if (existing?.stripe_customer_id) {
    form.customer = existing.stripe_customer_id;
  } else if (userEmail) {
    form.customer_email = userEmail;
  }

  const res = await stripePost("/checkout/sessions", form);
  const data = await res.json();
  if (!res.ok) {
    console.error("[stripe-checkout] Stripe error:", data?.error?.message);
    return new Response(JSON.stringify({ error: data?.error?.message || "Stripe error" }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ sessionId: data.id, url: data.url }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
