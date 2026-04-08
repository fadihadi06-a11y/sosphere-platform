// ═══════════════════════════════════════════════════════════════
// SOSphere — React Feature-Gating Components & Hooks
// Context provider + useFeatureGate hook + UI components
// ═══════════════════════════════════════════════════════════════

import React, { createContext, useContext, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Lock, Crown, ArrowUpRight, AlertCircle,
  TrendingUp, Zap,
} from 'lucide-react';
import {
  PlanTier,
  hasFeature,
  getFeatureLimit,
  isAtLimit,
  getUpgradePath,
  getMinimumTierForFeature,
  getPlanByTier,
  calculateAnnualSavings,
  formatPrice,
  FEATURE_CATALOG,
  PRICING_PLANS,
} from './pricing-plans';

// ═══════════════════════════════════════════════════════════════
// Context & Provider
// ═══════════════════════════════════════════════════════════════

interface FeatureGateContextType {
  currentTier: PlanTier;
  hasFeature: (featureKey: string) => boolean;
  getFeatureLimit: (featureKey: string) => number | 'unlimited' | null;
  isAtLimit: (featureKey: string, currentUsage: number) => boolean;
  requiresUpgrade: (featureKey: string) => PlanTier | null;
}

const FeatureGateContext = createContext<FeatureGateContextType | null>(null);

export interface FeatureGateProviderProps {
  children: React.ReactNode;
  /** Current plan tier. If not provided, will attempt to fetch from Supabase (stub) */
  currentPlan?: PlanTier;
  /** Optional callback to fetch plan from backend */
  fetchPlan?: () => Promise<PlanTier>;
}

/**
 * FeatureGateProvider — Wraps the app and provides feature-gating context
 * Reads plan from prop or fetches from Supabase (stubbed)
 */
export function FeatureGateProvider({
  children,
  currentPlan = 'free',
  fetchPlan,
}: FeatureGateProviderProps) {
  const [tier, setTier] = useState<PlanTier>(currentPlan);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch plan on mount if callback provided
  useEffect(() => {
    if (!fetchPlan) return;

    const loadPlan = async () => {
      setIsLoading(true);
      try {
        const plan = await fetchPlan();
        setTier(plan);
        if (import.meta.env.DEV) {
          console.log(`[FeatureGate] Loaded plan from backend: ${plan}`);
        }
      } catch (error) {
        console.error('[FeatureGate] Failed to fetch plan:', error);
        // Fall back to prop or default
        setTier(currentPlan);
      } finally {
        setIsLoading(false);
      }
    };

    loadPlan();
  }, [fetchPlan, currentPlan]);

  const value: FeatureGateContextType = {
    currentTier: tier,
    hasFeature: (featureKey: string) => hasFeature(tier, featureKey),
    getFeatureLimit: (featureKey: string) => getFeatureLimit(tier, featureKey),
    isAtLimit: (featureKey: string, currentUsage: number) =>
      isAtLimit(tier, featureKey, currentUsage),
    requiresUpgrade: (featureKey: string) => getUpgradePath(tier, featureKey),
  };

  if (isLoading) {
    return <>{children}</>;
  }

  return (
    <FeatureGateContext.Provider value={value}>
      {children}
    </FeatureGateContext.Provider>
  );
}

/**
 * useFeatureGate — Hook to access feature-gating functions
 */
export function useFeatureGate(): FeatureGateContextType {
  const context = useContext(FeatureGateContext);
  if (!context) {
    throw new Error('useFeatureGate must be used within <FeatureGateProvider>');
  }
  return context;
}

// ═══════════════════════════════════════════════════════════════
// FeatureGate Component — Conditional Rendering
// ═══════════════════════════════════════════════════════════════

export interface FeatureGateProps {
  feature: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  compact?: boolean;
}

/**
 * FeatureGate — Renders children only if feature is available
 * Shows fallback (or default upgrade prompt) if locked
 */
