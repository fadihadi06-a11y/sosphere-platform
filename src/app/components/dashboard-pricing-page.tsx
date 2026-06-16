import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Shield, Zap, Rocket, Crown, Check, X,
  CreditCard, Lock, AlertTriangle, Clock, Calendar,
  Users, ChevronRight, ChevronDown, ChevronUp,
  Sparkles, Star, Building2, Infinity as InfinityIcon,
  AlertCircle, CheckCircle2, XCircle, TimerOff,
  RefreshCw, Download, LifeBuoy, PhoneCall,
  BadgeCheck, Banknote, CalendarDays, FileText,
  ArrowRight, Info, TrendingUp,
  BarChart3, MapPin, Bell, Radio, Globe,
  ShieldAlert, CirclePlay, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess, hapticLight } from "./haptic-feedback";
import { UNIFIED_PLANS, annualSavings } from "../constants/pricing";
import { useT } from "./dashboard-i18n";
import { useLang } from "./useLang";

// ═══════════════════════════════════════════════════════════
//  SOSphere — Hybrid Pricing & Subscription Engine
//  New Flat-Rate Model (Starter / Growth / Business / Enterprise)
// ═══════════════════════════════════════════════════════════

// ── Plan Tiers (unified from shared constants) ──────────────
interface PlanTier {
  id: "starter" | "growth" | "business" | "enterprise";
  name: string;
  nameAr: string;
  description: string;
  color: string;
  icon: typeof Shield;
  gradient: string;
  border: string;
  glowColor: string;
  maxEmployees: number;
  maxZones: number;
  monthlyPrice: number;
  annualPrice: number;
  annualMonthly: number;
  extraEmployeePrice: number;
  features: string[];
  popular?: boolean;
}

// Plans derived from shared constants — single source of truth
const PLAN_ICONS = { starter: Shield, growth: Zap, business: Rocket, enterprise: Crown } as const;
const PLAN_GRADIENTS = {
  starter:    { gradient: "linear-gradient(135deg, rgba(0,200,224,0.12) 0%, rgba(0,200,224,0.03) 100%)",   border: "rgba(0,200,224,0.25)", glow: "rgba(0,200,224,0.15)" },
  growth:     { gradient: "linear-gradient(135deg, rgba(123,94,255,0.12) 0%, rgba(123,94,255,0.03) 100%)", border: "rgba(123,94,255,0.30)", glow: "rgba(123,94,255,0.15)" },
  business:   { gradient: "linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.03) 100%)", border: "rgba(245,158,11,0.30)", glow: "rgba(245,158,11,0.15)" },
  enterprise: { gradient: "linear-gradient(135deg, rgba(0,200,83,0.12) 0%, rgba(0,200,83,0.03) 100%)",    border: "rgba(0,200,83,0.30)",  glow: "rgba(0,200,83,0.15)" },
} as const;

const PLANS: PlanTier[] = UNIFIED_PLANS.map(p => ({
  ...p,
  icon: PLAN_ICONS[p.id],
  gradient: PLAN_GRADIENTS[p.id].gradient,
  border: PLAN_GRADIENTS[p.id].border,
  glowColor: PLAN_GRADIENTS[p.id].glow,
}));

// ── Lifecycle States ─────────────────────────────────────────
type AccountStatus =
  | "trial_active"      // Trial running (days remaining > 0)
  | "trial_ending"      // Trial < 3 days
  | "trial_expired"     // Trial over, card being charged
  | "active"            // Subscription active
  | "payment_failed"    // Payment failed, grace period
  | "grace_period"      // Grace period (7 days)
  | "suspended";        // Account suspended

const LIFECYCLE_STEPS = [
  {
    phaseKey: "pp.lifecycle_trial_start_phase",
    icon: CirclePlay,
    color: "#00C8E0",
    descKey: "pp.lifecycle_trial_start_desc",
  },
  {
    phaseKey: "pp.lifecycle_day7_phase",
    icon: Bell,
    color: "#FF9500",
    descKey: "pp.lifecycle_day7_desc",
  },
  {
    phaseKey: "pp.lifecycle_day11_phase",
    icon: AlertTriangle,
    color: "#FF9500",
    descKey: "pp.lifecycle_day11_desc",
  },
  {
    phaseKey: "pp.lifecycle_day14_phase",
    icon: Clock,
    color: "#FF2D55",
    descKey: "pp.lifecycle_day14_desc",
  },
  {
    phaseKey: "pp.lifecycle_day15_phase",
    icon: CreditCard,
    color: "#00C853",
    descKey: "pp.lifecycle_day15_desc",
  },
];

