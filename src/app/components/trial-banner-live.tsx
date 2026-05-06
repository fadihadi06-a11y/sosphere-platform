/**
 * trial-banner.tsx — AUTH-5 P4 (#175). Exported as LiveTrialBanner
 * to avoid collision with the legacy localStorage-driven TrialBanner that
 * still lives inside company-dashboard.tsx (slated for removal once this
 * server-of-truth banner has soaked).
 *
 * Sticky countdown banner shown at the top of the owner's dashboard
 * while the company is in a trial. Reads server-of-truth state via
 * get_company_subscription_state — never trusts localStorage for
 * billing decisions (trivially tamperable on shared devices).
 *
 * Visibility rules:
 *   • status === "trialing"          → show countdown (orange)
 *   • status === "trialing" && days_left ≤ 3 → show urgent variant (red)
 *   • status === "past_due"          → show payment-failed banner (red)
 *   • dpa_accepted === false         → show DPA renewal banner (cyan)
 *   • everything else                → render nothing
 *
 * Cancellation:
 *   • the X button hides the banner ONLY for the current tab session
 *     (sessionStorage). The next tab/restart shows it again — this is
 *     intentional: an owner can dismiss it for now but cannot make it
 *     go away forever via UI alone. Matches Linear/Notion behaviour.
 *
 * Buttons:
 *   • "Upgrade Now" → startCheckout({ companyId, planId, cycle }).
 *     The edge function forwards the existing trial_ends_at to Stripe
 *     (subscription_data[trial_end]) so the trial deadline is honored
 *     — paying mid-trial upgrades but does not extend.
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Clock, AlertTriangle, ShieldCheck, X, ArrowRight } from "lucide-react";
import {
  getCompanySubscriptionState,
  type CompanySubscriptionState,
} from "./api/company-subscription-client";
import { startCheckout, type StripePlanId, type StripeCycle } from "./stripe-service";

const DISMISS_KEY = "sosphere_trial_banner_dismissed_v1";

interface LiveTrialBannerProps {
  /** Active company. If null/empty the banner renders nothing. */
  companyId: string | null | undefined;
  /** Optional: tucks the banner under a top bar of this height. */
  topOffset?: number;
}

export function LiveTrialBanner({ companyId, topOffset = 0 }: LiveTrialBannerProps) {
  const [state, setState]   = useState<CompanySubscriptionState | null>(null);
  const [busy, setBusy]     = useState(false);
  const [hidden, setHidden] = useState<boolean>(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });

  // Refresh state on mount + every 5 minutes (covers trial expiry mid-session).
  useEffect(() => {
    if (!companyId) { setState(null); return; }
    let cancelled = false;
    const load = async () => {
      const r = await getCompanySubscriptionState(companyId);
      if (!cancelled && r.data) setState(r.data);
    };
    void load();
    const id = window.setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [companyId]);

  if (hidden || !state || !state.hasSubscription) return null;

  // Decide which variant to render.
  const daysLeft = Math.max(0, Math.floor(state.daysLeftInTrial ?? 0));
  const variant = decideVariant(state, daysLeft);
  if (!variant) return null;

  const handleUpgrade = async () => {
    if (!companyId) return;
    setBusy(true);
    try {
      const planId = (state.plan || "starter") as StripePlanId;
      const cycle  = ((state.billingCycle || "monthly") as StripeCycle);
      // World-class UX: redirect to Stripe with current trial_end honored
      // server-side — paying mid-trial upgrades but does not extend.
      await startCheckout({ planId, cycle, companyId });
    } catch (e) {
      console.warn("[TrialBanner] startCheckout failed:", e);
      setBusy(false);
    }
  };

  const handleDismiss = () => {
    setHidden(true);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* */ }
  };

  return (
    <AnimatePresence>
      <motion.div
        key={`trial-banner-${variant.kind}`}
        role="status"
        aria-live="polite"
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -24, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 32 }}
        style={{
          position: "sticky",
          top: topOffset,
          zIndex: 40,
          margin: "12px 16px 0",
          padding: "12px 14px",
          borderRadius: 14,
          background: variant.bg,
          border: `1.5px solid ${variant.border}`,
          boxShadow: variant.shadow,
          fontFamily: "'Outfit', sans-serif",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 36, height: 36, borderRadius: 10,
            background: `${variant.accent}24`,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {variant.icon}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: variant.accent, letterSpacing: "-0.2px" }}>
            {variant.title}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "rgba(255,255,255,0.62)", lineHeight: 1.5 }}>
            {variant.body}
          </p>
        </div>

        {variant.cta && (
          <button
            onClick={handleUpgrade}
            disabled={busy}
            style={{
              padding: "9px 14px",
              borderRadius: 10,
              border: "none",
              background: busy ? "rgba(255,255,255,0.08)" : variant.accent,
              color: busy ? "rgba(255,255,255,0.5)" : "#0A0E17",
              fontSize: 12, fontWeight: 700,
              cursor: busy ? "default" : "pointer",
              display: "inline-flex", alignItems: "center", gap: 6,
              flexShrink: 0,
            }}
          >
            {busy ? "Redirecting…" : variant.cta}
            {!busy && <ArrowRight size={12} />}
          </button>
        )}

        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: "rgba(255,255,255,0.4)", padding: 4, display: "flex",
          }}
        >
          <X size={14} />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Variant decision tree ──────────────────────────────────────────────

