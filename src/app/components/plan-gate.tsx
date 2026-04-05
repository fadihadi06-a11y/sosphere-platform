// ═══════════════════════════════════════════════════════════════
// Plan Gate — Feature-locked upgrade prompts + Limit enforcement
// Trial Expired Overlay — Blocks access after trial ends
// Zone/Employee limit modals — Real enforcement from companyState
// [SUPABASE_READY] All gate checks logged for migration
// ═══════════════════════════════════════════════════════════════

import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Lock, Crown, ArrowUpRight, Shield, Zap, Download, Clock, Users, AlertTriangle, CheckCircle, Star, MapPin } from "lucide-react";
import type { PlanFeature, CompanyState, PlanTier } from "./mobile-company";
import { hasFeature, isTrialExpired, PLAN_CONFIGS } from "./mobile-company";
import { UNIFIED_PLANS } from "../constants/pricing";

// ── Feature → minimum plan mapping ──────────────────────────────
const FEATURE_MIN_PLAN: Record<PlanFeature, { plan: PlanTier; label: string; color: string; price: number }> = {
  basic_dashboard:       { plan: "starter",    label: "Starter",     color: "#00C8E0", price: 149 },
  emergency_management:  { plan: "starter",    label: "Starter",     color: "#00C8E0", price: 149 },
  employee_management:   { plan: "starter",    label: "Starter",     color: "#00C8E0", price: 149 },
  zone_management:       { plan: "starter",    label: "Starter",     color: "#00C8E0", price: 149 },
  attendance:            { plan: "starter",    label: "Starter",     color: "#00C8E0", price: 149 },
  incident_history:      { plan: "growth",     label: "Growth",      color: "#7B5EFF", price: 349 },
  risk_map:              { plan: "growth",     label: "Growth",      color: "#7B5EFF", price: 349 },
  command_center:        { plan: "growth",     label: "Growth",      color: "#7B5EFF", price: 349 },
  audit_logs:            { plan: "growth",     label: "Growth",      color: "#7B5EFF", price: 349 },
  wall_mode:             { plan: "business",   label: "Business",    color: "#F59E0B", price: 799 },
  api_access:            { plan: "business",   label: "Business",    color: "#F59E0B", price: 799 },
  sla_management:        { plan: "business",   label: "Business",    color: "#F59E0B", price: 799 },
  advanced_analytics:    { plan: "business",   label: "Business",    color: "#F59E0B", price: 799 },
  ai_co_admin:           { plan: "business",   label: "Business",    color: "#F59E0B", price: 799 },
  custom_reports:        { plan: "business",   label: "Business",    color: "#F59E0B", price: 799 },
  custom_branding:       { plan: "enterprise", label: "Enterprise",  color: "#00C853", price: -1 },
  multi_site:            { plan: "enterprise", label: "Enterprise",  color: "#00C853", price: -1 },
};

// ── Plan tier ordering for price difference calc ──────────────
const PLAN_ORDER: PlanTier[] = ["starter", "growth", "business", "enterprise"];

function getPriceDifference(currentPlan: PlanTier, requiredPlan: PlanTier): string {
  const currentDef = UNIFIED_PLANS.find(p => p.id === currentPlan);
  const requiredDef = UNIFIED_PLANS.find(p => p.id === requiredPlan);
  if (!currentDef || !requiredDef) return "";
  if (requiredDef.monthlyPrice <= 0 || currentDef.monthlyPrice <= 0) return "";
  const diff = requiredDef.monthlyPrice - currentDef.monthlyPrice;
  return diff > 0 ? `+$${diff}/mo` : "";
}