const EXPIRY_STEPS = [
  {
    phaseKey: "pp.expiry_7days_phase",
    icon: CalendarDays,
    color: "#00C8E0",
    descKey: "pp.expiry_7days_desc",
  },
  {
    phaseKey: "pp.expiry_3days_phase",
    icon: AlertCircle,
    color: "#FF9500",
    descKey: "pp.expiry_3days_desc",
  },
  {
    phaseKey: "pp.expiry_renewal_phase",
    icon: CreditCard,
    color: "#00C853",
    descKey: "pp.expiry_renewal_desc",
  },
  {
    phaseKey: "pp.expiry_fail_phase",
    icon: XCircle,
    color: "#FF2D55",
    descKey: "pp.expiry_fail_desc",
  },
  {
    phaseKey: "pp.expiry_aftergrace_phase",
    icon: TimerOff,
    color: "#FF2D55",
    descKey: "pp.expiry_aftergrace_desc",
  },
];

// ── Props ──────────────────────────────────────────────────
interface PricingPageProps {
  webMode?: boolean;
  currentStatus?: AccountStatus;
  trialDays?: number;
}

// ═══════════════════════════════════════════════════════════
//  Main Component
// ═══════════════════════════════════════════════════════════
export function PricingPage({ webMode = false, currentStatus = "trial_active", trialDays: trialDaysProp }: PricingPageProps) {
  const { lang } = useLang();
  const t = useT(lang);
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const [selectedPlan, setSelectedPlan] = useState<PlanTier["id"] | null>(null);
  const [employeeCount, setEmployeeCount] = useState(30);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showLifecycle, setShowLifecycle] = useState<"trial" | "renewal" | null>(null);
  const [showSuspensionDetail, setShowSuspensionDetail] = useState(false);
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null);
  // CRIT-#13 (2026-04-27): default was 9 — bug. Every other surface in
  // this same page (lifecycle steps, FAQ, button labels, banner copy)
  // talks about a 14-day trial. The mismatch leaked into the status
  // banner ("9 days remaining" while UI promises 14) on any caller
  // that did NOT pass trialDays explicitly. The single source of truth
  // for the company trial is 14 days; civilian trial is separate
  // (trial-service.ts:DEFAULT_TRIAL_DAYS = 7) and has its own UI.
  const COMPANY_TRIAL_DAYS_DEFAULT = 14;
  const trialDays = trialDaysProp ?? COMPANY_TRIAL_DAYS_DEFAULT;

  // Auto-detect best plan based on employee count
  const recommendedPlan = PLANS.find(p =>
    p.maxEmployees === -1 ? employeeCount > 500 : employeeCount <= p.maxEmployees
  ) ?? PLANS[3];

  const displayPlan = selectedPlan ? PLANS.find(p => p.id === selectedPlan)! : recommendedPlan;

  const monthlyTotal = displayPlan.monthlyPrice;
  const annualTotal = displayPlan.annualPrice;
  const annualMonthlyCost = displayPlan.annualMonthly > 0 ? displayPlan.annualMonthly : "Custom";
  const displayAnnualSavings = annualSavings(displayPlan as any);

  const STATUS_CONFIG: Record<AccountStatus, {
    label: string; color: string; bg: string; border: string; icon: typeof Check; desc: string;
  }> = {
    trial_active:  { label: t("pp.status_trial_active_label"),     color: "#00C8E0", bg: "rgba(0,200,224,0.08)",  border: "rgba(0,200,224,0.2)",  icon: Clock,         desc: `${trialDays} ${t("pp.days_remaining")}` },
    trial_ending:  { label: t("pp.status_trial_ending_label"), color: "#FF9500", bg: "rgba(255,149,0,0.08)", border: "rgba(255,149,0,0.2)",  icon: AlertTriangle, desc: t("pp.status_trial_ending_desc") },
    trial_expired: { label: t("pp.status_trial_expired_label"),     color: "#FF2D55", bg: "rgba(255,45,85,0.08)", border: "rgba(255,45,85,0.2)",  icon: XCircle,       desc: t("pp.status_trial_expired_desc") },
    active:        { label: t("pp.status_active_label"),            color: "#00C853", bg: "rgba(0,200,83,0.08)",  border: "rgba(0,200,83,0.2)",   icon: CheckCircle2,  desc: t("pp.status_active_desc") },
    payment_failed:{ label: t("pp.status_payment_failed_label"),    color: "#FF2D55", bg: "rgba(255,45,85,0.08)", border: "rgba(255,45,85,0.2)",  icon: AlertTriangle, desc: t("pp.status_payment_failed_desc") },
    grace_period:  { label: t("pp.status_grace_label"),      color: "#FF9500", bg: "rgba(255,149,0,0.08)", border: "rgba(255,149,0,0.2)",  icon: Clock,         desc: t("pp.status_grace_desc") },
    suspended:     { label: t("pp.status_suspended_label"),         color: "#FF2D55", bg: "rgba(255,45,85,0.1)",  border: "rgba(255,45,85,0.25)", icon: TimerOff,      desc: t("pp.status_suspended_desc") },
  };
  const statusCfg = STATUS_CONFIG[currentStatus];
  const StatusIcon = statusCfg.icon;

  const FAQS = [
    {
      q: t("pp.faq1_q"),
      a: t("pp.faq1_a"),
    },
    {
      q: t("pp.faq2_q"),
      a: t("pp.faq2_a"),
    },
    {
      q: t("pp.faq3_q"),
      a: t("pp.faq3_a"),
    },
    {
      q: t("pp.faq4_q"),
      a: t("pp.faq4_a"),
    },
    {
      q: t("pp.faq5_q"),
      a: t("pp.faq5_a"),
    },
    {
      q: t("pp.faq6_q"),
      a: t("pp.faq6_a"),
    },
  ];

  return (
    <div
      className="min-h-full overflow-auto"
      style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}
    >
      {/* ── Account Status Banner ──────────────────────────────── */}
      {(currentStatus === "trial_active" || currentStatus === "trial_ending" || currentStatus === "payment_failed" || currentStatus === "grace_period") && (
        <motion.div
          initial={{ y: -8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="sticky top-0 z-30 px-6 py-3 flex items-center gap-3"
          style={{ background: statusCfg.bg, borderBottom: `1px solid ${statusCfg.border}`, backdropFilter: "blur(20px)" }}
        >
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 2.5, repeat: Infinity }}
            className="size-2 rounded-full flex-shrink-0"
            style={{ background: statusCfg.color }}
          />
          <StatusIcon className="size-4 flex-shrink-0" style={{ color: statusCfg.color }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: statusCfg.color }}>{statusCfg.label}</span>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>·</span>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>{statusCfg.desc}</span>
          <div className="flex-1" />
          {currentStatus === "trial_active" && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl" style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}>
              <Clock className="size-3.5" style={{ color: "#00C8E0" }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>{trialDays} {t("pp.days_left")}</span>
            </div>
          )}
          {(currentStatus === "payment_failed" || currentStatus === "grace_period") && (
            <button
              onClick={() => setShowPaymentForm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
              style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "#FF2D55" }}
            >
              <CreditCard className="size-3.5" />
              {t("pp.update_card_now")}
            </button>
          )}
        </motion.div>
      )}

      <div className="p-6 space-y-8 max-w-[1400px] mx-auto">

        {/* ── Page Header ───────────────────────────────────────── */}
        <div className="flex items-start justify-between">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-white"
              style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-0.8px" }}
            >
              {t("pp.header_title")}
              <span style={{ color: "#00C8E0" }}> {t("pp.header_title_accent")}</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 }}
              style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 5 }}
            >
              {t("pp.header_subtitle")}
            </motion.p>
          </div>

          {/* Status badge */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl"
            style={{ background: statusCfg.bg, border: `1px solid ${statusCfg.border}` }}
          >
            <StatusIcon className="size-4" style={{ color: statusCfg.color }} />
            <div>
              <p style={{ fontSize: 12, fontWeight: 800, color: statusCfg.color }}>{statusCfg.label}</p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{statusCfg.desc}</p>
            </div>
          </motion.div>
        </div>

        {/* ── Smart Employee Calculator ──────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="p-6 rounded-3xl relative overflow-hidden"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          {/* Ambient glow */}
          <div className="absolute top-0 right-0 w-80 h-80 pointer-events-none" style={{ background: "radial-gradient(circle at top right, rgba(0,200,224,0.05) 0%, transparent 60%)" }} />

          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-6">
              <div className="size-10 rounded-2xl flex items-center justify-center" style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}>
                <Users className="size-5" style={{ color: "#00C8E0" }} />
              </div>
              <div>
                <p className="text-white" style={{ fontSize: 15, fontWeight: 800 }}>{t("pp.calc_title")}</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{t("pp.calc_subtitle")}</p>
              </div>
              <div className="flex-1" />
              <div className="px-4 py-2 rounded-xl" style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)" }}>
                <span style={{ fontSize: 24, fontWeight: 900, color: "#00C8E0" }}>{employeeCount}</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginLeft: 4 }}>{t("pp.employees")}</span>
              </div>
            </div>

            {/* Slider */}
            <div className="mb-6">
              <input
                type="range"
                min={1}
                max={600}
                value={employeeCount}
                onChange={e => setEmployeeCount(Number(e.target.value))}
                className="w-full"
                style={{
                  height: 6, borderRadius: 99,
                  accentColor: recommendedPlan.color,
                  cursor: "pointer",
                }}
              />
              <div className="flex justify-between mt-2" style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
                <span>1</span>
                <span>25</span>
                <span>100</span>
                <span>250</span>
                <span>500</span>
                <span>600+</span>
              </div>
            </div>

            {/* Recommended plan result */}
            <motion.div
              key={recommendedPlan.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-5 rounded-2xl flex items-center gap-5"
              style={{ background: recommendedPlan.gradient, border: `1.5px solid ${recommendedPlan.border}` }}
            >
              <div className="size-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: `${recommendedPlan.color}15`, border: `1px solid ${recommendedPlan.color}30` }}>
                <recommendedPlan.icon className="size-7" style={{ color: recommendedPlan.color }} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white" style={{ fontSize: 20, fontWeight: 900 }}>{recommendedPlan.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: recommendedPlan.color, background: `${recommendedPlan.color}15`, border: `1px solid ${recommendedPlan.color}25`, borderRadius: 8, padding: "2px 8px" }}>
                    {t("pp.recommended")}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{recommendedPlan.description}</p>
                {recommendedPlan.maxEmployees > 0 && employeeCount > recommendedPlan.maxEmployees && (
                  <p style={{ fontSize: 11, color: "#F59E0B", marginTop: 4 }}>
                    +{employeeCount - recommendedPlan.maxEmployees} {t("pp.extra_employees")} × ${recommendedPlan.extraEmployeePrice}{t("pp.per_mo_each")}
                  </p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                {recommendedPlan.monthlyPrice > 0 ? (
                  <span className="contents">
                    <p style={{ fontSize: 36, fontWeight: 900, color: recommendedPlan.color, letterSpacing: "-1px" }}>
                      ${billing === "monthly" ? recommendedPlan.monthlyPrice : recommendedPlan.annualMonthly}
                      <span style={{ fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.35)" }}>{t("pp.per_mo")}</span>
                    </p>
                    {billing === "annual" && (
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                        ${recommendedPlan.annualPrice}{t("pp.per_yr")} · {t("pp.save")} ${annualSavings(recommendedPlan as any)}{t("pp.per_yr")}
                      </p>
                    )}
                  </span>
                ) : (
                  <p style={{ fontSize: 26, fontWeight: 900, color: recommendedPlan.color }}>{t("pp.custom")}</p>
                )}
              </div>
            </motion.div>
          </div>
        </motion.div>

        {/* ── Billing Cycle Toggle ───────────────────────────────── */}
        <div className="flex items-center justify-center gap-4">
          <div className="relative flex p-[3px] rounded-2xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <motion.div
              className="absolute top-[3px] bottom-[3px] rounded-[14px]"
              style={{ width: "calc(50% - 3px)", background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}
              animate={{ left: billing === "monthly" ? 3 : "calc(50%)" }}
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
            />
            {(["monthly", "annual"] as const).map(b => (
              <button
                key={b}
                onClick={() => setBilling(b)}
                className="relative z-10 flex items-center gap-2 px-6 py-2.5"
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: billing === b ? "#00C8E0" : "rgba(255,255,255,0.3)" }}>
                  {b === "monthly" ? t("pp.monthly") : t("pp.annual")}
                </span>
              </button>
            ))}
          </div>
          {billing === "annual" && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.15)" }}
            >
              <TrendingUp className="size-3.5" style={{ color: "#00C853" }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "#00C853" }}>
                {t("pp.save_up_to")} ${annualSavings(UNIFIED_PLANS[2])}{t("pp.per_year_on_business")}
              </span>
            </motion.div>
          )}
        </div>

        {/* ── Plan Cards ────────────────────────────────────────── */}
        <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {PLANS.map((plan, i) => {
            const PlanIcon = plan.icon;
            const price = plan.monthlyPrice > 0 ? (billing === "monthly" ? plan.monthlyPrice : plan.annualMonthly) : -1;
            const isSelected = selectedPlan === plan.id || (!selectedPlan && recommendedPlan.id === plan.id);
            const isEnterprise = plan.id === "enterprise";
            const savings = annualSavings(plan as any);

            return (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.07 }}
                onClick={() => setSelectedPlan(plan.id)}
                className="p-6 rounded-3xl relative overflow-hidden cursor-pointer"
                style={{
                  background: isSelected ? plan.gradient : "rgba(255,255,255,0.02)",
                  border: `1.5px solid ${isSelected ? plan.border : "rgba(255,255,255,0.06)"}`,
                  boxShadow: isSelected ? `0 8px 40px ${plan.glowColor}` : "none",
                  transition: "all 0.25s ease",
                }}
                whileHover={{ y: -2, scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
              >
                {/* Glow */}
                {isSelected && (
                  <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none" style={{ background: `radial-gradient(circle at top right, ${plan.glowColor} 0%, transparent 70%)` }} />
                )}

                {/* Popular badge */}
                {plan.popular && (
                  <div className="absolute top-4 right-4 px-2.5 py-1 rounded-full" style={{ background: `${plan.color}20`, border: `1px solid ${plan.color}35`, fontSize: 9, fontWeight: 800, color: plan.color, letterSpacing: "0.5px" }}>
                    {t("pp.most_popular")}
                  </div>
                )}

                <div className="relative z-10">
                  <div className="size-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: `${plan.color}15`, border: `1px solid ${plan.color}25` }}>
                    <PlanIcon className="size-6" style={{ color: plan.color }} />
                  </div>

                  <p className="text-white mb-0.5" style={{ fontSize: 20, fontWeight: 900 }}>{plan.name}</p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 16 }}>{plan.description}</p>

                  {/* Price */}
                  <div className="mb-4">
                    {isEnterprise ? (
                      <p style={{ fontSize: 28, fontWeight: 900, color: plan.color, letterSpacing: "-0.5px" }}>{t("pp.custom")}</p>
                    ) : (
                      <span className="contents">
                        <div className="flex items-baseline gap-1">
                          <span style={{ fontSize: 34, fontWeight: 900, color: plan.color, letterSpacing: "-1px" }}>${price}</span>
                          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{t("pp.per_month")}</span>
                        </div>
                        {billing === "annual" && savings > 0 && (
                          <p style={{ fontSize: 11, color: "#00C853", fontWeight: 600, marginTop: 2 }}>{t("pp.save")} ${savings}{t("pp.per_year")}</p>
                        )}
                        {plan.extraEmployeePrice > 0 && (
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 4 }}>+${plan.extraEmployeePrice}{t("pp.per_extra_employee")}</p>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Divider */}
                  <div style={{ height: 1, background: "rgba(255,255,255,0.05)", marginBottom: 14 }} />

                  {/* Features */}
                  <div className="space-y-2.5 mb-5">
                    {plan.features.slice(0, 6).map((f, fi) => (
                      <div key={fi} className="flex items-start gap-2.5">
                        <Check className="size-3.5 flex-shrink-0 mt-0.5" style={{ color: plan.color }} />
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.4 }}>{f}</span>
                      </div>
                    ))}
                    {plan.features.length > 6 && (
                      <p style={{ fontSize: 11, color: plan.color, fontWeight: 600, paddingLeft: 22 }}>
                        +{plan.features.length - 6} {t("pp.more_features")}
                      </p>
                    )}
                  </div>

                  {/* CTA */}
                  {isEnterprise ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); hapticLight(); toast(t("pp.contact_sales"), { description: t("pp.contact_sales_toast_desc") }); }}
                      className="w-full py-3 rounded-xl flex items-center justify-center gap-2"
                      style={{ fontSize: 13, fontWeight: 700, color: plan.color, background: `${plan.color}10`, border: `1.5px solid ${plan.color}30`, cursor: "pointer" }}
                    >
                      <PhoneCall className="size-4" />
                      {t("pp.contact_sales")}
                    </button>
                  ) : isSelected ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        console.log("[SUPABASE_READY] plan_selected: " + JSON.stringify({ planId: plan.id, billingCycle: billing, totalMonthly: price }));
                        setShowPaymentForm(true);
                      }}
                      className="w-full py-3 rounded-xl flex items-center justify-center gap-2"
                      style={{ fontSize: 13, fontWeight: 700, color: "#05070E", background: plan.color, boxShadow: `0 4px 20px ${plan.glowColor}` }}
                    >
                      <Sparkles className="size-4" />
                      {currentStatus === "active" ? t("pp.switch_plan") : t("pp.start_trial")}
                    </button>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedPlan(plan.id); }}
                      className="w-full py-3 rounded-xl"
                      style={{ fontSize: 13, fontWeight: 700, color: plan.color, background: `${plan.color}08`, border: `1px solid ${plan.color}20` }}
                    >
                      {t("pp.select_plan")}
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* ── Trial Promise Section ──────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="p-6 rounded-3xl"
          style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.06) 0%, rgba(0,200,83,0.04) 100%)", border: "1px solid rgba(0,200,224,0.12)" }}
        >
          <div className="flex items-center gap-3 mb-5">
            <div className="size-10 rounded-2xl flex items-center justify-center" style={{ background: "rgba(0,200,224,0.12)", border: "1px solid rgba(0,200,224,0.2)" }}>
              <BadgeCheck className="size-5" style={{ color: "#00C8E0" }} />
            </div>
            <div>
              <p className="text-white" style={{ fontSize: 15, fontWeight: 800 }}>{t("pp.trial_promise_title")}</p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{t("pp.trial_promise_subtitle")}</p>
            </div>
          </div>

          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            {[
              {
                icon: CreditCard,
                color: "#00C8E0",
                title: t("pp.promise1_title"),
                desc: t("pp.promise1_desc"),
              },
              {
                icon: Clock,
                color: "#00C853",
                title: t("pp.promise2_title"),
                desc: t("pp.promise2_desc"),
              },
              {
                icon: X,
                color: "#FF9500",
                title: t("pp.promise3_title"),
                desc: t("pp.promise3_desc"),
              },
            ].map((item, i) => (
              <div key={i} className="p-4 rounded-2xl" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)" }}>
                <div className="size-8 rounded-xl flex items-center justify-center mb-3" style={{ background: `${item.color}12`, border: `1px solid ${item.color}20` }}>
                  <item.icon className="size-4" style={{ color: item.color }} />
                </div>
                <p className="text-white mb-1" style={{ fontSize: 13, fontWeight: 700 }}>{item.title}</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* ── Lifecycle Timelines ────────────────────────────────── */}
        <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 1fr" }}>

          {/* Trial Lifecycle */}
          <motion.div
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.32 }}
            className="rounded-3xl overflow-hidden"
            style={{ border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <button
              onClick={() => setShowLifecycle(showLifecycle === "trial" ? null : "trial")}
              className="w-full flex items-center gap-3 px-5 py-4"
              style={{ background: "rgba(0,200,224,0.05)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}
            >
              <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}>
                <CirclePlay className="size-4" style={{ color: "#00C8E0" }} />
              </div>
              <p className="text-white flex-1 text-left" style={{ fontSize: 14, fontWeight: 700 }}>{t("pp.trial_lifecycle_title")}</p>
              {showLifecycle === "trial" ? <ChevronUp className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} /> : <ChevronDown className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />}
            </button>

            <AnimatePresence>
              {(showLifecycle === "trial" || showLifecycle === null) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-5 space-y-0">
                    {LIFECYCLE_STEPS.map((step, i) => (
                      <div key={i} className="flex gap-4 relative">
                        {/* Connector line */}
                        {i < LIFECYCLE_STEPS.length - 1 && (
                          <div className="absolute left-4 top-8 w-0.5 h-full" style={{ background: `linear-gradient(${step.color}40, transparent)` }} />
                        )}
                        <div className="size-8 rounded-full flex items-center justify-center flex-shrink-0 relative z-10" style={{ background: `${step.color}15`, border: `1.5px solid ${step.color}30` }}>
                          <step.icon className="size-4" style={{ color: step.color }} />
                        </div>
                        <div className="pb-5 flex-1">
                          <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{t(step.phaseKey)}</p>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5, marginTop: 2 }}>{t(step.descKey)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Renewal Lifecycle */}
          <motion.div
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.34 }}
            className="rounded-3xl overflow-hidden"
            style={{ border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <button
              onClick={() => setShowLifecycle(showLifecycle === "renewal" ? null : "renewal")}
              className="w-full flex items-center gap-3 px-5 py-4"
              style={{ background: "rgba(255,149,0,0.05)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}
            >
              <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,149,0,0.1)", border: "1px solid rgba(255,149,0,0.2)" }}>
                <RefreshCw className="size-4" style={{ color: "#FF9500" }} />
              </div>
              <p className="text-white flex-1 text-left" style={{ fontSize: 14, fontWeight: 700 }}>{t("pp.renewal_lifecycle_title")}</p>
              {showLifecycle === "renewal" ? <ChevronUp className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} /> : <ChevronDown className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />}
            </button>

            <AnimatePresence>
              {(showLifecycle === "renewal" || showLifecycle === null) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-5 space-y-0">
                    {EXPIRY_STEPS.map((step, i) => (
                      <div key={i} className="flex gap-4 relative">
                        {i < EXPIRY_STEPS.length - 1 && (
                          <div className="absolute left-4 top-8 w-0.5 h-full" style={{ background: `linear-gradient(${step.color}40, transparent)` }} />
                        )}
                        <div className="size-8 rounded-full flex items-center justify-center flex-shrink-0 relative z-10" style={{ background: `${step.color}15`, border: `1.5px solid ${step.color}30` }}>
                          <step.icon className="size-4" style={{ color: step.color }} />
                        </div>
                        <div className="pb-5 flex-1">
                          <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{t(step.phaseKey)}</p>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5, marginTop: 2 }}>{t(step.descKey)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        {/* ── Suspension Rules ───────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.36 }}
          className="rounded-3xl overflow-hidden"
          style={{ border: "1px solid rgba(255,45,85,0.15)" }}
        >
          <button
            onClick={() => setShowSuspensionDetail(!showSuspensionDetail)}
            className="w-full flex items-center gap-3 px-6 py-4"
            style={{ background: "rgba(255,45,85,0.05)", borderBottom: showSuspensionDetail ? "1px solid rgba(255,45,85,0.1)" : "none" }}
          >
            <div className="size-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.2)" }}>
              <TimerOff className="size-4" style={{ color: "#FF2D55" }} />
            </div>
            <div className="flex-1 text-left">
              <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>{t("pp.suspension_title")}</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{t("pp.suspension_subtitle")}</p>
            </div>
            {showSuspensionDetail ? <ChevronUp className="size-4 flex-shrink-0" style={{ color: "rgba(255,255,255,0.3)" }} /> : <ChevronDown className="size-4 flex-shrink-0" style={{ color: "rgba(255,255,255,0.3)" }} />}
          </button>

          <AnimatePresence>
            {showSuspensionDetail && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="p-6">
                  <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 20 }}>
                    {[
                      { label: t("pp.susp_sos_label"), suspended: true, color: "#FF2D55", note: t("pp.susp_sos_note") },
                      { label: t("pp.susp_gps_label"), suspended: true, color: "#FF2D55", note: t("pp.susp_gps_note") },
                      { label: t("pp.susp_admin_label"), suspended: false, color: "#FF9500", note: t("pp.susp_admin_note") },
                      { label: t("pp.susp_reports_label"), suspended: false, color: "#00C8E0", note: t("pp.susp_reports_note") },
                      { label: t("pp.susp_export_label"), suspended: false, color: "#00C853", note: t("pp.susp_export_note") },
                      { label: t("pp.susp_login_label"), suspended: true, color: "#FF2D55", note: t("pp.susp_login_note") },
                    ].map((item, i) => (
                      <div key={i} className="flex items-start gap-3 p-4 rounded-2xl" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)" }}>
                        <div className="size-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `${item.color}15` }}>
                          {item.suspended ? <X className="size-3.5" style={{ color: "#FF2D55" }} /> : <Check className="size-3.5" style={{ color: item.color }} />}
                        </div>
                        <div>
                          <p className="text-white" style={{ fontSize: 12, fontWeight: 600 }}>{item.label}</p>
                          <p style={{ fontSize: 10, color: item.color, marginTop: 2 }}>{item.note}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Data retention timeline */}
                  <div className="p-4 rounded-2xl" style={{ background: "rgba(255,45,85,0.05)", border: "1px solid rgba(255,45,85,0.12)" }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "#FF2D55", marginBottom: 12 }}>⚠️ {t("pp.retention_title")}</p>
                    <div className="flex items-center gap-0">
                      {[
                        { day: t("pp.retention_day0"), label: t("pp.retention_day0_label"), color: "#FF9500" },
                        { day: t("pp.retention_day7"), label: t("pp.retention_day7_label"), color: "#FF2D55" },
                        { day: t("pp.retention_day30"), label: t("pp.retention_day30_label"), color: "#FF2D55" },
                        { day: t("pp.retention_day37"), label: t("pp.retention_day37_label"), color: "#FF2D55" },
                        { day: t("pp.retention_day60"), label: t("pp.retention_day60_label"), color: "#FF2D55" },
                      ].map((t, i, arr) => (
                        <div key={i} className="flex items-center flex-1">
                          <div className="flex flex-col items-center">
                            <div className="size-3 rounded-full" style={{ background: t.color }} />
                            <p style={{ fontSize: 9, fontWeight: 700, color: t.color, marginTop: 4, whiteSpace: "nowrap" }}>{t.day}</p>
                            <p style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", whiteSpace: "nowrap" }}>{t.label}</p>
                          </div>
                          {i < arr.length - 1 && <div className="flex-1 h-px" style={{ background: "rgba(255,45,85,0.2)", margin: "0 4px", marginBottom: 28 }} />}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ── Security & Trust ───────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38 }}
          className="p-5 rounded-3xl"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
        >
          <div className="flex items-center gap-5 flex-wrap justify-center">
            {/* B-18 (2026-04-25): truthful capability badges. PCI DSS is held
                by Stripe (our processor); GDPR alignment is designed-in but
                not externally audited; SLA targets are operational, not
                contractual until a published SLA exists. */}
            {[
              { icon: Lock, label: t("pp.trust_tls_label"), sublabel: t("pp.trust_tls_sub") },
              { icon: BadgeCheck, label: t("pp.trust_pci_label"), sublabel: t("pp.trust_pci_sub") },
              { icon: ShieldCheck, label: t("pp.trust_atrest_label"), sublabel: t("pp.trust_atrest_sub") },
              { icon: Globe, label: t("pp.trust_gdpr_label"), sublabel: t("pp.trust_gdpr_sub") },
              { icon: LifeBuoy, label: t("pp.trust_uptime_label"), sublabel: t("pp.trust_uptime_sub") },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.12)" }}>
                  <item.icon className="size-4" style={{ color: "#00C8E0" }} />
                </div>
                <div>
                  <p className="text-white" style={{ fontSize: 12, fontWeight: 700 }}>{item.label}</p>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{item.sublabel}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* ── FAQ Section ────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <p className="text-white mb-4" style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.4px" }}>
            {t("pp.faq_title")}
          </p>
          <div className="space-y-2.5">
            {FAQS.map((faq, i) => (
              <div
                key={i}
                className="rounded-2xl overflow-hidden"
                style={{ border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <button
                  onClick={() => setExpandedFAQ(expandedFAQ === i ? null : i)}
                  className="w-full flex items-center gap-3 px-5 py-4 text-left"
                  style={{ background: expandedFAQ === i ? "rgba(0,200,224,0.04)" : "rgba(255,255,255,0.02)" }}
                >
                  <div className="size-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.15)" }}>
                    <Info className="size-3.5" style={{ color: "#00C8E0" }} />
                  </div>
                  <span className="flex-1 text-white" style={{ fontSize: 13, fontWeight: 600 }}>{faq.q}</span>
                  {expandedFAQ === i
                    ? <ChevronUp className="size-4 flex-shrink-0" style={{ color: "#00C8E0" }} />
                    : <ChevronDown className="size-4 flex-shrink-0" style={{ color: "rgba(255,255,255,0.25)" }} />
                  }
                </button>
                <AnimatePresence>
                  {expandedFAQ === i && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <p className="px-5 pb-4 pt-1" style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>{faq.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Spacer */}
        <div className="h-8" />
      </div>

      {/* ═══ Payment Form Modal ═════════════════════════════════ */}
      <AnimatePresence>
        {showPaymentForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            style={{ background: "rgba(5,7,14,0.92)", backdropFilter: "blur(24px)" }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowPaymentForm(false); }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="w-full max-w-[480px] rounded-3xl overflow-hidden"
              style={{ background: "#0A1220", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 40px 80px rgba(0,0,0,0.6)" }}
            >
              {/* ── Secure Payment Placeholder ── */}
              <div className="flex items-center justify-between px-6 pt-6 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div>
                  <p className="text-white" style={{ fontSize: 18, fontWeight: 900 }}>{t("pp.secure_payment")}</p>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{t("pp.stripe_coming_soon")}</p>
                </div>
                <button onClick={() => setShowPaymentForm(false)} className="size-8 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)", cursor: "pointer" }}>
                  <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
                </button>
              </div>

              <div className="p-6 space-y-5">
                {/* Plan summary */}
                <div className="flex items-center gap-3 p-4 rounded-2xl" style={{ background: displayPlan.gradient, border: `1px solid ${displayPlan.border}` }}>
                  <displayPlan.icon className="size-5 flex-shrink-0" style={{ color: displayPlan.color }} />
                  <div className="flex-1">
                    <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{displayPlan.name} {t("pp.plan_word")} · {billing === "monthly" ? t("pp.monthly") : t("pp.annual")}</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                      {t("pp.trial_then")} ${billing === "monthly" ? displayPlan.monthlyPrice : displayPlan.annualPrice}/{billing === "monthly" ? t("pp.mo") : t("pp.yr")}
                    </p>
                  </div>
                  <div className="px-3 py-1.5 rounded-xl" style={{ background: "rgba(0,200,83,0.1)", border: "1px solid rgba(0,200,83,0.2)" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#00C853" }}>{t("pp.free_today")}</span>
                  </div>
                </div>

                {/* Stripe badge */}
                <div className="flex flex-col items-center py-8 gap-4">
                  <div className="size-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(0,200,224,0.06)", border: "1.5px solid rgba(0,200,224,0.15)" }}>
                    <CreditCard className="size-8" style={{ color: "#00C8E0" }} />
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ background: "rgba(123,94,255,0.06)", border: "1px solid rgba(123,94,255,0.15)" }}>
                    <Lock className="size-3.5" style={{ color: "#7B5EFF" }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#7B5EFF" }}>{t("pp.powered_by_stripe")}</span>
                  </div>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", textAlign: "center", lineHeight: 1.7, maxWidth: 320 }}>
                    {t("pp.payment_coming_desc")}
                  </p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", textAlign: "center", lineHeight: 1.5 }}>
                    {t("pp.no_card_stored")}
                  </p>
                </div>

                {/* Notify button */}
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    console.log("[SUPABASE_READY] plan_selected: " + JSON.stringify({ planId: displayPlan.id, billingCycle: billing, totalMonthly: billing === "monthly" ? displayPlan.monthlyPrice : displayPlan.annualMonthly }));
                    toast.success(t("pp.notify_toast_title"), {
                      description: t("pp.notify_toast_desc"),
                    });
                    setShowPaymentForm(false);
                  }}
                  className="w-full py-4 rounded-2xl flex items-center justify-center gap-2.5"
                  style={{
                    fontSize: 15, fontWeight: 700,
                    background: "linear-gradient(135deg, #00C8E0, #00A5C0)",
                    color: "#05070E",
                    boxShadow: "0 6px 24px rgba(0,200,224,0.3)",
                    cursor: "pointer",
                  }}
                >
                  <Bell className="size-4" />
                  {t("pp.notify_me")}
                </motion.button>

                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", textAlign: "center", lineHeight: 1.6 }}>
                  {t("pp.modal_footer")}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
