/**
 * company-subscription-client.ts — typed wrappers around AUTH-5 P1 RPCs.
 *
 * Single import, single mental model for any UI that reads or mutates
 * a company's billing/trial state. All calls go through safeRpc (lock-
 * free direct fetch — same pattern we use for the other critical
 * surfaces) so a wedged supabase-js auth lock can never freeze the
 * billing UI.
 *
 * Server contract (from supabase/migrations/20260506100000):
 *   • current_dpa_version() → text
 *   • get_company_subscription_state(p_company_id uuid) → jsonb
 *   • accept_company_dpa(p_company_id, p_dpa_version, p_signer_full_name,
 *                        p_signer_title) → jsonb
 *   • cancel_company_trial(p_company_id uuid) → jsonb
 */

import { safeRpc } from "./safe-rpc";

export interface CompanySubscriptionState {
  hasSubscription: boolean;
  isOwner:         boolean;
  plan?:           string;
  tier?:           string;
  status?:         "trialing" | "active" | "past_due" | "canceled" | "inactive" | string;
  billingCycle?:   "monthly" | "annual" | string;
  employeeLimit?:  number | null;
  zoneLimit?:      number | null;
  trialEndsAt?:    string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  daysLeftInTrial?: number | null;
  dpaVersion:      string;
  dpaAccepted:     boolean;
  // Owner-only fields — null for non-owners (server enforces).
  stripeCustomerId?:     string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?:        string | null;
}

export interface CallResult<T> {
  data:  T | null;
  error: { message: string; code?: string } | null;
}

/** Read live subscription state. Returns the SAME shape regardless of role,
 *  but Stripe IDs are nulled out for non-owners (defense in depth). */
export async function getCompanySubscriptionState(
  companyId: string,
): Promise<CallResult<CompanySubscriptionState>> {
  const r = await safeRpc<{
    success: boolean; reason?: string;
    has_subscription?: boolean;
    is_owner?: boolean;
    plan?: string; tier?: string; status?: string;
    billing_cycle?: string;
    employee_limit?: number | null;
    zone_limit?: number | null;
    trial_ends_at?: string | null;
    current_period_end?: string | null;
    cancel_at_period_end?: boolean;
    days_left_in_trial?: number | null;
    dpa_version?: string;
    dpa_accepted?: boolean;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    stripe_price_id?: string | null;
  }>("get_company_subscription_state", { p_company_id: companyId }, { timeoutMs: 6000 });

  if (r.error) return { data: null, error: r.error };
  if (!r.data?.success) {
    return { data: null, error: { message: r.data?.reason || "Could not read subscription state" } };
  }
  return {
    data: {
      hasSubscription:      !!r.data.has_subscription,
      isOwner:              !!r.data.is_owner,
      plan:                 r.data.plan,
      tier:                 r.data.tier,
      status:               r.data.status,
      billingCycle:         r.data.billing_cycle,
      employeeLimit:        r.data.employee_limit ?? null,
      zoneLimit:            r.data.zone_limit ?? null,
      trialEndsAt:          r.data.trial_ends_at ?? null,
      currentPeriodEnd:     r.data.current_period_end ?? null,
      cancelAtPeriodEnd:    !!r.data.cancel_at_period_end,
      daysLeftInTrial:      r.data.days_left_in_trial ?? null,
      dpaVersion:           r.data.dpa_version || "",
      dpaAccepted:          !!r.data.dpa_accepted,
      stripeCustomerId:     r.data.stripe_customer_id ?? null,
      stripeSubscriptionId: r.data.stripe_subscription_id ?? null,
      stripePriceId:        r.data.stripe_price_id ?? null,
    },
    error: null,
  };
}

/** Soft-cancel the trial (Stripe-style: cancel_at_period_end). Trial
 *  runs to natural expiry then drops to inactive. */
export async function cancelCompanyTrial(
  companyId: string,
): Promise<CallResult<{ willEndAt: string | null; status: string | null }>> {
  const r = await safeRpc<{ success: boolean; reason?: string; will_end_at?: string; status?: string }>(
    "cancel_company_trial",
    { p_company_id: companyId },
    { timeoutMs: 6000 },
  );
  if (r.error) return { data: null, error: r.error };
  if (!r.data?.success) {
    return { data: null, error: { message: friendlyTrialReason(r.data?.reason) } };
  }
  return { data: { willEndAt: r.data.will_end_at ?? null, status: r.data.status ?? null }, error: null };
}

/** Re-accept (or first-accept) the DPA. Idempotent per (company, version). */
export async function acceptCompanyDpa(
  companyId: string,
  signerFullName: string,
  signerTitle: string,
  dpaVersion: string,
): Promise<CallResult<{ idempotent: boolean; acceptedAt: string | null }>> {
  const r = await safeRpc<{ success: boolean; reason?: string; idempotent?: boolean; accepted_at?: string }>(
    "accept_company_dpa",
    {
      p_company_id:       companyId,
      p_dpa_version:      dpaVersion,
      p_signer_full_name: signerFullName,
      p_signer_title:     signerTitle,
    },
    { timeoutMs: 6000 },
  );
  if (r.error) return { data: null, error: r.error };
  if (!r.data?.success) {
    return { data: null, error: { message: friendlyDpaReason(r.data?.reason) } };
  }
  return { data: { idempotent: !!r.data.idempotent, acceptedAt: r.data.accepted_at ?? null }, error: null };
}

/** Fetch the current DPA version string from the server. Useful for
 *  the renewal prompt: when the server ticks to a new version, the
 *  banner can prompt the owner to re-accept. */
export async function getCurrentDpaVersion(): Promise<CallResult<string>> {
  const r = await safeRpc<string>("current_dpa_version", {}, { timeoutMs: 4000 });
  if (r.error) return { data: null, error: r.error };
  return { data: typeof r.data === "string" ? r.data : "", error: null };
}

// ── Helpers ─────────────────────────────────────────────────────────

function friendlyTrialReason(reason: string | undefined): string {
  switch (reason) {
    case "unauthorized":              return "You must be signed in.";
    case "not_owner":                 return "Only the company owner can change billing.";
    case "no_active_trial_to_cancel": return "No active trial to cancel.";
    default:                          return reason || "Could not cancel trial.";
  }
}

function friendlyDpaReason(reason: string | undefined): string {
  switch (reason) {
    case "unauthorized":         return "You must be signed in.";
    case "not_owner":            return "Only the company owner can sign the DPA.";
    case "invalid_signer_name":  return "Signer name must be at least 2 characters.";
    case "invalid_signer_title": return "Signer title must be at least 2 characters.";
    case "invalid_version":      return "DPA version is missing.";
    default:                     return reason || "Could not record DPA acceptance.";
  }
}