export function FeatureGate({
  feature,
  children,
  fallback,
  compact = false,
}: FeatureGateProps) {
  const gate = useFeatureGate();

  if (gate.hasFeature(feature)) {
    return <>{children}</>;
  }

  if (import.meta.env.DEV) {
    console.log(`[FeatureGate] Feature "${feature}" blocked for tier "${gate.currentTier}"`);
  }

  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  // Default: show upgrade prompt
  return <UpgradePrompt feature={feature} compact={compact} />;
}

// ═══════════════════════════════════════════════════════════════
// UpgradePrompt Component — Styled Upgrade CTA
// ═══════════════════════════════════════════════════════════════

export interface UpgradePromptProps {
  feature: string;
  compact?: boolean;
  onUpgradeClick?: () => void;
}

/**
 * UpgradePrompt — Shows a styled prompt to upgrade for a locked feature
 */
export function UpgradePrompt({
  feature,
  compact = false,
  onUpgradeClick,
}: UpgradePromptProps) {
  const gate = useFeatureGate();
  const requiredTier = gate.requiresUpgrade(feature);
  const featureDef = FEATURE_CATALOG[feature];

  if (!requiredTier || !featureDef) {
    return null;
  }

  const requiredPlan = getPlanByTier(requiredTier);
  const tierColors: Record<PlanTier, string> = {
    free: '#00C8E0',
    pro: '#7B5EFF',
    enterprise: '#00C853',
  };

  const tierGradients: Record<PlanTier, string> = {
    free: 'linear-gradient(135deg, #00C8E0, #00A5C0)',
    pro: 'linear-gradient(135deg, #7B5EFF, #5B3FD8)',
    enterprise: 'linear-gradient(135deg, #00C853, #008C3D)',
  };

  const color = tierColors[requiredTier];
  const gradient = tierGradients[requiredTier];

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 px-4 py-3 rounded-lg"
        style={{
          background: `${color}10`,
          border: `1px solid ${color}20`,
        }}
      >
        <Lock className="size-4 flex-shrink-0" style={{ color }} />
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold mb-0.5">
            {featureDef.label}
          </p>
          <p className="text-xs" style={{ color: `${color}B3` }}>
            Available on {requiredPlan.name} plan
          </p>
        </div>
        <button
          onClick={onUpgradeClick}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white whitespace-nowrap flex-shrink-0"
          style={{
            background: gradient,
            boxShadow: `0 2px 8px ${color}30`,
          }}
        >
          Upgrade
          <ArrowUpRight className="size-3" />
        </button>
      </motion.div>
    );
  }

  // Full-page style prompt
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center gap-5 text-center py-16 px-6"
    >
      {/* Lock icon with overlay */}
      <div className="relative">
        <motion.div
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="flex items-center justify-center size-16 rounded-2xl"
          style={{
            background: `${color}10`,
            border: `2px solid ${color}20`,
            boxShadow: `0 0 32px ${color}15`,
          }}
        >
          <Lock className="size-7" style={{ color }} />
        </motion.div>
        <div
          className="absolute top-0 right-0 flex items-center justify-center size-5 rounded-full"
          style={{ background: color }}
        >
          <Crown className="size-2.5 text-white" />
        </div>
      </div>

      {/* Content */}
      <div>
        <h3
          className="text-white text-xl font-bold mb-2"
          style={{ letterSpacing: '-0.3px' }}
        >
          {featureDef.label}
        </h3>
        <p className="text-sm max-w-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
          This feature is available on the <strong style={{ color }}>{requiredPlan.name}</strong> plan.
          {requiredPlan.monthlyPrice > 0 && (
            <>
              {' '}Starting at <strong style={{ color }}>
                ${formatPrice(requiredPlan.monthlyPrice)}/month
              </strong>
            </>
          )}
        </p>
      </div>

      {/* Plan highlights */}
      <div
        className="w-full max-w-sm rounded-lg p-4 space-y-2"
        style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <p
          className="text-xs font-bold uppercase"
          style={{ color, letterSpacing: '0.5px' }}
        >
          What's Included
        </p>
        <div className="space-y-1.5">
          {requiredPlan.features.slice(0, 4).map((key) => (
            <div key={key} className="flex items-center gap-2">
              <Zap className="size-3 flex-shrink-0" style={{ color }} />
              <span
                className="text-xs"
                style={{ color: 'rgba(255,255,255,0.6)' }}
              >
                {FEATURE_CATALOG[key]?.label || key}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={onUpgradeClick}
        className="flex items-center gap-2 px-6 py-3 rounded-lg text-white font-bold text-sm"
        style={{
          background: gradient,
          boxShadow: `0 4px 16px ${color}30`,
        }}
      >
        <Crown className="size-4" />
        Upgrade to {requiredPlan.name}
        <ArrowUpRight className="size-4" />
      </button>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// UsageMeter Component — Shows usage vs limit for metered features
// ═══════════════════════════════════════════════════════════════

export interface UsageMeterProps {
  feature: string;
  currentUsage: number;
  label?: string;
  showPercentage?: boolean;
}

/**
 * UsageMeter — Progress bar with color coding (green → yellow → red)
 */
export function UsageMeter({
  feature,
  currentUsage,
  label,
  showPercentage = true,
}: UsageMeterProps) {
  const gate = useFeatureGate();
  const limit = gate.getFeatureLimit(feature);
  const featureDef = FEATURE_CATALOG[feature];

  // If no limit or unlimited, don't show meter
  if (!limit || limit === 'unlimited' || limit === null) {
    return null;
  }

  const percentage = (currentUsage / limit) * 100;
  const isAtLimit = gate.isAtLimit(feature, currentUsage);

  // Color coding: green → yellow → red
  let color = '#00C853'; // green
  if (percentage >= 80) color = '#FF2D55'; // red
  else if (percentage >= 60) color = '#FF9500'; // yellow

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-2"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-white">
          {label || featureDef?.label || feature}
        </span>
        <span className="text-xs" style={{ color }}>
          {currentUsage} / {limit} used
        </span>
      </div>

      <div className="w-full h-2 rounded-full overflow-hidden" style={{
        background: 'rgba(255,255,255,0.08)',
      }}>
        <motion.div
          className="h-full rounded-full transition-all"
          style={{ background: color, width: `${Math.min(percentage, 100)}%` }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(percentage, 100)}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      {isAtLimit && (
        <div className="flex items-center gap-1.5 text-xs" style={{ color }}>
          <AlertCircle className="size-3" />
          <span>You've reached your limit. Upgrade to increase this.</span>
        </div>
      )}

      {showPercentage && percentage < 100 && (
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {Math.round(percentage)}% of limit used
        </p>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Advanced Hook: Feature with Metered Usage
// ═══════════════════════════════════════════════════════════════

export interface MeteredFeatureInfo {
  allowed: boolean;
  limit: number | 'unlimited' | null;
  isAtLimit: boolean;
  percentageUsed: number;
  upgradeRequired: PlanTier | null;
}

/**
 * useMeteredFeature — Get detailed usage info for a feature with limits
 */
export function useMeteredFeature(
  feature: string,
  currentUsage: number,
): MeteredFeatureInfo {
  const gate = useFeatureGate();
  const limit = gate.getFeatureLimit(feature);

  const allowed = gate.hasFeature(feature);
  const isAtLimit = allowed && gate.isAtLimit(feature, currentUsage);

  const percentageUsed =
    limit === null || limit === 'unlimited'
      ? 0
      : (currentUsage / limit) * 100;

  return {
    allowed,
    limit,
    isAtLimit,
    percentageUsed,
    upgradeRequired: !allowed ? gate.requiresUpgrade(feature) : null,
  };
}
