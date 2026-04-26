// ═══════════════════════════════════════════════════════════════
// SOSphere — Stripe Customer Portal Session (P3-#10)
// Handles: POST /functions/v1/stripe-portal
//
// Creates a one-off Stripe Billing Portal session so the user can
// manage their subscription (change plan, update card, cancel,
// download invoices) on Stripe's hosted UI. We never handle card
// data ourselves — PCI compliance stays Stripe's problem.
//
// Request:  (no body required)
// Response: { url: string }
//
// Env vars: STRIPE_SECRET_KEY, SOSPHERE_BASE_URL
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, getRateLimitHeaders } from "../_shared/rate-limiter.ts";

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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") || "";
const BASE_URL = Deno.env.get("SOSPHERE_BASE_URL") || "https://sosphere.co";

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
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: cors,
    });
  }
  const userId = userData.user.id;

  // E-15 / W3 TIER 2 (B-20, 2026-04-26): rate-limit per-user.
  // Pre-fix: stripe-portal had no rate limit — an attacker with one
  // valid JWT could hammer the endpoint, generating endless billing
  // portal sessions and eating Stripe API quota. Stripe's own rate
  // limits would eventually kick in but only after the abuser had
  // burned hundreds of requests against our budget.
  // Post-fix: standard "api" tier limit (10/min default). Returns 429
  // with retry-after when exceeded. SOS priority lane does NOT apply
  // to billing operations.
  const rl = checkRateLimit(userId, "api", false);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({
        error: "Rate limit exceeded",
        retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000),
      }),
      {
        status: 429,
        headers: { ...cors, ...getRateLimitHeaders(rl), "Content-Type": "application/json" },
      },
    );
  }

  // Look up the stripe customer id we stashed during checkout. If the
  // user has never subscribed there's nothing to manage — tell them.
  const { data: row } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!row?.stripe_customer_id) {
    return new Response(
      JSON.stringify({ error: "No Stripe customer on file — subscribe first" }),
      { status: 404, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const { returnUrl } = await req.json().catch(() => ({}));
  const form = new URLSearchParams({
    customer: row.stripe_customer_id as string,
    return_url: returnUrl || `${BASE_URL}/billing`,
  });

  const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const data = await res.json();

  if (!res.ok) {
    console.error("[stripe-portal] Stripe error:", data?.error?.message);
    return new Response(JSON.stringify({ error: data?.error?.message || "Stripe error" }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ url: data.url }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
