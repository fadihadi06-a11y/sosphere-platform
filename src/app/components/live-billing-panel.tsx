/**
 * live-billing-panel.tsx — AUTH-5 P4b (#175)
 *
 * Server-of-truth billing panel for the company owner's billing page.
 * Lives at the TOP of dashboard-billing-page.tsx and shows the live
 * `subscriptions` row (status / plan / trial_ends_at / DPA version)
 * plus the four owner actions: Upgrade, Cancel Trial, Resume Trial,
 * Manage Payment. Reads via get_company_subscription_state — never
 * trusts localStorage for billing decisions.
 *
 * Why this lives next to (not inside) the existing BillingPage:
 *   The existing page derives its state from a localStorage mock
 *   (companyState). We don't want to rip that out yet — many surfaces
 *   downstream depend on it. The live panel mounts at the top, shows
 *   the truth, and the legacy UI continues to work below.
 *
 * Action semantics (matches Stripe / Linear / Notion):
 *   • Upgrade:        startCheckout({ companyId, plan, cycle }) —
 *                     edge function honours existing trial_end so the
 *                     deadline is preserved, no early charges.
 *   • Cancel trial:   sets cancel_at_period_end=true. Trial runs to
 *                     natural expiry then drops to inactive. Does NOT
 *                     end the trial early.
 *   • Resume trial:   not in P4 scope (post-cancel an owner upgrades
 *                     instead — Stripe webhook flips the bit on the
 *                     fresh paid subscription).
 *   • Manage Payment: openBillingPortal with companyId — Stripe-hosted.
 */

import { useEffect, useState, useCallback } from "react";
import { motion } from "motion/react";
import {
  CreditCard, Calendar, AlertTriangle, CheckCircle2,
  ArrowRight, Loader2, ShieldCheck, Ban,
} from "lucide-react";
import {
  getCompanySubscriptionState,
  cancelCompanyTrial,
  type CompanySubscriptionState,
} from "./api/company-subscription-client";
import { startCheckout, openBillingPortal, type StripePlanId, type StripeCycle } from "./stripe-service";

interface LiveBillingPanelProps {
  /** The currently active company. Without this we render nothing. */
  companyId: string | null | undefined;
  /** Optional callback so the parent can reflect the new state in its
   *  own derived UI (legacy mock overlay etc.). */
  onStateChange?: (s: CompanySubscriptionState | null) => void;
}

