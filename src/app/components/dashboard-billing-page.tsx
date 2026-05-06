import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "motion/react";
import {
  Shield, Zap, Crown, Rocket, CheckCircle2, FileText, Download,
  TrendingUp, Cpu, Layers, UserCheck, Plus, ToggleLeft, ToggleRight,
  AlertTriangle, Clock,
} from "lucide-react";
import { Card as DSCard, Badge, Divider } from "./design-system";
import { employeeUsagePercent, createCompanyState, trialDaysRemaining, isTrial as isTrialFn, isTrialExpired, type PlanTier } from "./mobile-company";
import { LiveBillingPanel } from "./live-billing-panel";  // AUTH-5 P4b (#175)
import { toast } from "sonner";
import { hapticSuccess, hapticLight } from "./haptic-feedback";
import { UNIFIED_PLANS, ADDONS as PRICING_ADDONS, getPlanById, annualSavings, calculateMonthlyBill } from "../constants/pricing";
import { useDashboardStore } from "./stores/dashboard-store";
import { storeJSONSync, loadJSONSync } from "./api/storage-adapter";
import { startCheckout, openBillingPortal, isPaidPlan } from "./stripe-service";

// ═══════════════════════════════════════════════════════════════
// Billing Page — New Flat-Rate Pricing Model
// [SUPABASE_READY] — All mock data marked, handlers ready for async migration
// ═══════════════════════════════════════════════════════════════

const PLAN_ICON_MAP: Record<string, any> = { starter: Shield, growth: Zap, business: Rocket, enterprise: Crown };
const ADDON_ICON_MAP: Record<string, any> = { extra_reports: FileText, twilio_sms: TrendingUp, extra_zones: Layers, advanced_gps: Cpu, custom_branding: UserCheck };
const ADDON_COLOR_MAP: Record<string, string> = { extra_reports: "#7B5EFF", twilio_sms: "#00C8E0", extra_zones: "#FF9500", advanced_gps: "#00C853", custom_branding: "#F59E0B" };

// ── Customer Rights Data ────────────────────────────────────────
const CUSTOMER_RIGHTS = [
  { emoji: "💰", title: "Full Refund", description: "Not satisfied within the first 7 days of your subscription? We refund you in full, no questions asked.", badge: "7-day money-back guarantee", color: "#00C853" },
  { emoji: "📦", title: "Your Data Belongs to You", description: "Your company and employee data is 100% yours. Upon cancellation, get a full export within 30 days.", badge: "Full export on request", color: "#00C8E0" },
  { emoji: "🚫", title: "Cancel Anytime", description: "Cancel your subscription anytime from this page with one click. No calls, no complicated process.", badge: "Instant cancellation", color: "#FF9500" },
  // B-18 (2026-04-25): "Guaranteed" replaced with "First". The contractual
  // commitments live in the Privacy Policy + DPA — a banner describes them
  // but cannot itself constitute the guarantee.
  { emoji: "🔒", title: "Privacy First", description: "We never sell your data to third parties. Employee data is fully deleted 30 days after cancellation. See our Privacy Policy for the full commitment.", badge: "No third-party sharing", color: "#7B5EFF" },
  { emoji: "🔔", title: "Renewal Notice", description: "SOSphere sends you an email 7 days before every automatic renewal with full amount details.", badge: "7-day advance notice", color: "#F59E0B" },
  { emoji: "🆘", title: "SOS Always Works", description: "Even if your trial ends or payment is delayed, the SOS system never stops. Your team safety comes first.", badge: "SOS never blocked", color: "#FF2D55" },
];

