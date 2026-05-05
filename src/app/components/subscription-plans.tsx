import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronLeft, Check, X, Crown, Shield, Zap,
  Users, Mic, Timer, FileText, Clock, MapPin,
  Heart, Star, Building2, ChevronRight, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { INDIVIDUAL_PLANS } from "../constants/pricing";
import { TrialCard } from "./trial-card";
// B-17 (2026-04-25): real Stripe Checkout instead of the previous
// 2-second fake animation. The supabase-client and edge function are
// loaded lazily so the upgrade screen still mounts when offline /
// unconfigured (it just shows the error toast on click).
import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";
import { getStoredUser } from "./api/safe-rpc";

// ─── Types ─────────────────────────────────────────────────────────────────────
type BillingCycle = "monthly" | "yearly";

interface PlanFeature {
  label: string;
  free: string | boolean;
  pro: string | boolean;
  icon: typeof Check;
}

const features: PlanFeature[] = [
  { label: "Safety Contacts", free: "1 track + 1 ghost", pro: "Unlimited", icon: Users },
  { label: "Location Updates", free: "Every 5 min", pro: "Real-time (30s)", icon: MapPin },
  { label: "Emergency Ripple", free: "2 waves", pro: "3 waves + auto-call", icon: Users },
  { label: "Voice Recording", free: "60s", pro: "5 min", icon: Mic },
  { label: "Dead Man's Switch", free: "Fixed times", pro: "Full custom", icon: Timer },
  { label: "Incident History", free: "7 days", pro: "90 days", icon: Clock },
  { label: "PDF Export", free: false, pro: true, icon: FileText },
  { label: "Safe Walk Mode", free: false, pro: true, icon: MapPin },
  { label: "Medical QR Badge", free: false, pro: true, icon: Heart },
  { label: "Family Circle", free: "2 members", pro: "Unlimited", icon: Users },
  { label: "Geofencing Zones", free: false, pro: "10 zones", icon: MapPin },
  { label: "Smart Alerts (AI)", free: false, pro: true, icon: Star },
  { label: "Priority Support", free: false, pro: true, icon: Star },
];

// ─── Props ─────────────────────────────────────────────────────────────────────
interface SubscriptionPlansProps {
  onBack: () => void;
  currentPlan: "free" | "pro" | "employee";
  onUpgrade?: (plan: "pro") => void;
}

