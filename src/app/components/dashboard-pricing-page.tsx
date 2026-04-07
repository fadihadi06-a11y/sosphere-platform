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
    phase: "Trial Start",
    icon: CirclePlay,
    color: "#00C8E0",
    description: "Card saved (not charged). Full access for 14 days.",
  },
  {
    phase: "Day 7",
    icon: Bell,
    color: "#FF9500",
    description: "Email + in-app reminder: 7 days remaining in trial.",
  },
  {
    phase: "Day 11",
    icon: AlertTriangle,
    color: "#FF9500",
    description: "Urgent in-app alert: 3 days remaining. Review plan.",
  },
  {
    phase: "Day 14",
    icon: Clock,
    color: "#FF2D55",
    description: "Last day. Cancel before midnight or auto-charge begins.",
  },
  {
    phase: "Day 15",
    icon: CreditCard,
    color: "#00C853",
    description: "Card charged. Subscription active. Full access continues.",
  },
];

const EXPIRY_STEPS = [
  {
    phase: "7 Days Before",
    icon: CalendarDays,
    color: "#00C8E0",
    description: "Renewal reminder via email + dashboard banner.",
  },
  {
    phase: "3 Days Before",
    icon: AlertCircle,
    color: "#FF9500",
    description: "Urgent action required: confirm or cancel renewal.",
  },
  {
    phase: "Renewal Day",
    icon: CreditCard,
    color: "#00C853",
    description: "Auto-charge processed. Subscription renewed seamlessly.",
  },
  {
    phase: "If Payment Fails",
    icon: XCircle,
    color: "#FF2D55",
    description: "7-day grace period. Limited features. Update card urgently.",
  },
  {
    phase: "After 7-Day Grace",
    icon: TimerOff,
    color: "#FF2D55",
    description: "Account suspended. Data preserved 30 days, then deleted.",
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
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const [selectedPlan, setSelectedPlan] = useState<PlanTier["id"] | null>(null);
  const [employeeCount, setEmployeeCount] = useState(30);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showLifecycle, setShowLifecycle] = useState<"trial" | "renewal" | null>(null);
  const [showSuspensionDetail, setShowSuspensionDetail] = useState(false);
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null);
  const trialDays = trialDaysProp ?? 9;

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
    trial_active:  { label: "Trial Active",     color: "#00C8E0", bg: "rgba(0,200,224,0.08)",  border: "rgba(0,200,224,0.2)",  icon: Clock,         desc: `${trialDays} days remaining` },
    trial_ending:  { label: "Trial Ending Soon", color: "#FF9500", bg: "rgba(255,149,0,0.08)", border: "rgba(255,149,0,0.2)",  icon: AlertTriangle, desc: "2 days left — add card now" },
    trial_expired: { label: "Trial Expired",     color: "#FF2D55", bg: "rgba(255,45,85,0.08)", border: "rgba(255,45,85,0.2)",  icon: XCircle,       desc: "Select plan to continue" },
    active:        { label: "Active",            color: "#00C853", bg: "rgba(0,200,83,0.08)",  border: "rgba(0,200,83,0.2)",   icon: CheckCircle2,  desc: "Renews Apr 1, 2026" },
    payment_failed:{ label: "Payment Failed",    color: "#FF2D55", bg: "rgba(255,45,85,0.08)", border: "rgba(255,45,85,0.2)",  icon: AlertTriangle, desc: "Update card within 48h" },
    grace_period:  { label: "Grace Period",      color: "#FF9500", bg: "rgba(255,149,0,0.08)", border: "rgba(255,149,0,0.2)",  icon: Clock,         desc: "5 days to restore access" },
    suspended:     { label: "Suspended",         color: "#FF2D55", bg: "rgba(255,45,85,0.1)",  border: "rgba(255,45,85,0.25)", icon: TimerOff,      desc: "Data retained 30 days" },
  };
  const statusCfg = STATUS_CONFIG[currentStatus];
  const StatusIcon = statusCfg.icon;

  const FAQS = [
    {
      q: "هل يتم خصم المبلغ فوراً عند التسجيل؟",
      a: "لا. نقوم بحفظ بيانات بطاقتك بشكل آمن عبر Stripe كـ \"authorization hold\" بدون خصم فعلي. لن يتم الخصم إلا بعد انتهاء 14 يوم تجريبياً مجانياً، وبشرط عدم إلغاء الاشتراك قبلها.",
    },
    {
      q: "ماذا يحدث إذا تجاوزت عدد الموظفين المسموح به في خطتي؟",
      a: "يتم احتساب رسوم إضافية لكل موظف يتجاوز الحد المسموح. Starter: $8/موظف إضافي، Growth: $6، Business: $4. ستصلك تنبيهات عند 80% و95% من الحد.",
    },
    {
      q: "ماذا يحدث إذا فشل الدفع عند التجديد؟",
      a: "تبدأ فترة سماح 7 أيام: تظل قادراً على مشاهدة البيانات فقط (قراءة فقط). لا تعمل تنبيهات SOS الحية، ولا تتبع GPS في الوقت الفعلي. إذا لم تُحدَّث البطاقة خلال 7 أيام، يُوقف الحساب مؤقتاً وتُحفظ البيانات 30 يوماً.",
    },
    {
      q: "هل يمكنني إلغاء الاشتراك في أي وقت؟",
      a: "نعم. يمكنك الإلغاء في أي وقت من داخل لوحة التحكم. عند الإلغاء قبل انتهاء التجربة المجانية: لا يُخصم شيء. عند الإلغاء بعد الدفع: تنتهي خدمتك في نهاية دورة الفوترة الحالية ولا استرداد جزئي.",
    },
    {
      q: "هل بيانات موظفينا آمنة؟",
      a: "نعم. نخطط لاستخدام تشفير AES-256 للبيانات المخزنة وTLS 1.3 للبيانات أثناء النقل. عند إطلاق الدفع، ستُعالَج بيانات البطاقة البنكية بالكامل عبر Stripe ولن تُخزَّن لدينا مطلقاً.",
    },
    {
      q: "ماذا يحدث بعد انتهاء 30 يوماً من إيقاف الحساب؟",
      a: "يتم حذف جميع البيانات (الموظفون، الحوادث، السجلات) بشكل نهائي وغير قابل للاسترداد. تُرسَل 3 تنبيهات بالبريد الإلكتروني قبل الحذف: قبل 30 يوم، 14 يوم، و7 أيام. يُنصح بتنزيل البيانات فور الإيقاف.",
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
              <span style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>{trialDays} days left</span>
            </div>
          )}
          {(currentStatus === "payment_failed" || currentStatus === "grace_period") && (
            <button
              onClick={() => setShowPaymentForm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
              style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "#FF2D55" }}
            >
              <CreditCard className="size-3.5" />
              Update Card Now
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
              Subscription Plans
              <span style={{ color: "#00C8E0" }}> & Pricing</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 }}
              style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 5 }}
            >
              Flat-rate pricing · Extra employees billed separately · Cancel anytime
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
                <p className="text-white" style={{ fontSize: 15, fontWeight: 800 }}>Smart Plan Calculator</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>Drag to find your perfect plan instantly</p>
              </div>
              <div className="flex-1" />
              <div className="px-4 py-2 rounded-xl" style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)" }}>
                <span style={{ fontSize: 24, fontWeight: 900, color: "#00C8E0" }}>{employeeCount}</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginLeft: 4 }}>employees</span>
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
                    RECOMMENDED
                  </span>
                </div>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{recommendedPlan.description}</p>
                {recommendedPlan.maxEmployees > 0 && employeeCount > recommendedPlan.maxEmployees && (
                  <p style={{ fontSize: 11, color: "#F59E0B", marginTop: 4 }}>
                    +{employeeCount - recommendedPlan.maxEmployees} extra employees × ${recommendedPlan.extraEmployeePrice}/mo each
                  </p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                {recommendedPlan.monthlyPrice > 0 ? (
                  <span className="contents">
                    <p style={{ fontSize: 36, fontWeight: 900, color: recommendedPlan.color, letterSpacing: "-1px" }}>
                      ${billing === "monthly" ? recommendedPlan.monthlyPrice : recommendedPlan.annualMonthly}
                      <span style={{ fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.35)" }}>/mo</span>
                    </p>
                    {billing === "annual" && (
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                        ${recommendedPlan.annualPrice}/yr · Save ${annualSavings(recommendedPlan as any)}/yr
                      </p>
                    )}
                  </span>
                ) : (
                  <p style={{ fontSize: 26, fontWeight: 900, color: recommendedPlan.color }}>Custom</p>
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
                  {b === "monthly" ? "Monthly" : "Annual"}
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
                Save up to ${annualSavings(UNIFIED_PLANS[2])}/year on Business
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
                    MOST POPULAR
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
                      <p style={{ fontSize: 28, fontWeight: 900, color: plan.color, letterSpacing: "-0.5px" }}>Custom</p>
                    ) : (
                      <span className="contents">
                        <div className="flex items-baseline gap-1">
                          <span style={{ fontSize: 34, fontWeight: 900, color: plan.color, letterSpacing: "-1px" }}>${price}</span>
                          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>/month</span>
                        </div>
                        {billing === "annual" && savings > 0 && (
                          <p style={{ fontSize: 11, color: "#00C853", fontWeight: 600, marginTop: 2 }}>Save ${savings}/year</p>
                        )}
                        {plan.extraEmployeePrice > 0 && (
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 4 }}>+${plan.extraEmployeePrice}/extra employee</p>
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
                        +{plan.features.length - 6} more features
                      </p>
                    )}
                  </div>

                  {/* CTA */}
                  {isEnterprise ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); hapticLight(); toast("Contact Sales", { description: "Our enterprise team will reach out within 24 hours" }); }}
                      className="w-full py-3 rounded-xl flex items-center justify-center gap-2"
                      style={{ fontSize: 13, fontWeight: 700, color: plan.color, background: `${plan.color}10`, border: `1.5px solid ${plan.color}30`, cursor: "pointer" }}
                    >
                      <PhoneCall className="size-4" />
                      Contact Sales
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
                      {currentStatus === "active" ? "Switch Plan" : "Start 14-Day Trial"}
                    </button>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedPlan(plan.id); }}
                      className="w-full py-3 rounded-xl"
                      style={{ fontSize: 13, fontWeight: 700, color: plan.color, background: `${plan.color}08`, border: `1px solid ${plan.color}20` }}
                    >
                      Select Plan
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
              <p className="text-white" style={{ fontSize: 15, fontWeight: 800 }}>14-Day Free Trial — What You Need to Know</p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Complete transparency. No surprises.</p>
            </div>
          </div>

          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            {[
              {
                icon: CreditCard,
                color: "#00C8E0",
                title: "Card Required, Not Charged",
                desc: "We save your card securely via Stripe. Zero charge during trial. It's only used to auto-start your plan after 14 days.",
              },
              {
                icon: Clock,
                color: "#00C853",
                title: "Full Access, Zero Limits",
                desc: "During trial you get 100% of your plan's features — SOS alerts, GPS, command center, everything. No crippled demo.",
              },
              {
                icon: X,
                color: "#FF9500",
                title: "Cancel Before Day 14, Pay Nothing",
                desc: "Cancel any time before 11:59 PM on day 14 and you are never charged. No questions asked. Data exported if needed.",
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
              <p className="text-white flex-1 text-left" style={{ fontSize: 14, fontWeight: 700 }}>Trial Period Lifecycle</p>
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
                          <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{step.phase}</p>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5, marginTop: 2 }}>{step.description}</p>
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
              <p className="text-white flex-1 text-left" style={{ fontSize: 14, fontWeight: 700 }}>Subscription Renewal Lifecycle</p>
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
                          <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{step.phase}</p>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5, marginTop: 2 }}>{step.description}</p>
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
              <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>What Happens During Suspension?</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Feature restrictions & data retention policy</p>
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
                      { label: "SOS Alerts (Real-time)", suspended: true, color: "#FF2D55", note: "DISABLED — critical safety risk" },
                      { label: "Live GPS Tracking", suspended: true, color: "#FF2D55", note: "DISABLED" },
                      { label: "Admin Dashboard", suspended: false, color: "#FF9500", note: "READ-ONLY mode" },
                      { label: "Historical Reports", suspended: false, color: "#00C8E0", note: "View allowed" },
                      { label: "Data Export", suspended: false, color: "#00C853", note: "Full export available" },
                      { label: "Employee Login", suspended: true, color: "#FF2D55", note: "App access blocked" },
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
                    <p style={{ fontSize: 12, fontWeight: 700, color: "#FF2D55", marginBottom: 12 }}>⚠️ Data Retention Timeline After Suspension</p>
                    <div className="flex items-center gap-0">
                      {[
                        { day: "Day 0", label: "Suspended", color: "#FF9500" },
                        { day: "Day 7", label: "Grace ends", color: "#FF2D55" },
                        { day: "Day 30", label: "Warning sent", color: "#FF2D55" },
                        { day: "Day 37", label: "Final warning", color: "#FF2D55" },
                        { day: "Day 60", label: "Data deleted", color: "#FF2D55" },
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
            {[
              { icon: Lock, label: "SSL / TLS 1.3", sublabel: "End-to-End Encrypted" },
              { icon: BadgeCheck, label: "PCI DSS Level 1", sublabel: "via Stripe (coming soon)" },
              { icon: ShieldCheck, label: "AES-256", sublabel: "Data at Rest" },
              { icon: Globe, label: "GDPR Compliant", sublabel: "Data Sovereignty" },
              { icon: LifeBuoy, label: "99.9% Uptime", sublabel: "SLA Guaranteed" },
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
            Frequently Asked Questions
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
                  <p className="text-white" style={{ fontSize: 18, fontWeight: 900 }}>Secure Payment</p>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>Stripe integration coming soon</p>
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
                    <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{displayPlan.name} Plan · {billing === "monthly" ? "Monthly" : "Annual"}</p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                      14-day free trial then ${billing === "monthly" ? displayPlan.monthlyPrice : displayPlan.annualPrice}/{billing === "monthly" ? "mo" : "yr"}
                    </p>
                  </div>
                  <div className="px-3 py-1.5 rounded-xl" style={{ background: "rgba(0,200,83,0.1)", border: "1px solid rgba(0,200,83,0.2)" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#00C853" }}>FREE today</span>
                  </div>
                </div>

                {/* Stripe badge */}
                <div className="flex flex-col items-center py-8 gap-4">
                  <div className="size-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(0,200,224,0.06)", border: "1.5px solid rgba(0,200,224,0.15)" }}>
                    <CreditCard className="size-8" style={{ color: "#00C8E0" }} />
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ background: "rgba(123,94,255,0.06)", border: "1px solid rgba(123,94,255,0.15)" }}>
                    <Lock className="size-3.5" style={{ color: "#7B5EFF" }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#7B5EFF" }}>Powered by Stripe</span>
                  </div>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", textAlign: "center", lineHeight: 1.7, maxWidth: 320 }}>
                    Payment processing coming soon. Your card details will be handled securely by Stripe.
                  </p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", textAlign: "center", lineHeight: 1.5 }}>
                    No card information is collected or stored by this application.
                  </p>
                </div>

                {/* Notify button */}
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    console.log("[SUPABASE_READY] plan_selected: " + JSON.stringify({ planId: displayPlan.id, billingCycle: billing, totalMonthly: billing === "monthly" ? displayPlan.monthlyPrice : displayPlan.annualMonthly }));
                    toast.success("We'll contact you to complete setup", {
                      description: "Our team will reach out when Stripe payments are live.",
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
                  Notify Me When Available
                </motion.button>

                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", textAlign: "center", lineHeight: 1.6 }}>
                  14-day free trial · Cancel anytime · No card required now
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
