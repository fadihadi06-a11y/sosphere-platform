// ═══════════════════════════════════════════════════════════════
// SOSphere — Stripe Client Service (P3-#10)
// ─────────────────────────────────────────────────────────────
// Thin client wrapper around the three Stripe edge functions:
//   - stripe-checkout  → starts a Checkout Session for a paid plan
//   - stripe-portal    → opens the Stripe Billing Portal
//   - (webhook runs server-side; no client call needed)
//
// Design notes:
//   • The JWT is passed through from the current Supabase session.
//     The server verifies it and pins the Checkout session to the
//     authenticated user. Never trust any client-supplied userId.
//   • Plan resolution is done server-side via env-mapped price IDs
//     so rotating prices doesn't require an app release.
//   • This file is framework-agnostic — the billing page calls it
//     from a button handler and `window.location.assign`s to the
//     returned URL. No React state living here.
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./api/supabase-client";
import { getStoredBearerToken } from "./api/safe-rpc";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const CHECKOUT_URL = `${SUPABASE_URL}/functions/v1/stripe-checkout`;
const PORTAL_URL = `${SUPABASE_URL}/functions/v1/stripe-portal`;

export type StripePlanId = "starter" | "growth" | "business" | "enterprise";
export type StripeCycle = "monthly" | "annual";

export interface StartCheckoutOpts {
  planId: StripePlanId;
  cycle: StripeCycle;
  /** Extra seats beyond the plan's bundled count (optional). */
  seats?: number;
  /** Absolute URL to return to on success — defaults to current page + `?ok=1`. */
  successUrl?: string;
  /** Absolute URL to return to on cancel — defaults to current page + `?cancelled=1`. */
  cancelUrl?: string;
}

async function authedHeaders(): Promise<Record<string, string>> {
  // E1.6-PHASE3 (2026-05-04): JWT from localStorage — bypass auth lock.
  // If the lock is wedged, getSession() hangs and the user can't even
  // start a Stripe checkout. Payment surfaces are too sensitive to leak
  // SDK deadlocks into.
  const token = getStoredBearerToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

/**
 * Start a Stripe Checkout Session and redirect the browser to it.
 * Resolves with `void` on successful redirect; throws on failure so
 * the caller can surface a toast.
 *
 * @example
 *   await startCheckout({ planId: "growth", cycle: "monthly" });
 *   // browser is now on Stripe's hosted checkout page
 */
export async function startCheckout(opts: StartCheckoutOpts): Promise<void> {
  if (!SUPABASE_URL) throw new Error("Supabase URL not configured");

  const fallbackOk = `${window.location.origin}${window.location.pathname}?ok=1`;
  const fallbackCancel = `${window.location.origin}${window.location.pathname}?cancelled=1`;

  const res = await fetch(CHECKOUT_URL, {
    method: "POST",
    headers: await authedHeaders(),
    body: JSON.stringify({
      planId: opts.planId,
      cycle: opts.cycle,
      seats: opts.seats,
      successUrl: opts.successUrl || fallbackOk,
      cancelUrl: opts.cancelUrl || fallbackCancel,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Checkout failed: ${res.status} ${text}`);
  }

  const { url } = (await res.json()) as { url: string };
  if (!url) throw new Error("Checkout response missing url");

  // Direct redirect — the entire page transfers to Stripe's domain.
  // We don't use window.open() because popup blockers will eat it on
  // some browsers when triggered outside the original click handler's
  // microtask. Keep the path synchronous.
  window.location.assign(url);
}

/**
 * Open the Stripe Billing Portal for the current user. Redirects
 * the browser on success. Throws if the user has no Stripe customer
 * on file (i.e. they never subscribed through us).
 */
export async function openBillingPortal(returnUrl?: string): Promise<void> {
  if (!SUPABASE_URL) throw new Error("Supabase URL not configured");

  const res = await fetch(PORTAL_URL, {
    method: "POST",
    headers: await authedHeaders(),
    body: JSON.stringify({
      returnUrl: returnUrl || `${window.location.origin}${window.location.pathname}`,
    }),
  });

  if (res.status === 404) {
    // No customer on file yet — caller should route the user to
    // Checkout instead. We surface this as a typed error so the UI
    // can decide (e.g. gray out the "Manage Billing" button when
    // the user is still on free).
    throw new Error("NO_STRIPE_CUSTOMER");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Portal failed: ${res.status} ${text}`);
  }

  const { url } = (await res.json()) as { url: string };
  if (!url) throw new Error("Portal response missing url");
  window.location.assign(url);
}

/**
 * Plans that go through Stripe. Anything else (notably "free") does
 * NOT hit Stripe — it's a local tier change only.
 */
const PAID_PLANS = new Set<string>(["starter", "growth", "business", "enterprise"]);

/**
 * Helper: should this plan change go through Stripe Checkout? Free
 * tier downgrades skip Stripe entirely and are handled locally.
 */
export function isPaidPlan(planId: string): planId is StripePlanId {
  return PAID_PLANS.has(planId);
}
