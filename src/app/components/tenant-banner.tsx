// ═══════════════════════════════════════════════════════════════
// TENANT BANNER — Trial / Billing status banner (Mobile)
// Mirrors TenantBanner.tsx from web
// ═══════════════════════════════════════════════════════════════
import React from "react";
import { motion } from "motion/react";
import { Clock, AlertTriangle, CreditCard, X, Crown } from "lucide-react";
import type { CompanyState } from "./mobile-company";
import { isTrial, isTrialExpired, isPastDue, trialDaysRemaining, isAccountBlocked } from "./mobile-company";

interface TenantBannerProps {
  companyState: CompanyState;
  onDismiss?: () => void;
  onUpgrade?: () => void;
  t: (k: string) => string;
  inline?: boolean;
}

export function TenantBanner({ companyState, onDismiss, onUpgrade, t, inline = false }: TenantBannerProps) {
  const trial = isTrial(companyState);
  const expired = isTrialExpired(companyState);
  const pastDue = isPastDue(companyState);
  const blocked = isAccountBlocked(companyState);
  const daysLeft = trialDaysRemaining(companyState);

  // Don't show banner for normal active accounts
  if (!trial && !expired && !pastDue && !blocked) return null;

  let config: { bg: string; border: string; color: string; icon: typeof Clock; message: string; cta: string };

  if (expired || blocked) {
    config = {
      bg: "rgba(255,45,85,0.1)",
      border: "rgba(255,45,85,0.2)",
      color: "#FF2D55",
      icon: AlertTriangle,
      message: t("tb.expired"),
      cta: t("tb.upgrade"),
    };
  } else if (pastDue) {
    config = {
      bg: "rgba(255,179,0,0.1)",
      border: "rgba(255,179,0,0.2)",
      color: "#FFB300",
      icon: CreditCard,
      message: t("tb.pastDue"),
      cta: t("tb.resolve"),
    };
  } else if (trial && daysLeft <= 3) {
    config = {
      bg: "rgba(255,179,0,0.1)",
      border: "rgba(255,179,0,0.2)",
      color: "#FFB300",
      icon: Clock,
      message: `${t("tb.trialEnds")} ${daysLeft} ${t("tb.days")}`,
      cta: t("tb.upgrade"),
    };
  } else {
    // Trial with more days
    config = {
      bg: "rgba(0,200,224,0.06)",
      border: "rgba(0,200,224,0.12)",
      color: "#00C8E0",
      icon: Crown,
      message: `${t("tb.trialActive")} — ${daysLeft} ${t("tb.daysLeft")}`,
      cta: t("tb.upgrade"),
    };
  }

  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`${inline ? "mx-5 mt-3 mb-1" : "absolute bottom-[72px] left-3 right-3 z-40"} rounded-xl overflow-hidden`}
      style={{
        background: config.bg,
        border: `1px solid ${config.border}`,
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <motion.div
          animate={expired || blocked ? { scale: [1, 1.15, 1] } : {}}
          transition={{ duration: 2, repeat: Infinity }}
          className="size-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${config.color}15` }}
        >
          <Icon className="size-3.5" style={{ color: config.color }} />
        </motion.div>

        <div className="flex-1 min-w-0">
          <p className="truncate" style={{ fontSize: 10, fontWeight: 600, color: config.color }}>
            {config.message}
          </p>
          <p style={{ fontSize: 8, color: "rgba(255,255,255,0.25)" }}>
            {companyState.planConfig.label} {t("tb.plan")}
          </p>
        </div>

        <button
          onClick={onUpgrade}
          className="px-3 py-1.5 rounded-lg flex-shrink-0"
          style={{
            background: `${config.color}15`,
            border: `1px solid ${config.color}30`,
            fontSize: 9,
            fontWeight: 700,
            color: config.color,
          }}
        >
          {config.cta}
        </button>

        {onDismiss && (
          <button
            onClick={onDismiss}
            className="size-5 rounded-md flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            <X className="size-3" style={{ color: "rgba(255,255,255,0.2)" }} />
          </button>
        )}
      </div>
    </motion.div>
  );
}