function CustomerRightsSection({ compact = false }: { compact?: boolean }) {
  useEffect(() => {
    console.log("[SUPABASE_READY] customer_rights_viewed");
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="rounded-2xl overflow-hidden"
      style={{ border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.015)" }}
    >
      <div className={compact ? "px-4 py-3.5" : "px-6 py-5"} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)" }}>
            <Shield className="size-4" style={{ color: "#00C8E0" }} />
          </div>
          <div>
            <p className="text-white" style={{ fontSize: compact ? 14 : 16, fontWeight: 800 }}>
              🛡️ Your Rights as a Customer
            </p>
            <p style={{ fontSize: compact ? 10 : 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
              We commit to these guarantees at all times
            </p>
          </div>
        </div>
      </div>

      <div className={compact ? "grid grid-cols-1 gap-2.5 p-4" : "grid grid-cols-2 gap-4 p-6"}>
        {CUSTOMER_RIGHTS.map((right, i) => (
          <motion.div
            key={right.title}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55 + i * 0.06 }}
            className={compact ? "p-3.5 rounded-xl" : "p-5 rounded-2xl"}
            style={{
              background: `${right.color}04`,
              border: `1px solid ${right.color}12`,
            }}
          >
            <div className="flex items-start gap-3">
              <div className={compact ? "size-8 rounded-lg flex items-center justify-center flex-shrink-0" : "size-10 rounded-xl flex items-center justify-center flex-shrink-0"}
                style={{ background: `${right.color}10`, border: `1px solid ${right.color}18` }}>
                <span style={{ fontSize: compact ? 16 : 20 }}>{right.emoji}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white" style={{ fontSize: compact ? 12 : 14, fontWeight: 700 }}>
                  {right.title}
                </p>
                <p style={{
                  fontSize: compact ? 10 : 12,
                  color: "rgba(255,255,255,0.4)",
                  lineHeight: 1.6,
                  marginTop: compact ? 3 : 4,
                }}>
                  {right.description}
                </p>
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-md mt-2.5"
                  style={{
                    fontSize: compact ? 8 : 9,
                    fontWeight: 700,
                    color: right.color,
                    background: `${right.color}10`,
                    border: `1px solid ${right.color}18`,
                    letterSpacing: "0.3px",
                  }}
                >
                  {right.badge}
                </span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className={compact ? "px-4 py-3" : "px-6 py-4"} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="flex items-center justify-between">
          <p style={{ fontSize: compact ? 9 : 11, color: "rgba(255,255,255,0.2)" }}>
            Last updated: March 2026
          </p>
          <button
            onClick={() => toast("Terms of Service", { description: "Full terms document would open in a new tab" })}
            style={{
              fontSize: compact ? 9 : 11,
              fontWeight: 600,
              color: "#00C8E0",
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            Read full Terms →
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/** Load active addon states from localStorage */
function loadActiveAddons(): Record<string, boolean> {
  return loadJSONSync<Record<string, boolean>>("sosphere_active_addons", {});
}

export function BillingPage({ companyState, webMode = false }: {
  onNavigate?: (p: string) => void;
  companyState: ReturnType<typeof createCompanyState>;
  webMode?: boolean;
}) {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">(() => {
    const saved = loadJSONSync<{ billingCycle?: "monthly" | "annual" } | null>("billing_prefs", null);
    return saved?.billingCycle || "monthly";
  });
  const { setCompanyState, employees: storeEmployees } = useDashboardStore();

  // ── Read plan from companyState ──
  const currentPlanId = companyState.company.plan ?? "starter";
  const currentPlanDef = getPlanById(currentPlanId);
  const currentPlanColor = currentPlanDef?.color ?? "#00C8E0";
  const currentPlanName = currentPlanDef?.name ?? "Starter";
  const currentPlanMonthly = currentPlanDef?.monthlyPrice ?? 149;
  const currentPlanAnnualMonthly = currentPlanDef?.annualMonthly ?? 119;
  const currentPlanDescription = currentPlanDef?.description ?? "For small teams";
  const currentAnnualSavings = currentPlanDef ? annualSavings(currentPlanDef) : 0;

  // ── Addon State with localStorage persistence (PART D) ──
  const [activeAddons, setActiveAddons] = useState<Record<string, boolean>>(() => loadActiveAddons());

  const activeAddonIds = useMemo(
    () => PRICING_ADDONS.filter(a => activeAddons[a.id]).map(a => a.id),
    [activeAddons],
  );
  const addonsTotal = useMemo(
    () => PRICING_ADDONS.reduce((sum, a) => sum + (activeAddons[a.id] ? a.price : 0), 0),
    [activeAddons],
  );

  const toggleAddon = useCallback((addonId: string) => {
    setActiveAddons(prev => {
      const next = { ...prev, [addonId]: !prev[addonId] };
      storeJSONSync("sosphere_active_addons", next);
      const newAddonsTotal = PRICING_ADDONS.reduce((s, a) => s + (next[a.id] ? a.price : 0), 0);
      const planDef = getPlanById(currentPlanId);
      const baseCost = planDef ? (billingCycle === "annual" ? planDef.annualMonthly : planDef.monthlyPrice) : 0;
      // Item 4: Employee count = employees.length from store
      const extraEmp = planDef && planDef.maxEmployees > 0 ? Math.max(0, storeEmployees.length - planDef.maxEmployees) : 0;
      const extraCost = extraEmp * (planDef?.extraEmployeePrice ?? 0);
      const newTotal = (baseCost > 0 ? baseCost : 0) + extraCost + newAddonsTotal;
      console.log("[SUPABASE_READY] addon_toggled: " + JSON.stringify({ addonId, active: next[addonId], newTotal }));
      return next;
    });
  }, [billingCycle, storeEmployees.length]);

  // ── Invoices state (mutable — new invoices added on plan switch) ──
  const [extraInvoices, setExtraInvoices] = useState<Array<{
    id: string; date: string; period: string; amount: number;
    seats: number; planName: string; baseCost: number;
    extraCount: number; extraCost: number; addonsCost: number;
  }>>([]);

  /** Plan switch — PART B: recalculate header stats, add invoice, toast with total */
  // P3-#10: Paid plans go through Stripe Checkout (browser redirects to
  // Stripe's hosted page). On success, the stripe-webhook edge function
  // writes the new subscription row and the user returns to this page.
  // Free / downgrade flows still update local state directly — there's
  // nothing for Stripe to charge.
  const switchPlan = useCallback(async (planId: string) => {
    const oldPlan = currentPlanId;
    const newPlanDef = getPlanById(planId);
    if (!newPlanDef) return;

    // Item 4: Employee count = employees.length from store (not hardcoded)
    const empCount = storeEmployees.length;
    const bill = calculateMonthlyBill(newPlanDef, billingCycle, empCount, activeAddonIds);
    const newTotal = bill.total + addonsTotal;

    // ── Paid plan → Stripe Checkout ───────────────────────────
    // We redirect to Stripe's hosted checkout. The local state update
    // below is skipped because the webhook will write the real source
    // of truth to Supabase when payment completes. We still keep the
    // local fallback path below for dev/offline runs where Stripe isn't
    // configured (the thrown error tells us to fall through).
    if (isPaidPlan(planId)) {
      try {
        hapticLight();
        await startCheckout({
          planId,
          cycle: billingCycle,
          seats: newPlanDef.maxEmployees > 0
            ? Math.max(0, empCount - newPlanDef.maxEmployees)
            : 0,
        });
        // startCheckout does window.location.assign — execution stops.
        return;
      } catch (err) {
        // G-21 (B-20, 2026-04-26): in production NEVER fall through to
        // the legacy mock-invoice path. Pre-fix this catch granted the
        // user the paid plan locally on any Stripe failure (or even a
        // transient network blip) and showed "dev mode" string to real
        // customers. Now: dev fallback gated on import.meta.env.DEV.
        console.error("[billing] Stripe checkout failed:", err);
        if (!import.meta.env.DEV) {
          toast.error("Checkout temporarily unavailable. Please try again in a moment.");
          hapticLight();
          return;
        }
        console.warn("[billing] DEV-ONLY local fallback engaged.");
        toast.error("Stripe unavailable — DEV fallback only.");
      }
    }

    // Update company state (triggers header/sidebar re-render)
    const newState = createCompanyState(planId as PlanTier, "active", empCount);
    setCompanyState(newState);
    storeJSONSync("sos_reg_result", { plan: planId, employeeCount: empCount });

    // Add new invoice entry
    const invNum = 4 + extraInvoices.length + 1;
    const extraCount = newPlanDef.maxEmployees > 0 ? Math.max(0, empCount - newPlanDef.maxEmployees) : 0;
    const extraCost = extraCount * newPlanDef.extraEmployeePrice;
    setExtraInvoices(prev => [{
      id: `INV-2026-${String(invNum).padStart(3, "0")}`,
      date: "Mar 19, 2026",
      period: "March 2026 (pro-rated)",
      amount: newTotal,
      seats: empCount,
      planName: newPlanDef.name,
      baseCost: billingCycle === "annual" ? newPlanDef.annualMonthly : newPlanDef.monthlyPrice,
      extraCount,
      extraCost,
      addonsCost: addonsTotal,
    }, ...prev]);

    hapticSuccess();
    console.log("[SUPABASE_READY] plan_switched: " + JSON.stringify({ oldPlan, newPlan: planId, newMonthly: newTotal }));
    toast.success(`Plan updated to ${newPlanDef.name} — $${newTotal}/month`, {
      description: `Base $${bill.planCost} + ${extraCount > 0 ? `${extraCount} extra employees $${extraCost}` : "no extra employees"} + addons $${addonsTotal}`,
    });
  }, [currentPlanId, billingCycle, storeEmployees.length, activeAddonIds, addonsTotal, extraInvoices.length, setCompanyState]);

  // Persist billing cycle preference
  useEffect(() => {
    storeJSONSync("billing_prefs", { billingCycle });
  }, [billingCycle]);

  // Plans from shared constants
  const PLANS = UNIFIED_PLANS.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.monthlyPrice,
    annualMonthly: p.annualMonthly,
    annualPrice: p.annualPrice,
    color: p.color,
    maxEmployees: p.maxEmployees,
    maxZones: p.maxZones,
    extraEmployeePrice: p.extraEmployeePrice,
    features: p.features.slice(0, 8),
    current: p.id === currentPlanId,
    icon: PLAN_ICON_MAP[p.id] ?? Crown,
    popular: p.popular,
  }));

  // ── Invoice data with extra employees column (PART C) ──
  // Item 4: Employee count = employees.length from store (not hardcoded)
  const empCount = storeEmployees.length;
  const baseExtraCount = currentPlanDef && currentPlanDef.maxEmployees > 0 ? Math.max(0, empCount - currentPlanDef.maxEmployees) : 0;
  const baseExtraCost = baseExtraCount * (currentPlanDef?.extraEmployeePrice ?? 0);
  const invoiceBasePrice = billingCycle === "annual" ? currentPlanAnnualMonthly : currentPlanMonthly;
  const invoiceTotalPrice = (invoiceBasePrice > 0 ? invoiceBasePrice : 0) + baseExtraCost + addonsTotal;

  // SUPABASE_MIGRATION_POINT: INVOICES → supabase.from('invoices').select('*').eq('company_id', companyId).order('date', { ascending: false })
  const BASE_INVOICES = [
    { id: "INV-2026-003", date: "Mar 1, 2026", period: "March 2026", planName: currentPlanName, baseCost: invoiceBasePrice > 0 ? invoiceBasePrice : 0, extraCount: baseExtraCount, extraCost: baseExtraCost, addonsCost: addonsTotal, amount: invoiceTotalPrice, seats: empCount },
    { id: "INV-2026-002", date: "Feb 1, 2026", period: "February 2026", planName: currentPlanName, baseCost: invoiceBasePrice > 0 ? invoiceBasePrice : 0, extraCount: baseExtraCount, extraCost: baseExtraCost, addonsCost: 0, amount: (invoiceBasePrice > 0 ? invoiceBasePrice : 0) + baseExtraCost, seats: empCount },
    { id: "INV-2026-001", date: "Jan 1, 2026", period: "January 2026", planName: currentPlanName, baseCost: invoiceBasePrice > 0 ? invoiceBasePrice : 0, extraCount: baseExtraCount, extraCost: baseExtraCost, addonsCost: 0, amount: (invoiceBasePrice > 0 ? invoiceBasePrice : 0) + baseExtraCost, seats: empCount },
    { id: "INV-2025-012", date: "Dec 1, 2025", period: "December 2025", planName: currentPlanName, baseCost: invoiceBasePrice > 0 ? invoiceBasePrice : 0, extraCount: baseExtraCount, extraCost: baseExtraCost, addonsCost: 0, amount: (invoiceBasePrice > 0 ? invoiceBasePrice : 0) + baseExtraCost, seats: empCount },
  ];
  const ALL_INVOICES = [...extraInvoices, ...BASE_INVOICES];

  const usagePercent = employeeUsagePercent(companyState);

  // Helper: format extra employees display
  const formatExtra = (count: number, cost: number) =>
    count > 0 ? `+${count} employees ($${cost})` : "—";

  // ─── WEB BILLING PAGE ──────────────────────────────────────────
  if (webMode) {
    const billingStatus = companyState.company.billingStatus;
    const daysLeft = trialDaysRemaining(companyState);
    const statusLabel: Record<string, string> = {
      trial: `Trial — ${daysLeft} day${daysLeft !== 1 ? "s" : ""} left`,
      active: "Active",
      trial_expired: "Trial Expired",
      past_due: "Payment Failed",
      suspended: "Suspended",
      cancelled: "Cancelled",
    };
    const statusColor =
      billingStatus === "trial" ? (daysLeft <= 3 ? "#FF9500" : "#FFB300")
      : billingStatus === "active" ? "#00C853"
      : "#FF2D55";

    // Current bill breakdown
    const currentBill = currentPlanDef ? calculateMonthlyBill(currentPlanDef, billingCycle, empCount, activeAddonIds) : null;
    const displayTotal = currentBill ? currentBill.total : invoiceTotalPrice;

    // PART E: Data deletion warning for expired trials
    const trialExpired = isTrialExpired(companyState);
    const daysSinceExpired = trialExpired && companyState.company.trialEndsAt
      ? Math.floor((Date.now() - companyState.company.trialEndsAt.getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    const daysUntilDeletion = Math.max(0, 30 - daysSinceExpired);
    const deletionDate = trialExpired && companyState.company.trialEndsAt
      ? new Date(companyState.company.trialEndsAt.getTime() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : null;

    return (
      <div className="p-6 space-y-7">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-white" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>Billing & Subscription</h1>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>Manage your plan, usage, and payment methods</p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ background: `${statusColor}12`, border: `1px solid ${statusColor}30` }}>
            <motion.div animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 2, repeat: Infinity }} className="size-2 rounded-full" style={{ background: statusColor }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: statusColor }}>{statusLabel[billingStatus] ?? "Active"}</span>
          </div>
        </div>

        {/* AUTH-5 P4b (#175): live server-of-truth billing panel.
            Renders at the very top of the page so the owner sees the
            actual subscription state (status / trial deadline / DPA
            version) before the legacy mock UI below it. Reads via
            get_company_subscription_state RPC; takes ownership of the
            Cancel Trial / Manage Payment / Upgrade buttons which now
            route through the new B2B Stripe edge functions. */}
        <LiveBillingPanel
          companyId={typeof window !== "undefined" ? localStorage.getItem("sosphere_company_id") : null}
        />

        {/* PART E: Data Deletion Warning — shown when trial expired */}
        {trialExpired && deletionDate && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="p-5 rounded-2xl"
            style={{ background: "rgba(127,29,29,0.12)", border: "1.5px solid rgba(239,68,68,0.25)" }}>
            <div className="flex items-start gap-4">
              <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 2, repeat: Infinity }}
                className="size-12 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)" }}>
                <AlertTriangle className="size-6" style={{ color: "#EF4444" }} />
              </motion.div>
              <div className="flex-1">
                <p className="text-white" style={{ fontSize: 16, fontWeight: 800 }}>Data Deletion Warning</p>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.7, marginTop: 4 }}>
                  Reactivate your subscription before <span style={{ color: "#EF4444", fontWeight: 700 }}>{deletionDate}</span> to
                  keep all your data. After this date, all company data will be permanently deleted.
                </p>
                <div className="flex items-center gap-3 mt-4">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)" }}>
                    <Clock className="size-3.5" style={{ color: "#EF4444" }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#EF4444" }}>{daysUntilDeletion} day{daysUntilDeletion !== 1 ? "s" : ""} remaining</span>
                  </div>
                  <button onClick={() => switchPlan("starter")}
                    className="px-4 py-1.5 rounded-lg"
                    style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "linear-gradient(135deg, #00C8E0, #00A0B8)", cursor: "pointer", border: "none" }}>
                    Reactivate Now
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Current plan + Right panel */}
        <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 340px" }}>
          {/* Current plan hero */}
          {(() => {
            const PlanIcon = PLAN_ICON_MAP[currentPlanId] ?? Crown;
            const maxEmp = companyState.planConfig.maxEmployees;
            const displayPrice = billingCycle === "annual" ? currentPlanAnnualMonthly : currentPlanMonthly;
            return (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="p-6 rounded-2xl relative overflow-hidden"
            style={{ background: `linear-gradient(135deg, ${currentPlanColor}18 0%, ${currentPlanColor}08 100%)`, border: `1px solid ${currentPlanColor}40` }}>
            <div className="absolute top-0 right-0 w-64 h-64 pointer-events-none" style={{ background: `radial-gradient(circle, ${currentPlanColor}20 0%, transparent 65%)` }} />
            <div className="relative z-10">
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-4">
                  <div className="size-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: `${currentPlanColor}22`, border: `1px solid ${currentPlanColor}44` }}>
                    <PlanIcon className="size-7" style={{ color: currentPlanColor }} />
                  </div>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 700, color: `${currentPlanColor}AA`, letterSpacing: "1.5px" }}>CURRENT PLAN</p>
                    <p className="text-white mt-0.5" style={{ fontSize: 26, fontWeight: 900, letterSpacing: "-0.5px" }}>{currentPlanName}</p>
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{currentPlanDescription}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p style={{ fontSize: 36, fontWeight: 900, color: currentPlanColor, letterSpacing: "-1px" }}>
                    {currentPlanMonthly > 0 ? `$${displayTotal}` : "Custom"}
                    <span style={{ fontSize: 14, fontWeight: 400, color: "rgba(255,255,255,0.3)" }}>/mo</span>
                  </p>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                    Base ${displayPrice > 0 ? displayPrice : 0} + extras ${baseExtraCost} + addons ${addonsTotal}
                  </p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>Next renewal: Apr 1, 2026</p>
                </div>
              </div>
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>Employee Usage</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: usagePercent > 80 ? "#FF2D55" : "#00C853" }}>
                    {empCount} / {maxEmp === -1 ? "∞" : maxEmp}
                  </span>
                </div>
                <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                  <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(usagePercent, 100)}%` }} transition={{ duration: 1.2, ease: "easeOut" }}
                    className="h-full rounded-full" style={{ background: usagePercent > 80 ? "linear-gradient(90deg, #FF9500, #FF2D55)" : "linear-gradient(90deg, #00C853, #00C8E0)" }} />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Employees",  value: empCount, color: "#00C8E0" },
                  { label: "Max Limit",     value: maxEmp === -1 ? "∞" : maxEmp,       color: "#7B5EFF" },
                  { label: "Monthly Total",  value: currentPlanMonthly > 0 ? `$${displayTotal}` : "Custom", color: currentPlanColor },
                  { label: "Extra /emp",   value: currentPlanDef ? `$${currentPlanDef.extraEmployeePrice}` : "—", color: "#F59E0B" },
                ].map(s => (
                  <div key={s.label} className="text-center p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <p style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</p>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
            );
          })()}

          {/* Right: billing cycle + payment */}
          <div className="space-y-4">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              className="p-5 rounded-2xl" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="text-white mb-3" style={{ fontSize: 13, fontWeight: 700 }}>Billing Cycle</p>
              <div className="flex p-1 rounded-xl mb-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                {(["monthly", "annual"] as const).map(cycle => (
                  <button key={cycle} onClick={() => setBillingCycle(cycle)}
                    className="flex-1 py-2.5 rounded-lg transition-all"
                    style={{ fontSize: 13, fontWeight: 700, background: billingCycle === cycle ? "rgba(0,200,224,0.12)" : "transparent", color: billingCycle === cycle ? "#00C8E0" : "rgba(255,255,255,0.35)", border: billingCycle === cycle ? "1px solid rgba(0,200,224,0.25)" : "1px solid transparent" }}>
                    {cycle === "monthly" ? "Monthly" : "Annual"}
                  </button>
                ))}
              </div>
              {billingCycle === "annual" && currentAnnualSavings > 0 && (
                <div className="p-3 rounded-xl" style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.15)" }}>
                  <p style={{ fontSize: 12, color: "#00C853", fontWeight: 600 }}>💰 Save ${currentAnnualSavings}/year on {currentPlanName} plan</p>
                </div>
              )}
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
              className="p-5 rounded-2xl" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center justify-between mb-4">
                <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>Payment Method</p>
                <button onClick={() => { hapticLight(); toast("Update Payment", { description: "Payment method editor would open here" }); }} className="px-3 py-1.5 rounded-lg" style={{ fontSize: 11, fontWeight: 600, color: "#00C8E0", background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.2)", cursor: "pointer" }}>Update</button>
              </div>
              <div className="p-4 rounded-xl relative overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.06), rgba(123,94,255,0.06))", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex items-center justify-between mb-3">
                  <span style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.5)", letterSpacing: "1px" }}>VISA</span>
                  <div className="flex items-center gap-1.5">
                    <div className="size-2 rounded-full" style={{ background: "#00C853" }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#00C853" }}>Verified</span>
                  </div>
                </div>
                <p className="text-white" style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace", letterSpacing: "3px" }}>•••• •••• •••• 4242</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 6 }}>Expires 08/2027 · John Doe</p>
              </div>
            </motion.div>
          </div>
        </div>

        {/* Plan comparison */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-white" style={{ fontSize: 16, fontWeight: 800 }}>Available Plans</p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>Flat monthly pricing · extra employees billed separately</p>
          </div>
          <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {PLANS.map((plan, i) => {
              const PlanIcon = plan.icon;
              const price = plan.price > 0 ? (billingCycle === "annual" ? plan.annualMonthly : plan.price) : -1;
              const savings = plan.price > 0 ? annualSavings(getPlanById(plan.id)!) : 0;
              return (
                <motion.div key={plan.name} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.1 }}
                  className="p-6 rounded-2xl relative overflow-hidden"
                  style={{ background: plan.current ? `${plan.color}08` : "rgba(255,255,255,0.02)", border: `1.5px solid ${plan.current ? plan.color + "35" : "rgba(255,255,255,0.07)"}` }}>
                  {plan.current && (
                    <div className="absolute top-4 right-4 px-2.5 py-1 rounded-full" style={{ background: `${plan.color}20`, border: `1px solid ${plan.color}35`, fontSize: 9, fontWeight: 800, color: plan.color }}>CURRENT</div>
                  )}
                  {plan.popular && !plan.current && (
                    <div className="absolute top-4 right-4 px-2.5 py-1 rounded-full" style={{ background: `${plan.color}20`, border: `1px solid ${plan.color}35`, fontSize: 9, fontWeight: 800, color: plan.color }}>POPULAR</div>
                  )}
                  <div className="size-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: `${plan.color}15`, border: `1px solid ${plan.color}25` }}>
                    <PlanIcon className="size-6" style={{ color: plan.color }} />
                  </div>
                  <p className="text-white" style={{ fontSize: 20, fontWeight: 800 }}>{plan.name}</p>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{plan.description}</p>
                  <div className="flex items-baseline gap-1 my-4">
                    {price > 0 ? (
                      <span className="contents">
                        <span style={{ fontSize: 34, fontWeight: 900, color: plan.color, letterSpacing: "-1px" }}>${price}</span>
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>/mo</span>
                      </span>
                    ) : (
                      <span style={{ fontSize: 28, fontWeight: 900, color: plan.color }}>Custom</span>
                    )}
                  </div>
                  {billingCycle === "annual" && savings > 0 && (
                    <p style={{ fontSize: 11, color: "#00C853", fontWeight: 600, marginBottom: 8 }}>Save ${savings}/year</p>
                  )}
                  {plan.extraEmployeePrice > 0 && (
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 8 }}>+${plan.extraEmployeePrice}/extra employee</p>
                  )}
                  <div className="space-y-2.5 mb-5">
                    {plan.features.map((f, fi) => (
                      <div key={fi} className="flex items-center gap-2.5">
                        <CheckCircle2 className="size-4 flex-shrink-0" style={{ color: plan.color }} />
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{f}</span>
                      </div>
                    ))}
                  </div>
                  {plan.current ? (
                    <div className="w-full py-3 rounded-xl text-center" style={{ background: `${plan.color}10`, border: `1px solid ${plan.color}20`, fontSize: 13, fontWeight: 700, color: plan.color }}>
                      Current Plan ✓
                    </div>
                  ) : price > 0 ? (
                    <button onClick={() => switchPlan(plan.id)} className="w-full py-3 rounded-xl" style={{ fontSize: 13, fontWeight: 700, color: plan.color, background: `${plan.color}10`, border: `1.5px solid ${plan.color}30`, cursor: "pointer" }}>
                      Switch to {plan.name}
                    </button>
                  ) : (
                    <button onClick={() => { hapticLight(); toast("Contact Sales", { description: "Our enterprise team will reach out within 24 hours" }); }} className="w-full py-3 rounded-xl" style={{ fontSize: 13, fontWeight: 700, color: plan.color, background: `${plan.color}10`, border: `1.5px solid ${plan.color}30`, cursor: "pointer" }}>
                      Contact Sales
                    </button>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Add-ons with toggle switches (PART D) */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-white" style={{ fontSize: 16, fontWeight: 800 }}>Add-ons & Extensions</p>
            {addonsTotal > 0 && (
              <p style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>
                {activeAddonIds.length} active · +${addonsTotal}/mo
              </p>
            )}
          </div>
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            {PRICING_ADDONS.map((addon, i) => {
              const Icon = ADDON_ICON_MAP[addon.id] ?? Plus;
              const color = ADDON_COLOR_MAP[addon.id] ?? "#00C8E0";
              const isActive = !!activeAddons[addon.id];
              return (
                <motion.div key={addon.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35 + i * 0.07 }}
                  className="flex items-center gap-4 p-5 rounded-2xl"
                  style={{ background: isActive ? `${color}06` : "rgba(255,255,255,0.02)", border: `1px solid ${isActive ? color + "25" : "rgba(255,255,255,0.06)"}` }}>
                  <div className="size-11 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}12`, border: `1px solid ${color}20` }}>
                    <Icon className="size-5" style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>{addon.name}</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2, lineHeight: 1.5 }}>{addon.description}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p style={{ fontSize: 16, fontWeight: 800, color }}>${addon.price}<span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>/mo</span></p>
                    <button onClick={() => toggleAddon(addon.id)} className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ fontSize: 11, fontWeight: 700, color: isActive ? "#00C853" : color, background: isActive ? "rgba(0,200,83,0.08)" : `${color}10`, border: `1px solid ${isActive ? "rgba(0,200,83,0.2)" : color + "25"}`, cursor: "pointer" }}>
                      {isActive ? <ToggleRight className="size-3.5" /> : <ToggleLeft className="size-3.5" />}
                      {isActive ? "Enabled" : "Add"}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Invoice history with extra employees column (PART C) */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
          className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="px-6 py-4 flex items-center justify-between" style={{ background: "rgba(255,255,255,0.025)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="flex items-center gap-3">
              <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,200,83,0.12)" }}>
                <FileText className="size-4" style={{ color: "#00C853" }} />
              </div>
              <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Invoice History</p>
            </div>
            <button onClick={() => { hapticSuccess(); toast.success("Downloading All Invoices", { description: "ZIP archive is being prepared..." }); }} className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ fontSize: 12, fontWeight: 600, color: "#00C8E0", background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.2)", cursor: "pointer" }}>
              <Download className="size-3.5" /> Download All
            </button>
          </div>
          {/* Table header: Date | Plan | Base Price | Extra Employees | Addons | Total */}
          <div className="grid px-6 py-3" style={{ gridTemplateColumns: "120px 100px 100px 160px 80px 90px 60px", background: "rgba(255,255,255,0.015)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            {["Date", "Plan", "Base Price", "Extra Employees", "Addons", "Total", ""].map(h => (
              <span key={h || "action"} style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.22)", textTransform: "uppercase", letterSpacing: "0.8px" }}>{h}</span>
            ))}
          </div>
          {ALL_INVOICES.slice(0, 8).map((inv, i) => (
            <div key={inv.id} className="grid items-center px-6 py-3.5" style={{ gridTemplateColumns: "120px 100px 100px 160px 80px 90px 60px", borderBottom: i < Math.min(ALL_INVOICES.length, 8) - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <div>
                <p className="text-white" style={{ fontSize: 12, fontWeight: 600 }}>{inv.date}</p>
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>{inv.id}</p>
              </div>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", fontWeight: 600 }}>{inv.planName}</p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>${inv.baseCost.toFixed(0)}</p>
              <p style={{ fontSize: 12, color: inv.extraCount > 0 ? "#F59E0B" : "rgba(255,255,255,0.15)", fontWeight: inv.extraCount > 0 ? 600 : 400 }}>
                {formatExtra(inv.extraCount, inv.extraCost)}
              </p>
              <p style={{ fontSize: 12, color: inv.addonsCost > 0 ? "#7B5EFF" : "rgba(255,255,255,0.15)" }}>
                {inv.addonsCost > 0 ? `$${inv.addonsCost}` : "—"}
              </p>
              <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>${inv.amount.toFixed(2)}</p>
              <button onClick={() => { hapticLight(); toast.success("Downloading Invoice", { description: `${inv.id} PDF is being generated...` }); }} style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0", cursor: "pointer" }}>PDF</button>
            </div>
          ))}
        </motion.div>

        {/* Your Rights as a Customer */}
        <CustomerRightsSection />
      </div>
    );
  }

  // ─── MOBILE BILLING PAGE ──────────────────────────────────────
  const mBillingStatus = companyState.company.billingStatus;
  const mDaysLeft = trialDaysRemaining(companyState);
  const mStatusLabel: Record<string, string> = {
    trial: `Trial — ${mDaysLeft}d left`,
    active: "Active",
    trial_expired: "Expired",
    past_due: "Payment Failed",
    suspended: "Suspended",
    cancelled: "Cancelled",
  };
  const mStatusColor =
    mBillingStatus === "trial" ? (mDaysLeft <= 3 ? "#FF9500" : "#FFB300")
    : mBillingStatus === "active" ? "#00C853"
    : "#FF2D55";

  const mobileTotal = (invoiceBasePrice > 0 ? invoiceBasePrice : 0) + baseExtraCost + addonsTotal;

  return (
    <div className="px-4 pt-4 pb-8 space-y-4">
      <div className="flex items-center justify-between">
        <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "1.5px" }}>BILLING & SUBSCRIPTION</p>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: `${mStatusColor}14`, border: `1px solid ${mStatusColor}28` }}>
          <motion.div animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 2, repeat: Infinity }} className="size-1.5 rounded-full" style={{ background: mStatusColor }} />
          <span style={{ fontSize: 9, color: mStatusColor, fontWeight: 700 }}>{mStatusLabel[mBillingStatus] ?? "Active"}</span>
        </div>
      </div>

      {/* Current Plan Hero */}
      {(() => {
        const MobilePlanIcon = PLAN_ICON_MAP[currentPlanId] ?? Crown;
        return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="p-4 rounded-2xl relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${currentPlanColor}18, ${currentPlanColor}08)`, border: `1px solid ${currentPlanColor}33` }}>
        <div className="absolute top-0 right-0 w-32 h-32" style={{ background: `radial-gradient(circle, ${currentPlanColor}20 0%, transparent 70%)` }} />
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: `${currentPlanColor}22`, border: `1px solid ${currentPlanColor}40` }}>
                <MobilePlanIcon className="size-5" style={{ color: currentPlanColor }} />
              </div>
              <div>
                <p style={{ fontSize: 9, color: `${currentPlanColor}99`, fontWeight: 700, letterSpacing: "1px" }}>CURRENT PLAN</p>
                <p style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{currentPlanName}</p>
              </div>
            </div>
            <div className="text-right">
              <p style={{ fontSize: 22, fontWeight: 900, color: currentPlanColor }}>${mobileTotal}<span style={{ fontSize: 11, fontWeight: 400, color: "rgba(255,255,255,0.3)" }}>/mo</span></p>
              <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>Next: Apr 1, 2026</p>
            </div>
          </div>
          <div className="mb-2">
            <div className="flex justify-between mb-1.5">
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>Employee Usage</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: usagePercent > 80 ? "#FF2D55" : "#00C853" }}>
                {empCount} / {companyState.planConfig.maxEmployees === -1 ? "∞" : companyState.planConfig.maxEmployees}
              </span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(usagePercent, 100)}%` }} transition={{ duration: 1.2, ease: "easeOut" }}
                className="h-full rounded-full"
                style={{ background: usagePercent > 80 ? "linear-gradient(90deg, #FF9500, #FF2D55)" : "linear-gradient(90deg, #00C853, #00C8E0)" }} />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-3">
            {[
              { label: "Employees", value: empCount, color: "#00C8E0" },
              { label: "Max Limit", value: companyState.planConfig.maxEmployees === -1 ? "∞" : companyState.planConfig.maxEmployees, color: "#7B5EFF" },
              { label: "Extra /emp", value: currentPlanDef ? `$${currentPlanDef.extraEmployeePrice}` : "—", color: "#F59E0B" },
              { label: "Addons", value: addonsTotal > 0 ? `+$${addonsTotal}` : "—", color: "#7B5EFF" },
            ].map(s => (
              <div key={s.label} className="text-center px-2 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
                <p style={{ fontSize: 13, fontWeight: 800, color: s.color }}>{s.value}</p>
                <p style={{ fontSize: 7, color: "rgba(255,255,255,0.2)", marginTop: 1 }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
        );
      })()}

      {/* Billing Cycle Toggle */}
      <div className="flex p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
        {(["monthly", "annual"] as const).map(cycle => (
          <button key={cycle} onClick={() => setBillingCycle(cycle)}
            className="flex-1 py-2 rounded-lg transition-all"
            style={{ fontSize: 11, fontWeight: 600, background: billingCycle === cycle ? "rgba(0,200,224,0.1)" : "transparent", color: billingCycle === cycle ? "#00C8E0" : "rgba(255,255,255,0.3)", border: billingCycle === cycle ? "1px solid rgba(0,200,224,0.2)" : "1px solid transparent" }}>
            {cycle === "monthly" ? "Monthly" : "Annual"}{cycle === "annual" && currentAnnualSavings > 0 && <span style={{ fontSize: 8, color: "#00C853", marginLeft: 4 }}>Save ${currentAnnualSavings}/yr</span>}
          </button>
        ))}
      </div>

      {/* Add-ons (Mobile) — PART D */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "1.5px" }}>ADD-ONS</p>
          {addonsTotal > 0 && <p style={{ fontSize: 9, fontWeight: 700, color: "#00C8E0" }}>+${addonsTotal}/mo</p>}
        </div>
        <div className="space-y-2">
          {PRICING_ADDONS.map((addon) => {
            const Icon = ADDON_ICON_MAP[addon.id] ?? Plus;
            const color = ADDON_COLOR_MAP[addon.id] ?? "#00C8E0";
            const isActive = !!activeAddons[addon.id];
            return (
              <div key={addon.id} className="flex items-center gap-3 p-3 rounded-xl"
                style={{ background: isActive ? `${color}06` : "rgba(255,255,255,0.02)", border: `1px solid ${isActive ? color + "20" : "rgba(255,255,255,0.05)"}` }}>
                <div className="size-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}12`, border: `1px solid ${color}20` }}>
                  <Icon className="size-3.5" style={{ color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white" style={{ fontSize: 11, fontWeight: 600 }}>{addon.name}</p>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{addon.description}</p>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color }}>${addon.price}</span>
                <button onClick={() => toggleAddon(addon.id)}
                  className="px-2.5 py-1 rounded-lg flex items-center gap-1"
                  style={{ fontSize: 9, fontWeight: 700, color: isActive ? "#00C853" : "rgba(255,255,255,0.4)", background: isActive ? "rgba(0,200,83,0.08)" : "rgba(255,255,255,0.04)", border: `1px solid ${isActive ? "rgba(0,200,83,0.15)" : "rgba(255,255,255,0.06)"}`, cursor: "pointer" }}>
                  {isActive ? <ToggleRight className="size-3" /> : <ToggleLeft className="size-3" />}
                  {isActive ? "ON" : "OFF"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Plans */}
      <div>
        <p style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "1.5px", marginBottom: 10 }}>AVAILABLE PLANS</p>
        <div className="space-y-2.5">
          {PLANS.map((plan, i) => (
            <motion.div key={plan.name} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}
              className="p-3.5 rounded-xl relative overflow-hidden"
              style={{ background: plan.current ? `${plan.color}08` : "rgba(255,255,255,0.02)", border: `1px solid ${plan.current ? plan.color + "30" : "rgba(255,255,255,0.06)"}` }}>
              {plan.current && <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full" style={{ background: `${plan.color}20`, border: `1px solid ${plan.color}30`, fontSize: 8, fontWeight: 700, color: plan.color }}>CURRENT</div>}
              <div className="flex items-start gap-3 mb-3">
                <div className="size-9 rounded-xl flex items-center justify-center" style={{ background: `${plan.color}12`, border: `1px solid ${plan.color}20` }}>
                  <plan.icon className="size-4" style={{ color: plan.color }} />
                </div>
                <div className="flex-1">
                  <p style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{plan.name}</p>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{plan.description}</p>
                </div>
                <div className="text-right">
                  {plan.price > 0 ? (
                    <span className="contents">
                      <p style={{ fontSize: 17, fontWeight: 800, color: plan.color }}>${billingCycle === "annual" ? plan.annualMonthly : plan.price}</p>
                      <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>flat/mo</p>
                    </span>
                  ) : (
                    <p style={{ fontSize: 14, fontWeight: 800, color: plan.color }}>Custom</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 mb-3">
                {plan.features.slice(0, 4).map((f, fi) => (
                  <div key={fi} className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-2.5 flex-shrink-0" style={{ color: plan.color }} />
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>{f}</span>
                  </div>
                ))}
              </div>
              {!plan.current && plan.price > 0 && (
                <button onClick={() => switchPlan(plan.id)} className="w-full py-2 rounded-lg" style={{ fontSize: 11, fontWeight: 700, color: plan.color, background: `${plan.color}10`, border: `1px solid ${plan.color}25`, cursor: "pointer" }}>
                  Switch to {plan.name}
                </button>
              )}
              {!plan.current && plan.price <= 0 && (
                <button onClick={() => { hapticLight(); toast("Contact Sales", { description: "Enterprise team will reach out within 24 hours" }); }} className="w-full py-2 rounded-lg" style={{ fontSize: 11, fontWeight: 700, color: plan.color, background: `${plan.color}10`, border: `1px solid ${plan.color}25`, cursor: "pointer" }}>
                  Contact Sales
                </button>
              )}
            </motion.div>
          ))}
        </div>
      </div>

      {/* Invoice History with extra employees (PART C mobile) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "1.5px" }}>INVOICE HISTORY</p>
          <button onClick={() => { hapticLight(); toast.success("Downloading Invoices"); }} style={{ fontSize: 10, color: "#00C8E0", fontWeight: 600, cursor: "pointer" }}>Download All</button>
        </div>
        <DSCard padding={0}>
          {ALL_INVOICES.slice(0, 6).map((inv, i) => (
            <div key={inv.id}>
              <div className="flex items-center gap-3 px-3 py-3">
                <div className="size-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.12)" }}>
                  <FileText className="size-3.5" style={{ color: "#00C853" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white" style={{ fontSize: 11, fontWeight: 600, fontFamily: "monospace" }}>{inv.id}</p>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
                    {inv.date} · {inv.planName}
                    {inv.extraCount > 0 && <span style={{ color: "#F59E0B" }}> · +{inv.extraCount} emp (${inv.extraCost})</span>}
                    {inv.addonsCost > 0 && <span style={{ color: "#7B5EFF" }}> · addons ${inv.addonsCost}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>${inv.amount.toFixed(2)}</span>
                  <Badge variant="success" size="sm">Paid</Badge>
                  <button onClick={() => { hapticLight(); toast.success("Downloading PDF", { description: `Invoice ${inv.id}` }); }} style={{ fontSize: 10, color: "#00C8E0", cursor: "pointer" }}>PDF</button>
                </div>
              </div>
              {i < Math.min(ALL_INVOICES.length, 6) - 1 && <Divider />}
            </div>
          ))}
        </DSCard>
      </div>

      {/* Payment Method */}
      <DSCard padding={14}>
        <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 10 }}>Payment Method</div>
        <div className="flex items-center gap-3">
          <div className="px-3 py-2 rounded-lg" style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.08), rgba(123,94,255,0.08))", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginBottom: 2 }}>VISA</p>
            <p style={{ fontSize: 12, fontWeight: 600, color: "#fff", fontFamily: "monospace", letterSpacing: "2px" }}>•••• •••• •••• 4242</p>
          </div>
          <div className="flex-1">
            <p style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>Expires 08/2027</p>
            <p style={{ fontSize: 9, color: "rgba(0,200,83,0.7)", fontWeight: 600 }}>✓ Verified</p>
          </div>
          <button onClick={() => { hapticLight(); toast("Update Payment", { description: "Payment method editor would open" }); }} className="px-3 py-1.5 rounded-lg" style={{ fontSize: 10, fontWeight: 600, color: "#00C8E0", background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)", cursor: "pointer" }}>Update</button>
        </div>
      </DSCard>

      {/* Your Rights as a Customer */}
      <CustomerRightsSection compact />
    </div>
  );
}