export function LiveBillingPanel({ companyId, onStateChange }: LiveBillingPanelProps) {
  const [state, setState]       = useState<CompanySubscriptionState | null>(null);
  const [loading, setLoading]   = useState<boolean>(true);
  const [actioning, setActioning] = useState<null | "upgrade" | "cancel" | "portal">(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!companyId) { setState(null); setLoading(false); return; }
    setLoading(true);
    const r = await getCompanySubscriptionState(companyId);
    setLoading(false);
    if (r.error) {
      setErrorMsg(r.error.message);
      setState(null);
      onStateChange?.(null);
    } else {
      setErrorMsg(null);
      setState(r.data);
      onStateChange?.(r.data);
    }
  }, [companyId, onStateChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!companyId) return null;

  if (loading && !state) {
    return (
      <div style={shellStyle("rgba(255,255,255,0.04)", "rgba(255,255,255,0.08)")}>
        <Loader2 size={16} className="animate-spin" style={{ color: "rgba(255,255,255,0.5)" }} />
        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginLeft: 10 }}>
          Loading billing…
        </span>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div style={shellStyle("rgba(255,45,85,0.06)", "rgba(255,45,85,0.25)")}>
        <AlertTriangle size={16} style={{ color: "#FF2D55" }} />
        <span style={{ fontSize: 13, color: "#FF8B9C", marginLeft: 10 }}>{errorMsg}</span>
      </div>
    );
  }

  // No subscription row yet (company was registered but trial not started).
  if (!state || !state.hasSubscription) {
    return (
      <div style={shellStyle("rgba(0,200,224,0.06)", "rgba(0,200,224,0.22)")}>
        <CreditCard size={16} style={{ color: "#00C8E0" }} />
        <div style={{ flex: 1, marginLeft: 10 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#00C8E0" }}>No subscription on file</p>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
            Pick a plan below to start your 14-day free trial.
          </p>
        </div>
      </div>
    );
  }

  const isOwner   = state.isOwner;
  const isTrial   = state.status === "trialing";
  const isActive  = state.status === "active";
  const isPastDue = state.status === "past_due";
  const cancelled = state.cancelAtPeriodEnd;
  const daysLeft  = Math.max(0, Math.floor(state.daysLeftInTrial ?? 0));
  const periodEnd = state.trialEndsAt || state.currentPeriodEnd;

  const accent = isPastDue ? "#FF2D55"
              : (isTrial && daysLeft <= 3) ? "#FF2D55"
              : isTrial ? "#FF9500"
              : isActive ? "#00C853"
              : "#00C8E0";

  const handleUpgrade = async () => {
    if (!companyId) return;
    setActioning("upgrade"); setErrorMsg(null);
    try {
      await startCheckout({
        planId: (state.plan || "starter") as StripePlanId,
        cycle:  (state.billingCycle || "monthly") as StripeCycle,
        companyId,
      });
    } catch (e) {
      setActioning(null);
      setErrorMsg(e instanceof Error ? e.message : "Could not start checkout");
    }
  };

  const handleCancelTrial = async () => {
    if (!companyId) return;
    if (!confirm(`Cancel your trial? You'll keep access until ${formatDate(periodEnd)}, then drop to free tier.`)) return;
    setActioning("cancel"); setErrorMsg(null);
    const r = await cancelCompanyTrial(companyId);
    setActioning(null);
    if (r.error) { setErrorMsg(r.error.message); return; }
    void refresh();
  };

  const handlePortal = async () => {
    if (!companyId) return;
    setActioning("portal"); setErrorMsg(null);
    try {
      await openBillingPortal(undefined, companyId);
    } catch (e) {
      setActioning(null);
      const m = e instanceof Error ? e.message : "Could not open portal";
      setErrorMsg(m === "NO_STRIPE_CUSTOMER" ? "No payment method on file yet — Upgrade first." : m);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      style={{
        margin: "0 0 16px",
        padding: 18,
        borderRadius: 16,
        background: `linear-gradient(135deg, ${accent}14, ${accent}06)`,
        border: `1.5px solid ${accent}38`,
        fontFamily: "'Outfit', sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: `${accent}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {isPastDue ? <AlertTriangle size={16} style={{ color: accent }} />
           : isTrial   ? <Calendar      size={16} style={{ color: accent }} />
           : isActive  ? <CheckCircle2  size={16} style={{ color: accent }} />
                       : <CreditCard    size={16} style={{ color: accent }} />}
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: accent, letterSpacing: "-0.2px" }}>
            {isPastDue ? "Payment failed — update your card"
             : isTrial   ? (cancelled ? "Trial cancelled — runs to deadline"
                                       : (daysLeft <= 3 ? `Trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}` : `${daysLeft} days left in trial`))
             : isActive  ? "Subscription active"
                         : `Status: ${state.status || "unknown"}`}
          </p>
          <p style={{ margin: "3px 0 0", fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
            {(state.plan || "—").replace(/^./, c => c.toUpperCase())} • {state.billingCycle || "monthly"} • {periodEnd ? `next event ${formatDate(periodEnd)}` : "no period set"}
            {state.dpaVersion && <span style={{ color: "rgba(255,255,255,0.3)" }}> • DPA v{state.dpaVersion}{state.dpaAccepted ? " ✓" : " ⚠"}</span>}
          </p>
        </div>
      </div>

      {/* Action row — visibility per role + state */}
      {isOwner && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {(isTrial || isPastDue) && (
            <ActionBtn
              label={isPastDue ? "Fix payment" : "Upgrade now"}
              busy={actioning === "upgrade"}
              accent={accent}
              onClick={handleUpgrade}
              icon={<ArrowRight size={12} />}
            />
          )}
          {isActive && state.stripeCustomerId && (
            <ActionBtn
              label="Manage payment"
              busy={actioning === "portal"}
              accent={accent}
              onClick={handlePortal}
              icon={<CreditCard size={12} />}
            />
          )}
          {isTrial && !cancelled && (
            <SecondaryBtn
              label="Cancel trial"
              busy={actioning === "cancel"}
              onClick={handleCancelTrial}
              icon={<Ban size={12} />}
            />
          )}
          {!state.dpaAccepted && (
            <SecondaryBtn
              label={`Sign DPA v${state.dpaVersion || "?"}`}
              busy={false}
              onClick={() => alert("DPA acceptance lives in Settings → Company. Coming in a follow-up.")}
              icon={<ShieldCheck size={12} />}
            />
          )}
        </div>
      )}

      {!isOwner && (
        <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
          Only the company owner can change billing.
        </p>
      )}
    </motion.div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function shellStyle(bg: string, border: string): React.CSSProperties {
  return {
    margin: "0 0 16px", padding: "14px 16px", borderRadius: 12,
    background: bg, border: `1px solid ${border}`,
    display: "flex", alignItems: "center",
    fontFamily: "'Outfit', sans-serif",
  };
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return iso; }
}

function ActionBtn({ label, busy, accent, onClick, icon }: {
  label: string; busy: boolean; accent: string; onClick: () => void; icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        padding: "9px 14px", borderRadius: 10, border: "none",
        background: busy ? "rgba(255,255,255,0.08)" : accent,
        color: busy ? "rgba(255,255,255,0.45)" : "#0A0E17",
        fontSize: 12, fontWeight: 700,
        cursor: busy ? "default" : "pointer",
        display: "inline-flex", alignItems: "center", gap: 6,
      }}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : icon}
      {busy ? "Working…" : label}
    </button>
  );
}

function SecondaryBtn({ label, busy, onClick, icon }: {
  label: string; busy: boolean; onClick: () => void; icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        padding: "9px 14px", borderRadius: 10,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.1)",
        color: "rgba(255,255,255,0.85)",
        fontSize: 12, fontWeight: 600,
        cursor: busy ? "default" : "pointer",
        display: "inline-flex", alignItems: "center", gap: 6,
      }}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}