export function SubscriptionPlans({ onBack, currentPlan, onUpgrade }: SubscriptionPlansProps) {
  const [billing, setBilling] = useState<BillingCycle>("yearly");
  const [showSuccess, setShowSuccess] = useState(false);

  const personalPlan = INDIVIDUAL_PLANS.find(p => p.id === "personal")!;
  const monthlyPrice = personalPlan.monthlyPrice;
  const yearlyPrice = personalPlan.annualPrice;
  const yearlyMonthly = (yearlyPrice / 12).toFixed(2);
  const yearlySavings = Math.round(monthlyPrice * 12 - yearlyPrice);

  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [isUpgrading, setIsUpgrading] = useState(false);

  // ──────────────────────────────────────────────────────────────
  // B-17 (2026-04-25): real upgrade flow.
  //
  // Pre-fix: setShowSuccess(true) → setTimeout 2s → onUpgrade("pro").
  //   No money taken, no Stripe row, no audit. Pure UI lie.
  //
  // New flow:
  //   1. Validate Supabase + active session (must be logged in to
  //      attribute the subscription).
  //   2. POST to the stripe-checkout edge function with
  //      { planId: "elite", cycle }.
  //   3. Receive { url } and redirect the browser to Stripe Checkout.
  //   4. Stripe handles card collection + 3DS + success/cancel.
  //   5. On success URL return, the webhook will have written the
  //      subscriptions row server-side. The mobile-app's session
  //      restore re-reads userPlan from there. We do NOT flip
  //      userPlan locally — the server is the only source of truth.
  // ──────────────────────────────────────────────────────────────
  const handleUpgrade = async () => {
    if (isUpgrading) return;
    setUpgradeError(null);
    if (!SUPABASE_CONFIG.isConfigured) {
      setUpgradeError("Payments are not configured in this build. Please try again from a release build.");
      return;
    }
    setIsUpgrading(true);
    try {
      // E1.6-PHASE3 (2026-05-04): JWT-from-localStorage; never block upgrade on auth lock.
      const u = getStoredUser();
      if (!u) {
        setUpgradeError("Please sign in before upgrading.");
        setIsUpgrading(false);
        return;
      }
      const cycle = billing === "yearly" ? "annual" : "monthly";
      const { data, error } = await supabase.functions.invoke("stripe-checkout", {
        body: {
          planId: "elite",
          cycle,
          // The success_url is observed by the webhook side via
          // checkout.session.completed; we just need to land somewhere
          // the app can pick up the new state on next session-restore.
          successUrl: window.location.origin + "/billing?ok=1",
          cancelUrl:  window.location.origin + "/billing?cancelled=1",
        },
      });
      if (error) {
        setUpgradeError(`Could not start checkout: ${error.message ?? "unknown error"}`);
        setIsUpgrading(false);
        return;
      }
      const url = (data as { url?: string } | null)?.url;
      if (!url) {
        setUpgradeError("Checkout URL missing from server response.");
        setIsUpgrading(false);
        return;
      }
      // Hand off to Stripe. We do NOT flip userPlan locally — the
      // webhook will update subscriptions on success.
      toast.loading("Redirecting to secure checkout…", { id: "stripe-redirect" });
      window.location.assign(url);
      // Briefly keep the spinner visible in case the redirect is slow.
      setTimeout(() => setIsUpgrading(false), 6000);
    } catch (e) {
      setUpgradeError(e instanceof Error ? e.message : "Unexpected error");
      setIsUpgrading(false);
    }
  };

  if (currentPlan === "employee") {
    return (
      <div className="relative flex flex-col h-full overflow-hidden" style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>
        <div className="shrink-0 pt-[58px] px-5 pb-3">
          <div className="flex items-center">
            <button onClick={onBack} className="flex items-center gap-1 -ml-1 p-1">
              <ChevronLeft style={{ width: 20, height: 20, color: "#00C8E0" }} />
              <span style={{ fontSize: 15, color: "#00C8E0", fontWeight: 500 }}>Profile</span>
            </button>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="size-20 rounded-[22px] flex items-center justify-center mb-5"
            style={{ background: "rgba(0,200,224,0.06)", border: "1.5px solid rgba(0,200,224,0.12)" }}
          >
            <Building2 style={{ width: 32, height: 32, color: "#00C8E0" }} />
          </motion.div>
          <h2 className="text-white mb-2" style={{ fontSize: 22, fontWeight: 700 }}>Company Plan</h2>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", lineHeight: 1.7, marginBottom: 20 }}>
            All premium features are included in your company subscription. No additional payment required.
          </p>
          <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderRadius: 12, background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.12)" }}>
            <Check style={{ width: 14, height: 14, color: "#00C853" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#00C853" }}>All Features Unlocked</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-full overflow-hidden" style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>
      {/* Ambient */}
      <div className="absolute top-[-80px] left-1/2 -translate-x-1/2 pointer-events-none"
        style={{ width: 500, height: 400, background: "radial-gradient(ellipse, rgba(0,200,224,0.04) 0%, transparent 60%)" }}
      />

      {/* Header */}
      <div className="shrink-0 pt-[58px] px-5 pb-2">
        <div className="flex items-center">
          <button onClick={onBack} className="flex items-center gap-1 -ml-1 p-1">
            <ChevronLeft style={{ width: 20, height: 20, color: "#00C8E0" }} />
            <span style={{ fontSize: 15, color: "#00C8E0", fontWeight: 500 }}>Profile</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 pb-10" style={{ scrollbarWidth: "none" }}>
        {/* Title */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-5">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Crown style={{ width: 22, height: 22, color: "#FFD700" }} />
          </div>
          <h1 className="text-white mb-1" style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" }}>
            Upgrade to <span style={{ color: "#00C8E0" }}>Pro</span>
          </h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", lineHeight: 1.6 }}>
            Maximum protection for you and your loved ones
          </p>
        </motion.div>

        {/* Phase 10 — Free Elite trial CTA. Self-contained; reads
             its state from trial-service and does not depend on the
             legacy pro/free props on this page. Shown only when the
             user hasn't already purchased Elite. */}
        <TrialCard
          onRequestUpgrade={() => {
            // Scroll the existing upgrade CTA into view — reuses the
            // page's own primary flow instead of introducing a new one.
            try {
              const el = document.querySelector<HTMLElement>("[data-upgrade-cta]");
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
            } catch {}
          }}
        />

        {/* Billing Toggle */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="flex justify-center mb-5"
        >
          <div className="relative flex p-[3px]" style={{ borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <motion.div
              className="absolute top-[3px] bottom-[3px]"
              style={{
                width: "calc(50% - 3px)", borderRadius: 12,
                background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.18)",
              }}
              animate={{ left: billing === "monthly" ? 3 : "calc(50%)" }}
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
            />
            {(["monthly", "yearly"] as BillingCycle[]).map(b => (
              <button
                key={b}
                onClick={() => setBilling(b)}
                className="relative z-10 flex items-center justify-center gap-1.5 px-5 py-2.5"
              >
                <span style={{
                  fontSize: 13, fontWeight: billing === b ? 700 : 500,
                  color: billing === b ? "#00C8E0" : "rgba(255,255,255,0.25)",
                }}>
                  {b === "monthly" ? "Monthly" : "Yearly"}
                </span>
                {b === "yearly" && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, color: "#00C853",
                    background: "rgba(0,200,83,0.1)", border: "1px solid rgba(0,200,83,0.2)",
                    borderRadius: 6, padding: "1px 5px",
                  }}>
                    -${yearlySavings}
                  </span>
                )}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Plan Cards */}
        <div className="grid grid-cols-2 gap-2.5 mb-5">
          {/* Free Plan */}
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
            className="p-4 relative"
            style={{
              borderRadius: 20,
              background: currentPlan === "free" ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.015)",
              border: currentPlan === "free" ? "1.5px solid rgba(0,200,224,0.15)" : "1px solid rgba(255,255,255,0.04)",
            }}
          >
            {currentPlan === "free" && (
              <div className="absolute top-3 right-3 px-2 py-0.5" style={{ borderRadius: 6, background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}>
                <span style={{ fontSize: 8, fontWeight: 700, color: "#00C8E0", letterSpacing: "0.5px" }}>CURRENT</span>
              </div>
            )}
            <Shield style={{ width: 20, height: 20, color: "rgba(255,255,255,0.2)", marginBottom: 8 }} />
            <p className="text-white" style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>Free</p>
            <p style={{ fontSize: 24, fontWeight: 900, color: "rgba(255,255,255,0.5)", marginBottom: 2 }}>
              $0<span style={{ fontSize: 11, fontWeight: 400 }}>/mo</span>
            </p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", lineHeight: 1.5 }}>
              Basic safety features
            </p>
          </motion.div>

          {/* Pro Plan */}
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="p-4 relative overflow-hidden"
            style={{
              borderRadius: 20,
              background: "rgba(0,200,224,0.03)",
              border: currentPlan === "pro" ? "1.5px solid rgba(0,200,224,0.25)" : "1.5px solid rgba(0,200,224,0.1)",
              boxShadow: "0 4px 24px rgba(0,200,224,0.05)",
            }}
          >
            {/* Glow */}
            <div className="absolute top-0 right-0 w-24 h-24 pointer-events-none"
              style={{ background: "radial-gradient(circle at top right, rgba(0,200,224,0.08), transparent 70%)" }}
            />
            {currentPlan === "pro" && (
              <div className="absolute top-3 right-3 px-2 py-0.5" style={{ borderRadius: 6, background: "rgba(0,200,83,0.1)", border: "1px solid rgba(0,200,83,0.2)" }}>
                <span style={{ fontSize: 8, fontWeight: 700, color: "#00C853", letterSpacing: "0.5px" }}>ACTIVE</span>
              </div>
            )}
            <Crown style={{ width: 20, height: 20, color: "#FFD700", marginBottom: 8 }} />
            <p className="text-white" style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>Pro</p>
            <p style={{ fontSize: 24, fontWeight: 900, color: "#00C8E0", marginBottom: 2 }}>
              ${billing === "monthly" ? monthlyPrice : yearlyMonthly}
              <span style={{ fontSize: 11, fontWeight: 400, color: "rgba(0,200,224,0.5)" }}>/mo</span>
            </p>
            {billing === "yearly" && (
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
                ${yearlyPrice}/year
              </p>
            )}
          </motion.div>
        </div>

        {/* Feature Comparison */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="mb-5"
        >
          <p style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>
            Feature Comparison
          </p>
          <div className="space-y-0" style={{ borderRadius: 18, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)", overflow: "hidden" }}>
            {features.map((feature, i) => (
              <div
                key={feature.label}
                className="flex items-center px-4 py-3"
                style={{ borderBottom: i < features.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}
              >
                <feature.icon style={{ width: 13, height: 13, color: "rgba(255,255,255,0.15)", marginRight: 10, flexShrink: 0 }} />
                <span className="flex-1" style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>
                  {feature.label}
                </span>
                {/* Free value */}
                <div className="w-14 text-center" style={{ marginRight: 8 }}>
                  {typeof feature.free === "boolean" ? (
                    feature.free ? (
                      <Check style={{ width: 13, height: 13, color: "#00C853", margin: "0 auto" }} />
                    ) : (
                      <X style={{ width: 13, height: 13, color: "rgba(255,255,255,0.08)", margin: "0 auto" }} />
                    )
                  ) : (
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontWeight: 500 }}>{feature.free}</span>
                  )}
                </div>
                {/* Pro value */}
                <div className="w-14 text-center">
                  {typeof feature.pro === "boolean" ? (
                    feature.pro ? (
                      <Check style={{ width: 13, height: 13, color: "#00C8E0", margin: "0 auto" }} />
                    ) : (
                      <X style={{ width: 13, height: 13, color: "rgba(255,255,255,0.08)", margin: "0 auto" }} />
                    )
                  ) : (
                    <span style={{ fontSize: 10, color: "#00C8E0", fontWeight: 600 }}>{feature.pro}</span>
                  )}
                </div>
              </div>
            ))}
            {/* Header labels */}
          </div>
          {/* Column labels */}
          <div className="flex items-center px-4 mt-2">
            <div className="flex-1" />
            <div className="w-14 text-center" style={{ marginRight: 8 }}>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.12)", fontWeight: 600 }}>FREE</span>
            </div>
            <div className="w-14 text-center">
              <span style={{ fontSize: 9, color: "rgba(0,200,224,0.4)", fontWeight: 700 }}>PRO</span>
            </div>
          </div>
        </motion.div>

        {/* Company CTA */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
          className="mb-5 p-4"
          style={{ borderRadius: 18, background: "rgba(255,150,0,0.03)", border: "1px solid rgba(255,150,0,0.08)" }}
        >
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.15)" }}>
              <Building2 style={{ width: 18, height: 18, color: "#FF9500" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>For Companies</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", lineHeight: 1.5 }}>
                Protect your team with bulk pricing
              </p>
            </div>
            <ChevronRight style={{ width: 16, height: 16, color: "rgba(255,150,0,0.4)" }} />
          </div>
        </motion.div>

        {/* Upgrade Button */}
        {currentPlan === "free" && (
          <motion.button
            data-upgrade-cta
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleUpgrade}
            className="w-full flex items-center justify-center gap-2.5 mb-4"
            style={{
              height: 54, borderRadius: 16,
              background: "linear-gradient(135deg, #00C8E0 0%, #00A5C0 100%)",
              color: "#fff", fontSize: 15, fontWeight: 700,
              boxShadow: "0 6px 24px rgba(0,200,224,0.25), 0 0 0 1px rgba(0,200,224,0.1)",
            }}
          >
            <Sparkles style={{ width: 16, height: 16 }} />
            Upgrade to Pro — ${billing === "monthly" ? `${monthlyPrice}/mo` : `${yearlyPrice}/yr`}
          </motion.button>
        )}

        {currentPlan === "pro" && (
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
            className="flex items-center justify-center gap-2 py-3.5 mb-4"
            style={{ borderRadius: 14, background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.12)" }}
          >
            <Check style={{ width: 15, height: 15, color: "#00C853" }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: "#00C853" }}>Pro Plan Active</span>
          </motion.div>
        )}

        {/* Disclaimer */}
        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.1)", textAlign: "center", lineHeight: 1.5 }}>
          Cancel anytime. Secure payment via Stripe. By upgrading you agree to our Terms of Service.
        </p>
      </div>

      {/* Success Overlay */}
      <AnimatePresence>
        {showSuccess && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center"
            style={{ background: "rgba(5,7,14,0.95)", backdropFilter: "blur(20px)" }}
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className="size-20 rounded-full flex items-center justify-center mb-5"
              style={{ background: "rgba(0,200,83,0.1)", border: "2px solid rgba(0,200,83,0.2)", boxShadow: "0 0 40px rgba(0,200,83,0.15)" }}
            >
              <Check style={{ width: 36, height: 36, color: "#00C853" }} />
            </motion.div>
            <motion.p
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="text-white mb-2"
              style={{ fontSize: 22, fontWeight: 800 }}
            >
              Welcome to Pro!
            </motion.p>
            <motion.p
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
              style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}
            >
              All features are now unlocked
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}