// ── PlanGate — wraps content and shows upgrade prompt if locked ──
export function PlanGate({ feature, companyState, onUpgrade, children, compact }: {
  feature: PlanFeature;
  companyState: CompanyState;
  onUpgrade: () => void;
  children: React.ReactNode;
  compact?: boolean;
}) {
  const allowed = hasFeature(companyState, feature);
  const currentPlan = companyState.company.plan;

  // Log every gate check
  console.log("[SUPABASE_READY] plan_gate_check: " + JSON.stringify({
    feature, plan: currentPlan, allowed,
  }));

  if (allowed) {
    return <div className="contents">{children}</div>;
  }

  const info = FEATURE_MIN_PLAN[feature];
  const priceDiff = getPriceDifference(currentPlan, info.plan);
  const upgradeLabel = info.price > 0
    ? `Upgrade to ${info.label} ($${info.price}/mo)`
    : `Upgrade to ${info.label}`;

  if (compact) {
    return (
      <div className="flex items-center justify-center py-12 px-6">
        <div className="flex flex-col items-center gap-3 text-center" style={{ maxWidth: 320 }}>
          <div className="flex items-center justify-center size-10 rounded-xl"
            style={{ background: `${info.color}15`, border: `1px solid ${info.color}20` }}>
            <Lock className="size-4" style={{ color: info.color }} />
          </div>
          <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>
            Available on {info.label} and above
          </p>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
            {upgradeLabel} to unlock this feature.
            {priceDiff && <span style={{ color: info.color, fontWeight: 600 }}> ({priceDiff} from your current plan)</span>}
          </p>
          <button
            onClick={onUpgrade}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg mt-1"
            style={{
              background: `linear-gradient(135deg, ${info.color}, ${info.color}CC)`,
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              border: "none",
              cursor: "pointer",
            }}
          >
            <Crown className="size-3" />
            {upgradeLabel}
            <ArrowUpRight className="size-3" />
          </button>
        </div>
      </div>
    );
  }

  // Full-page gate
  return (
    <div className="flex items-center justify-center py-20 px-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center gap-5 text-center"
        style={{ maxWidth: 400 }}
      >
        {/* Lock icon with plan color ring */}
        <div className="relative">
          <motion.div
            animate={{ rotate: [0, 5, -5, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className="flex items-center justify-center size-16 rounded-2xl"
            style={{
              background: `${info.color}10`,
              border: `2px solid ${info.color}30`,
              boxShadow: `0 0 40px ${info.color}15`,
            }}
          >
            <Lock className="size-7" style={{ color: info.color }} />
          </motion.div>
          <div className="absolute -top-1 -right-1 size-5 rounded-full flex items-center justify-center"
            style={{ background: info.color }}>
            <Crown className="size-2.5" style={{ color: "#fff" }} />
          </div>
        </div>

        <div className="space-y-2">
          <h3 style={{ fontSize: 18, fontWeight: 800, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.3px" }}>
            {info.label} Plan Feature
          </h3>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
            This feature requires the <span style={{ color: info.color, fontWeight: 700 }}>{info.label}</span> plan
            or above. {upgradeLabel} to unlock full access.
          </p>
          {priceDiff && (
            <p style={{ fontSize: 12, color: info.color, fontWeight: 700, marginTop: 4 }}>
              {priceDiff} from your current {PLAN_CONFIGS[currentPlan].label} plan
            </p>
          )}
        </div>

        {/* Feature highlights for the required plan */}
        <div className="w-full rounded-xl p-4 space-y-2"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: info.color, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            {info.label} Plan Includes
          </p>
          {PLAN_CONFIGS[info.plan].features.slice(0, 5).map((f) => (
            <div key={f} className="flex items-center gap-2">
              <CheckCircle className="size-3 flex-shrink-0" style={{ color: info.color }} />
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
                {f.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onUpgrade}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl"
            style={{
              background: `linear-gradient(135deg, ${info.color}, ${info.color}BB)`,
              color: "#fff",
              fontSize: 12,
              fontWeight: 800,
              border: "none",
              cursor: "pointer",
              boxShadow: `0 4px 20px ${info.color}30`,
            }}
          >
            <Crown className="size-3.5" />
            Upgrade to {info.label}
            <ArrowUpRight className="size-3.5" />
          </button>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
            {info.price > 0 ? `$${info.price}/mo` : "Custom pricing"}
          </span>
        </div>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Zone / Employee Limit Enforcement (Items 1 & 2)
// ═══════════════════════════════════════════════════════════════

export interface LimitCheckResult {
  blocked: boolean;
  current: number;
  max: number;
  planName: string;
  planColor: string;
  /** The cheapest plan that would accommodate the next item */
  suggestedPlan: PlanTier | null;
  suggestedPrice: number;
}

/**
 * Check if adding a new zone exceeds the plan limit.
 * Uses zones.length from the store (not hardcoded).
 */
export function checkZoneLimit(currentZoneCount: number, companyState: CompanyState): LimitCheckResult {
  const plan = companyState.planConfig;
  const blocked = plan.maxZones !== -1 && currentZoneCount >= plan.maxZones;
  const suggestedPlan = blocked ? findNextPlanForZones(currentZoneCount + 1) : null;
  const suggestedPrice = suggestedPlan ? (UNIFIED_PLANS.find(p => p.id === suggestedPlan)?.monthlyPrice ?? -1) : -1;

  console.log("[SUPABASE_READY] plan_gate_check: " + JSON.stringify({
    feature: "zone_limit", plan: companyState.company.plan,
    allowed: !blocked, current: currentZoneCount, max: plan.maxZones,
  }));

  return {
    blocked,
    current: currentZoneCount,
    max: plan.maxZones,
    planName: plan.label,
    planColor: plan.color,
    suggestedPlan,
    suggestedPrice,
  };
}

/**
 * Check if adding a new employee exceeds the plan limit.
 * Uses employees.length from the store (not hardcoded).
 */
export function checkEmployeeLimit(currentEmployeeCount: number, companyState: CompanyState): LimitCheckResult {
  const plan = companyState.planConfig;
  const blocked = plan.maxEmployees !== -1 && currentEmployeeCount >= plan.maxEmployees;
  const suggestedPlan = blocked ? findNextPlanForEmployees(currentEmployeeCount + 1) : null;
  const suggestedPrice = suggestedPlan ? (UNIFIED_PLANS.find(p => p.id === suggestedPlan)?.monthlyPrice ?? -1) : -1;

  console.log("[SUPABASE_READY] plan_gate_check: " + JSON.stringify({
    feature: "employee_limit", plan: companyState.company.plan,
    allowed: !blocked, current: currentEmployeeCount, max: plan.maxEmployees,
  }));

  return {
    blocked,
    current: currentEmployeeCount,
    max: plan.maxEmployees,
    planName: plan.label,
    planColor: plan.color,
    suggestedPlan,
    suggestedPrice,
  };
}

function findNextPlanForZones(needed: number): PlanTier | null {
  for (const tier of PLAN_ORDER) {
    const cfg = PLAN_CONFIGS[tier];
    if (cfg.maxZones === -1 || cfg.maxZones >= needed) return tier;
  }
  return "enterprise";
}

function findNextPlanForEmployees(needed: number): PlanTier | null {
  for (const tier of PLAN_ORDER) {
    const cfg = PLAN_CONFIGS[tier];
    if (cfg.maxEmployees === -1 || cfg.maxEmployees >= needed) return tier;
  }
  return "enterprise";
}

// ═══════════════════════════════════════════════════════════════
// Plan Limit Modal — Zone / Employee / Feature limit reached
// ═══════════════════════════════════════════════════════════════

export function PlanLimitModal({ type, limitResult, onUpgrade, onClose }: {
  type: "zone" | "employee";
  limitResult: LimitCheckResult;
  onUpgrade: () => void;
  onClose: () => void;
}) {
  const isZone = type === "zone";
  const Icon = isZone ? MapPin : Users;
  const title = isZone ? "Zone Limit Reached" : "Employee Limit Reached";
  const message = isZone
    ? `Your ${limitResult.planName} plan allows up to ${limitResult.max} zones. You currently have ${limitResult.current}.`
    : `Employee limit reached. Current plan: ${limitResult.planName} — max ${limitResult.max} employees.`;

  const suggestedDef = limitResult.suggestedPlan
    ? UNIFIED_PLANS.find(p => p.id === limitResult.suggestedPlan)
    : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9998] flex items-center justify-center p-6"
      style={{ background: "rgba(5,7,14,0.85)", backdropFilter: "blur(12px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        transition={{ type: "spring", damping: 22 }}
        className="w-full rounded-2xl p-6 space-y-5"
        style={{
          maxWidth: 400,
          background: "linear-gradient(145deg, rgba(10,18,32,0.98), rgba(15,22,38,0.95))",
          border: `1px solid ${limitResult.planColor}25`,
          boxShadow: "0 25px 80px rgba(0,0,0,0.6)",
        }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-col items-center gap-3 text-center">
          <motion.div
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="size-14 rounded-2xl flex items-center justify-center"
            style={{ background: `${limitResult.planColor}12`, border: `1px solid ${limitResult.planColor}25` }}
          >
            <Icon className="size-7" style={{ color: limitResult.planColor }} />
          </motion.div>
          <h3 className="text-white" style={{ fontSize: 18, fontWeight: 800 }}>{title}</h3>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
            {message}
          </p>
        </div>

        {/* Usage bar */}
        <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center justify-between mb-2">
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              {isZone ? "Zone" : "Employee"} Usage
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#FF2D55" }}>
              {limitResult.current} / {limitResult.max === -1 ? "∞" : limitResult.max}
            </span>
          </div>
          <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div className="h-full rounded-full" style={{
              width: "100%",
              background: "linear-gradient(90deg, #FF9500, #FF2D55)",
            }} />
          </div>
        </div>

        {/* Suggested plan */}
        {suggestedDef && (
          <div className="rounded-xl p-4" style={{
            background: `${suggestedDef.color}08`,
            border: `1px solid ${suggestedDef.color}20`,
          }}>
            <div className="flex items-center gap-2 mb-1.5">
              <Star className="size-3" style={{ color: suggestedDef.color }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: suggestedDef.color, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Recommended Upgrade
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white" style={{ fontSize: 15, fontWeight: 800 }}>{suggestedDef.name}</p>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                  Up to {isZone
                    ? (suggestedDef.maxZones === -1 ? "unlimited" : suggestedDef.maxZones) + " zones"
                    : (suggestedDef.maxEmployees === -1 ? "unlimited" : suggestedDef.maxEmployees) + " employees"
                  }
                </p>
              </div>
              {suggestedDef.monthlyPrice > 0 ? (
                <p style={{ fontSize: 20, fontWeight: 900, color: suggestedDef.color }}>
                  ${suggestedDef.monthlyPrice}<span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>/mo</span>
                </p>
              ) : (
                <p style={{ fontSize: 14, fontWeight: 800, color: suggestedDef.color }}>Custom</p>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2.5">
          <button
            onClick={() => { onUpgrade(); onClose(); }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl"
            style={{
              background: suggestedDef
                ? `linear-gradient(135deg, ${suggestedDef.color}, ${suggestedDef.color}BB)`
                : "linear-gradient(135deg, #00C8E0, #00A0B8)",
              color: "#fff", fontSize: 13, fontWeight: 800,
              border: "none", cursor: "pointer",
              boxShadow: `0 4px 20px ${suggestedDef?.color ?? "#00C8E0"}30`,
            }}
          >
            <Crown className="size-4" />
            Upgrade Plan
            <ArrowUpRight className="size-3.5" />
          </button>
          <button onClick={onClose}
            className="w-full py-2 rounded-lg"
            style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", background: "transparent", border: "none", cursor: "pointer" }}>
            Maybe Later
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Feature-Specific Gate Check (for inline checks, e.g. AI Co-Admin)
// Returns { allowed, info } so callers can decide what to show
// ═══════════════════════════════════════════════════════════════

export function checkFeatureGate(feature: PlanFeature, companyState: CompanyState): {
  allowed: boolean;
  requiredPlan: PlanTier;
  requiredPlanLabel: string;
  requiredPlanPrice: number;
  requiredPlanColor: string;
  priceDiff: string;
} {
  const allowed = hasFeature(companyState, feature);
  const info = FEATURE_MIN_PLAN[feature];

  console.log("[SUPABASE_READY] plan_gate_check: " + JSON.stringify({
    feature, plan: companyState.company.plan, allowed,
  }));

  return {
    allowed,
    requiredPlan: info.plan,
    requiredPlanLabel: info.label,
    requiredPlanPrice: info.price,
    requiredPlanColor: info.color,
    priceDiff: getPriceDifference(companyState.company.plan, info.plan),
  };
}

// ═══════════════════════════════════════════════════════════════
// TrialExpiredOverlay — Full screen block when trial ends
// ═══════════════════════════════════════════════════════════════

export function TrialExpiredOverlay({ companyState, employeeCount, onChoosePlan, onExportData }: {
  companyState: CompanyState;
  employeeCount: number;
  onChoosePlan: () => void;
  onExportData: () => void;
}) {
  // Recommend plan based on employee count (from store, not hardcoded)
  const recommendedPlan: PlanTier = employeeCount <= 25 ? "starter"
    : employeeCount <= 100 ? "growth"
    : employeeCount <= 500 ? "business"
    : "enterprise";
  const planInfo = PLAN_CONFIGS[recommendedPlan];

  // Grace period: 7 days after trial_expired to export data (matches pricing FAQ)
  const expiredDaysAgo = companyState.company.trialEndsAt
    ? Math.max(0, Math.ceil((Date.now() - companyState.company.trialEndsAt.getTime()) / 86400000))
    : 0;
  const gracePeriodDays = 7;
  const graceDaysLeft = Math.max(0, gracePeriodDays - expiredDaysAgo);
  const isGraceExpired = graceDaysLeft <= 0;

  console.log("[SUPABASE_READY] plan_gate_check: " + JSON.stringify({
    feature: "trial_expired_overlay", plan: companyState.company.plan,
    allowed: false, employeeCount, recommendedPlan,
  }));

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 flex items-center justify-center p-6"
        style={{
          background: "rgba(5,7,14,0.95)",
          backdropFilter: "blur(20px)",
          zIndex: 9999,
        }}
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          transition={{ type: "spring", damping: 20 }}
          className="w-full rounded-2xl p-6 space-y-5"
          style={{
            maxWidth: 440,
            background: "linear-gradient(145deg, rgba(10,18,32,0.98), rgba(15,22,38,0.95))",
            border: "1px solid rgba(255,45,85,0.15)",
            boxShadow: "0 25px 80px rgba(0,0,0,0.6), 0 0 60px rgba(255,45,85,0.08)",
          }}
        >
          {/* Header */}
          <div className="flex flex-col items-center gap-3 text-center">
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="flex items-center justify-center size-14 rounded-2xl"
              style={{ background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.2)" }}
            >
              <Clock className="size-7" style={{ color: "#FF2D55" }} />
            </motion.div>
            <h2 style={{ fontSize: 20, fontWeight: 900, color: "#fff", letterSpacing: "-0.5px" }}>
              Your 14-Day Trial Has Ended
            </h2>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
              Your free trial expired {expiredDaysAgo} day{expiredDaysAgo !== 1 ? "s" : ""} ago.
              Choose a plan to continue protecting your workforce.
            </p>
          </div>

          {/* Usage Summary — employeeCount from store */}
          <div className="rounded-xl p-4 space-y-2.5"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Your Trial Activity
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Employees Added", value: String(employeeCount), icon: Users, color: "#00C8E0" },
                { label: "Emergencies Handled", value: "12", icon: AlertTriangle, color: "#FF2D55" },
                { label: "Zones Created", value: "5", icon: Shield, color: "#7B5EFF" },
                { label: "Days Active", value: `${14 + expiredDaysAgo}`, icon: Zap, color: "#FF9500" },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
                  style={{ background: `${item.color}08`, border: `1px solid ${item.color}12` }}>
                  <item.icon className="size-3.5" style={{ color: item.color }} />
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 800, color: item.color }}>{item.value}</p>
                    <p style={{ fontSize: 8, color: "rgba(255,255,255,0.35)" }}>{item.label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recommended Plan */}
          <div className="rounded-xl p-4"
            style={{
              background: `linear-gradient(135deg, ${planInfo.color}10, ${planInfo.color}05)`,
              border: `1px solid ${planInfo.color}25`,
            }}>
            <div className="flex items-center gap-2 mb-2">
              <Star className="size-3.5" style={{ color: planInfo.color }} />
              <p style={{ fontSize: 10, fontWeight: 700, color: planInfo.color, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Recommended for You
              </p>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <p style={{ fontSize: 16, fontWeight: 900, color: "#fff" }}>{planInfo.label}</p>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                  Up to {planInfo.maxEmployees === -1 ? "unlimited" : planInfo.maxEmployees} employees
                </p>
              </div>
              {planInfo.price > 0 ? (
                <div className="text-right">
                  <p style={{ fontSize: 22, fontWeight: 900, color: planInfo.color }}>${planInfo.price}</p>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>/month</p>
                </div>
              ) : (
                <p style={{ fontSize: 14, fontWeight: 800, color: planInfo.color }}>Custom Pricing</p>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2.5">
            <button
              onClick={onChoosePlan}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl"
              style={{
                background: "linear-gradient(135deg, #00C8E0, #00A0B8)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 800,
                border: "none",
                cursor: "pointer",
                boxShadow: "0 4px 20px rgba(0,200,224,0.3)",
              }}
            >
              <Crown className="size-4" />
              Choose a Plan
              <ArrowUpRight className="size-4" />
            </button>

            {!isGraceExpired && (
              <button
                onClick={onExportData}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  color: "rgba(255,255,255,0.5)",
                  fontSize: 11,
                  fontWeight: 600,
                  border: "1px solid rgba(255,255,255,0.08)",
                  cursor: "pointer",
                }}
              >
                <Download className="size-3.5" />
                Export My Data ({graceDaysLeft} day{graceDaysLeft !== 1 ? "s" : ""} left)
              </button>
            )}

            {isGraceExpired && (
              <p className="text-center" style={{ fontSize: 10, color: "rgba(255,45,85,0.6)" }}>
                Data export grace period has ended. Subscribe to access your data.
              </p>
            )}
          </div>

          {/* Footer note */}
          <p className="text-center" style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", lineHeight: 1.5 }}>
            Your data is safe. Choose any plan to pick up right where you left off.
            <br />Settings and Billing pages remain accessible.
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Allowed pages when trial is expired (Settings, Billing only) ──
export const TRIAL_ALLOWED_PAGES = new Set(["settings", "billing"]);

// ── Helper: check if a page needs trial gate ──
export function isPageBlockedByTrial(page: string, companyState: CompanyState): boolean {
  if (!isTrialExpired(companyState)) return false;
  return !TRIAL_ALLOWED_PAGES.has(page);
}
