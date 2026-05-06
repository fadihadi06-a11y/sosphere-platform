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
//     planId:    "starter" | "growth" | "business" | "enterprise" | "basic" | "elite",
//     cycle:     "monthly" | "annual",
//     seats?:    number,              // optional: extra-seat quantity
//     companyId?: string,             // AUTH-5 P2: B2B subscription target.
//                                     //   When present, caller MUST be company owner.
//                                     //   Subscription is attributed to company_id, not user_id.
//                                     //   If a trialing subscription exists for the company,
//                                     //   Stripe is told to honor the existing trial_ends_at.
//     successUrl?: string,
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
async function stripePost(
  path: string,
  form: Record<string, string>,
  idempotencyKey?: string,
): Promise<Response> {
  const body = new URLSearchParams(form).toString();
  // CRIT-#19 (2026-04-27): Idempotency-Key prevents Stripe from creating
  // duplicate sessions on network-retry of the same logical request.
  // Caller passes a stable hash (e.g., user+plan+day) so retries map
  // to the same Stripe-side request, avoiding double-charge.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_SECRET}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return fetch(`${STRIPE_API}${path}`, { method: "POST", headers, body });
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
  const { planId, cycle, seats, companyId, successUrl, cancelUrl } = await req.json().catch(() => ({}));
  const validPlans: PlanId[] = ["starter", "growth", "business", "enterprise", "basic", "elite"];
  const validCycles: Cycle[] = ["monthly", "annual"];
  if (!validPlans.includes(planId) || !validCycles.includes(cycle)) {
    return new Response(JSON.stringify({ error: "Invalid plan or cycle" }), {
      status: 400,
      headers: cors,
    });
  }

  // ── AUTH-5 P2: B2B ownership gate ─────────────────────────────────────
  // If the caller passed a companyId, they're subscribing the company,
  // not themselves. We MUST verify they're the company owner before
  // letting Stripe attribute charges to that company. The is_company_owner
  // RPC consults company_memberships server-side — anyone can be a member,
  // but only the owner gets to authorize billing.
  let safeCompanyId: string | null = null;
  if (companyId !== undefined && companyId !== null) {
    if (typeof companyId !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)) {
      return new Response(JSON.stringify({ error: "Invalid companyId" }), {
        status: 400, headers: cors,
      });
    }
    // We need the caller's JWT context for is_company_owner (uses auth.uid()),
    // so create a second supabase client bound to the user's bearer token.
    const supaUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: ownerOk, error: ownerErr } = await supaUser.rpc("is_company_owner", { p_company_id: companyId });
    if (ownerErr || !ownerOk) {
      return new Response(JSON.stringify({ error: "Forbidden: not company owner" }), {
        status: 403, headers: cors,
      });
    }
    safeCompanyId = companyId;
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

  // ── Look up an existing Stripe customer id + trial state on file ──
  // For B2B: scoped to (company_id). For B2C: (user_id). The subscription
  // table has a partial UNIQUE INDEX on company_id WHERE NOT NULL, so this
  // SELECT is at most one row in either branch.
  const subQuery = supabase
    .from("subscriptions")
    .select("stripe_customer_id, status, trial_ends_at")
    .limit(1);
  const { data: existing } = safeCompanyId
    ? await subQuery.eq("company_id", safeCompanyId).maybeSingle()
    : await subQuery.eq("user_id", userId).maybeSingle();

  // ── Build the Checkout Session params. ──
  // For B2B (safeCompanyId set), we add `metadata.companyId` so the
  // webhook routes the resulting subscription to the company row. The
  // webhook checks metadata.companyId first, then falls back to
  // client_reference_id treated as a user_id (preserves civilian flow).
  const form: Record<string, string> = {
    mode: "subscription",
    "payment_method_types[]": "card",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    client_reference_id: userId,            // owner who initiated (audit trail)
    "metadata[userId]": userId,
    "metadata[planId]": planId,
    "metadata[cycle]": cycle,
    success_url: safeSuccess + (safeSuccess.includes("?") ? "&" : "?") + "session_id={CHECKOUT_SESSION_ID}",
    cancel_url: safeCancel,
    allow_promotion_codes: "true",
  };
  if (safeCompanyId) {
    form["metadata[companyId]"] = safeCompanyId;
    // AUTH-5 P2: if the company is currently in start_company_trial-issued
    // 'trialing' state, tell Stripe to HONOR the existing trial deadline
    // instead of starting a fresh trial or charging immediately. Matches
    // Linear / Notion: paying mid-trial does not extend, just upgrades.
    const existingRow = existing as
      | { status?: string | null; trial_ends_at?: string | null; stripe_customer_id?: string | null }
      | null;
    if (existingRow?.status === "trialing" && existingRow.trial_ends_at) {
      const trialEndUnix = Math.floor(new Date(existingRow.trial_ends_at).getTime() / 1000);
      if (Number.isFinite(trialEndUnix) && trialEndUnix > Math.floor(Date.now() / 1000)) {
        form["subscription_data[trial_end]"] = String(trialEndUnix);
      }
    }
  }

  // Optional: per-seat line item if the plan supports extra seats.
  // DD-7 (2026-04-27): seats must be a non-negative integer ≤ 1000.
  // Without this, an attacker could pass `seats=999999999` and cause a
  // huge Stripe invoice + billing surprise. Floats and negatives also
  // rejected (Stripe accepts integers only).
  const seatPrice = Deno.env.get("STRIPE_EXTRA_SEAT_PRICE");
  const safeSeats = (
    typeof seats === "number" && Number.isInteger(seats) && seats > 0 && seats <= 1000
  ) ? seats : 0;
  if (seatPrice && safeSeats > 0) {
    form["line_items[1][price]"] = seatPrice;
    form["line_items[1][quantity]"] = String(safeSeats);
  }

  if (existing?.stripe_customer_id) {
    form.customer = existing.stripe_customer_id;
  } else if (userEmail) {
    form.customer_email = userEmail;
  }

  // CRIT-#19 (2026-04-27): Stripe idempotency token. Without this,
  // a network flap during checkout creation causes the client to retry
  // and Stripe creates DUPLICATE checkout sessions (same user paying
  // twice for one cart). The idempotency-key is a stable hash of
  // {userId, plan, tier, day} so retries within the same UX session
  // map to the same Stripe-side request. Different retry windows
  // (different days) get fresh keys — correct behavior.
  // AUTH-5 P2: previously hashed `plan ?? ""` and `tier ?? ""` —
  // both were undefined identifiers, so EVERY user got the SAME daily
  // idempotency key. That meant retries from different users on the
  // same day silently mapped to ONE Stripe-side request. Fixed by
  // hashing planId + cycle (the actual values), and including
  // safeCompanyId so the same owner subscribing two different
  // companies in one day does not collide.
  const idemKey = "ck_" + (await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(
      `${userId}:${safeCompanyId ?? ""}:${planId}:${cycle}:${new Date().toISOString().slice(0,10)}`
    )).then(buf => Array.from(new Uint8Array(buf)).slice(0, 16)
      .map(b => b.toString(16).padStart(2, "0")).join("")));
  const res = await stripePost("/checkout/sessions", form, idemKey);
  const data = await res.json();
  if (!res.ok) {
    // DD-5 (2026-04-27): Stripe-internal error logged server-side ONLY.
    // Client receives opaque message + request id — same pattern as DD-4.
    const reqId = "rq-" + Math.random().toString(36).slice(2, 10);
    console.error(`[stripe-checkout] [${reqId}] Stripe error:`, data?.error?.message);
    return new Response(JSON.stringify({ error: "Checkout unavailable", request_id: reqId }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ sessionId: data.id, url: data.url }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