interface BannerVariant {
  kind:   "trial_ok" | "trial_urgent" | "past_due" | "dpa_renew";
  title:  string;
  body:   string;
  cta:    string | null;
  icon:   React.ReactNode;
  accent: string;   // text + button bg
  bg:     string;   // backdrop gradient
  border: string;
  shadow: string;
}

function decideVariant(s: CompanySubscriptionState, daysLeft: number): BannerVariant | null {
  // DPA renewal is highest priority — without acceptance, no billing changes
  // can land. Show this even on inactive trials so the owner can re-sign.
  if (!s.dpaAccepted) {
    return {
      kind:   "dpa_renew",
      title:  "Action required: DPA acceptance",
      body:   `The Data Processing Agreement (v${s.dpaVersion || "?"}) has not been accepted. Trial activation is blocked until you sign.`,
      cta:    null, // a real renewal click goes through Settings (signer attestation)
      icon:   <ShieldCheck size={18} style={{ color: "#00C8E0" }} />,
      accent: "#00C8E0",
      bg:     "linear-gradient(135deg, rgba(0,200,224,0.12), rgba(0,200,224,0.06))",
      border: "rgba(0,200,224,0.35)",
      shadow: "0 4px 20px rgba(0,200,224,0.18)",
    };
  }

  if (s.status === "past_due") {
    return {
      kind:   "past_due",
      title:  "Payment failed",
      body:   "Your last invoice could not be charged. Update your card to keep your team protected.",
      cta:    "Fix payment",
      icon:   <AlertTriangle size={18} style={{ color: "#FF2D55" }} />,
      accent: "#FF2D55",
      bg:     "linear-gradient(135deg, rgba(255,45,85,0.14), rgba(255,45,85,0.06))",
      border: "rgba(255,45,85,0.4)",
      shadow: "0 4px 20px rgba(255,45,85,0.22)",
    };
  }

  if (s.status === "trialing") {
    if (daysLeft <= 3) {
      return {
        kind:   "trial_urgent",
        title:  daysLeft === 0
          ? "Your trial expires today"
          : `Trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
        body:   "Add a card to keep all features active. Paying now does not shorten your remaining trial.",
        cta:    "Upgrade now",
        icon:   <AlertTriangle size={18} style={{ color: "#FF2D55" }} />,
        accent: "#FF2D55",
        bg:     "linear-gradient(135deg, rgba(255,45,85,0.14), rgba(255,45,85,0.06))",
        border: "rgba(255,45,85,0.4)",
        shadow: "0 4px 20px rgba(255,45,85,0.22)",
      };
    }
    return {
      kind:   "trial_ok",
      title:  `${daysLeft} days left in your trial`,
      body:   `${(s.plan || "starter").replace(/^./, (c) => c.toUpperCase())} plan • ${s.billingCycle || "monthly"} billing once trial ends. Cancel anytime.`,
      cta:    "Upgrade now",
      icon:   <Clock size={18} style={{ color: "#FF9500" }} />,
      accent: "#FF9500",
      bg:     "linear-gradient(135deg, rgba(255,149,0,0.12), rgba(255,149,0,0.05))",
      border: "rgba(255,149,0,0.32)",
      shadow: "0 4px 20px rgba(255,149,0,0.2)",
    };
  }

  // active / canceled / inactive — nothing to surface here.
  return null;
}
