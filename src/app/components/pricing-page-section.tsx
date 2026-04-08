// ═══════════════════════════════════════════════════════════════
// SOSphere — Pricing Page Section Component
// Three-column pricing card layout with feature comparison table
// Responsive: stacks on mobile. Ready for embedding in existing pages.
// ═══════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Check, X, Crown, Zap, Shield, Rocket,
  ToggleLeft, ToggleRight, ArrowUpRight, Star,
  AlertCircle, TrendingUp, Users, MapPin, Clock,
  Bell, Lock, BarChart3, FileText, Phone,
  CheckCircle2, ArrowRight,
} from 'lucide-react';
import {
  PRICING_PLANS,
  FEATURE_CATALOG,
  calculateAnnualSavings,
  formatPrice,
  PlanTier,
} from './pricing-plans';

// ═══════════════════════════════════════════════════════════════
// Types & Constants
// ═══════════════════════════════════════════════════════════════

type BillingCycle = 'monthly' | 'annual';

const PLAN_ICONS: Record<PlanTier, typeof Shield> = {
  free: Shield,
  pro: Zap,
  enterprise: Crown,
};

const PLAN_COLORS: Record<PlanTier, { primary: string; light: string; glow: string }> = {
  free: {
    primary: '#00C8E0',
    light: 'rgba(0,200,224,0.08)',
    glow: 'rgba(0,200,224,0.15)',
  },
  pro: {
    primary: '#7B5EFF',
    light: 'rgba(123,94,255,0.08)',
    glow: 'rgba(123,94,255,0.15)',
  },
  enterprise: {
    primary: '#00C853',
    light: 'rgba(0,200,83,0.08)',
    glow: 'rgba(0,200,83,0.15)',
  },
};

// ═══════════════════════════════════════════════════════════════
// Main Pricing Section Component
// ═══════════════════════════════════════════════════════════════

export interface PricingPageSectionProps {
  onCtaClick?: (tier: PlanTier, billingCycle: BillingCycle) => void;
  defaultBillingCycle?: BillingCycle;
  showComparisonTable?: boolean;
  className?: string;
}

export function PricingPageSection({
  onCtaClick,
  defaultBillingCycle = 'annual',
  showComparisonTable = true,
  className,
}: PricingPageSectionProps) {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(defaultBillingCycle);

  const handleCtaClick = (tier: PlanTier) => {
    if (onCtaClick) {
      onCtaClick(tier, billingCycle);
    }
  };

  return (
    <div className={`w-full py-20 px-4 ${className || ''}`} style={{ background: '#05070E' }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-6xl mx-auto text-center mb-12"
      >
        <div className="inline-block px-3 py-1.5 rounded-full mb-4" style={{
          background: 'rgba(0,200,224,0.1)',
          border: '1px solid rgba(0,200,224,0.2)',
        }}>
          <span className="text-xs font-bold" style={{ color: '#00C8E0' }}>
            FLEXIBLE PRICING
          </span>
        </div>
        <h2 className="text-4xl font-bold text-white mb-4" style={{ letterSpacing: '-0.5px' }}>
          Simple, Transparent Pricing
        </h2>
        <p className="text-lg text-gray-400 max-w-2xl mx-auto mb-8">
          Choose the plan that fits your team's safety needs. Scale as you grow.
        </p>

        {/* Billing Toggle */}
        <div className="flex items-center justify-center gap-6">
          <span
            className="text-sm font-semibold"
            style={{ color: billingCycle === 'monthly' ? '#fff' : 'rgba(255,255,255,0.5)' }}
          >
            Monthly
          </span>
          <motion.button
            onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'annual' : 'monthly')}
            className="relative inline-flex items-center rounded-full p-1 transition-colors"
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
            }}
          >
            <motion.div
              className="absolute size-6 rounded-full"
              style={{ background: '#00C8E0' }}
              animate={{ x: billingCycle === 'annual' ? 28 : 4 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
            <span className="relative px-4 py-1 text-xs font-bold text-transparent">
              Toggle
            </span>
          </motion.button>
          <span
            className="text-sm font-semibold"
            style={{ color: billingCycle === 'annual' ? '#fff' : 'rgba(255,255,255,0.5)' }}
          >
            Yearly
          </span>
          {billingCycle === 'annual' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="ml-2 px-2.5 py-1 rounded-lg text-xs font-bold"
              style={{
                background: 'rgba(0,200,83,0.1)',
                border: '1px solid rgba(0,200,83,0.2)',
                color: '#00C853',
              }}
            >
              Save 17%
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* Pricing Cards */}
      <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-6 mb-12">
        {PRICING_PLANS.map((plan, index) => {
          const colors = PLAN_COLORS[plan.tier];
          const Icon = PLAN_ICONS[plan.tier];
          const isHighlighted = plan.highlighted;
          const price =
            billingCycle === 'monthly'
              ? plan.monthlyPrice
              : Math.round(plan.annualPrice / 12);
          const displayPrice = billingCycle === 'monthly' ? plan.monthlyPrice : plan.annualPrice;
          const savings = billingCycle === 'annual' ? calculateAnnualSavings(plan.tier) : 0;

          return (
            <motion.div
              key={plan.tier}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="relative"
            >
              {/* Highlight halo background */}
              {isHighlighted && (
                <div
                  className="absolute inset-0 rounded-2xl"
                  style={{
                    background: `radial-gradient(ellipse at center, ${colors.glow}, transparent 70%)`,
                    filter: 'blur(12px)',
                  }}
                />
              )}

              {/* Card */}
              <div
                className="relative rounded-2xl p-8 h-full flex flex-col"
                style={{
                  background: isHighlighted
                    ? `linear-gradient(135deg, ${colors.light}, rgba(255,255,255,0.02))`
                    : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${isHighlighted ? colors.primary + '30' : 'rgba(255,255,255,0.05)'}`,
                  boxShadow: isHighlighted ? `0 0 40px ${colors.glow}` : 'none',
                }}
              >
                {/* Most Popular Badge */}
                {isHighlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <div
                      className="px-4 py-1 rounded-full text-xs font-bold flex items-center gap-1"
                      style={{
                        background: colors.primary,
                        color: '#fff',
                      }}
                    >
                      <Star className="size-3" />
                      Most Popular
                    </div>
                  </div>
                )}

                {/* Plan Icon & Header */}
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <div
                      className="inline-flex items-center justify-center size-12 rounded-xl mb-4"
                      style={{
                        background: colors.light,
                        border: `1px solid ${colors.primary}20`,
                      }}
                    >
                      <Icon className="size-6" style={{ color: colors.primary }} />
                    </div>
                    <h3 className="text-2xl font-bold text-white mb-1">{plan.name}</h3>
                    <p className="text-sm text-gray-400">{plan.tagline}</p>
                  </div>
                </div>

                {/* Price */}
                <div className="mb-6">
                  <div className="flex items-baseline gap-1 mb-1">
                    <span
                      className="text-5xl font-bold"
                      style={{ color: colors.primary }}
                    >
                      ${formatPrice(price)}
                    </span>
                    <span className="text-sm text-gray-400">/{billingCycle === 'monthly' ? 'month' : 'year'}</span>
                  </div>

                  {billingCycle === 'annual' && plan.monthlyPrice > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-gray-500">
                        ${formatPrice(Math.round(plan.annualPrice / 12))}/month billed annually
                      </p>
                      {savings > 0 && (
                        <p className="text-xs font-semibold" style={{ color: '#00C853' }}>
                          Save ${formatPrice(savings * 100)}/year
                        </p>
                      )}
                    </div>
                  )}

                  {plan.monthlyPrice === 0 && (
                    <p className="text-xs text-gray-500 mt-1">Forever free</p>
                  )}
                </div>

                {/* Limits */}
                <div className="mb-6 space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-gray-300">
                    <Users className="size-4" style={{ color: colors.primary }} />
                    <span>
                      {typeof plan.maxEmployees === 'number'
                        ? `Up to ${plan.maxEmployees} employees`
                        : 'Unlimited employees'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-300">
                    <MapPin className="size-4" style={{ color: colors.primary }} />
                    <span>
                      {typeof plan.maxLocations === 'number'
                        ? `Up to ${plan.maxLocations} locations`
                        : 'Unlimited locations'}
                    </span>
                  </div>
                </div>

                {/* CTA Button */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleCtaClick(plan.tier)}
                  className="w-full py-3 rounded-lg font-bold text-sm mb-6 transition-all flex items-center justify-center gap-2"
                  style={{
                    background:
                      plan.ctaVariant === 'primary'
                        ? colors.primary
                        : plan.ctaVariant === 'secondary'
                          ? `${colors.primary}20`
                          : 'rgba(255,255,255,0.05)',
                    color:
                      plan.ctaVariant === 'primary'
                        ? '#fff'
                        : colors.primary,
                    border:
                      plan.ctaVariant === 'outline'
                        ? `1px solid rgba(255,255,255,0.1)`
                        : 'none',
                    boxShadow:
                      plan.ctaVariant === 'primary'
                        ? `0 4px 16px ${colors.glow}`
                        : 'none',
                  }}
                >
                  {plan.ctaLabel}
                  {plan.ctaVariant === 'primary' && <ArrowUpRight className="size-4" />}
                </motion.button>

                {/* Features List */}
                <div className="flex-1 space-y-3 border-t border-gray-800 pt-6">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                    Included Features
                  </p>
                  <div className="space-y-3">
                    {plan.features.slice(0, 8).map((featureKey) => {
                      const feature = FEATURE_CATALOG[featureKey];
                      if (!feature) return null;

                      return (
                        <div key={featureKey} className="flex items-start gap-2.5">
                          <CheckCircle2
                            className="size-4 flex-shrink-0 mt-0.5"
                            style={{ color: colors.primary }}
                          />
                          <div>
                            <p className="text-sm text-white font-medium">{feature.label}</p>
                            {feature.limit && feature.limit[plan.tier] && (
                              <p className="text-xs text-gray-500">
                                {feature.limit[plan.tier] === 'unlimited'
                                  ? 'Unlimited'
                                  : `Up to ${feature.limit[plan.tier]}`}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {plan.features.length > 8 && (
                    <p className="text-xs text-gray-500 pt-2">
                      +{plan.features.length - 8} more features
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Feature Comparison Table */}
      {showComparisonTable && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="max-w-6xl mx-auto"
        >
          <div className="text-center mb-8">
            <h3 className="text-2xl font-bold text-white mb-2">Feature Comparison</h3>
            <p className="text-gray-400">See what each plan includes</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <th className="text-left py-4 px-6 text-sm font-bold text-gray-300">
                    Feature
                  </th>
                  {PRICING_PLANS.map((plan) => (
                    <th
                      key={plan.tier}
                      className="text-center py-4 px-4 text-sm font-bold"
                      style={{ color: PLAN_COLORS[plan.tier].primary }}
                    >
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Group features by category */}
                {[
                  {
                    category: 'SOS & Alerts',
                    keys: ['basic_sos', 'voice_sos', 'email_alerts', 'sms_alerts', 'call_alerts'],
                  },
                  {
                    category: 'Tracking & Mapping',
                    keys: ['live_map', 'gps_tracking', 'geofencing'],
                  },
                  {
                    category: 'Analytics & Reports',
                    keys: ['basic_analytics', 'advanced_analytics', 'incident_reports'],
                  },
                  {
                    category: 'Security & Compliance',
                    keys: ['audit_trail', 'compliance_dashboard', 'data_residency'],
                  },
                  {
                    category: 'Integration & API',
                    keys: ['api_access', 'webhooks', 'sso_saml'],
                  },
                  {
                    category: 'Support',
                    keys: ['email_support', 'priority_support', 'dedicated_csm'],
                  },
                ].map((group) => (
                  <React.Fragment key={group.category}>
                    <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <td colSpan={4} className="py-3 px-6">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">
                          {group.category}
                        </p>
                      </td>
                    </tr>
                    {group.keys.map((key) => {
                      const feature = FEATURE_CATALOG[key];
                      if (!feature) return null;

                      return (
                        <tr
                          key={key}
                          style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                        >
                          <td className="py-4 px-6">
                            <div>
                              <p className="text-sm font-medium text-white">{feature.label}</p>
                              <p className="text-xs text-gray-500">{feature.description}</p>
                            </div>
                          </td>
                          {PRICING_PLANS.map((plan) => {
                            const included = plan.features.includes(key);
                            const colors = PLAN_COLORS[plan.tier];

                            return (
                              <td
                                key={`${plan.tier}-${key}`}
                                className="text-center py-4 px-4"
                              >
                                {included ? (
                                  <Check
                                    className="size-5 mx-auto"
                                    style={{ color: colors.primary }}
                                  />
                                ) : (
                                  <X className="size-5 mx-auto text-gray-700" />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* FAQ / CTA Footer */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="max-w-4xl mx-auto text-center mt-20"
      >
        <div
          className="rounded-2xl p-8 mb-8"
          style={{
            background: 'linear-gradient(135deg, rgba(0,200,224,0.08), rgba(123,94,255,0.08))',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          <h3 className="text-xl font-bold text-white mb-3">
            Need something custom?
          </h3>
          <p className="text-gray-400 mb-4">
            Enterprise customers can customize their plan to fit unique requirements.
          </p>
          <button
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-bold text-white transition-all"
            style={{
              background: 'linear-gradient(135deg, #00C8E0, #7B5EFF)',
              boxShadow: '0 4px 16px rgba(0,200,224,0.25)',
            }}
          >
            Contact Sales
            <ArrowRight className="size-4" />
          </button>
        </div>

        {/* Trust badges */}
        <div className="flex flex-wrap justify-center gap-6 text-sm text-gray-400">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-green-500" />
            <span>14-day free trial</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-green-500" />
            <span>Cancel anytime</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-green-500" />
            <span>No credit card required</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Standalone Price Display Component (Optional)
// ═══════════════════════════════════════════════════════════════

export interface PriceDisplayProps {
  tier: PlanTier;
  billingCycle: BillingCycle;
}

/**
 * PriceDisplay — Small component to show a plan's price
 */
export function PriceDisplay({ tier, billingCycle }: PriceDisplayProps) {
  const plan = PRICING_PLANS.find(p => p.tier === tier);
  if (!plan) return null;

  const price =
    billingCycle === 'monthly'
      ? plan.monthlyPrice
      : Math.round(plan.annualPrice / 12);

  const colors = PLAN_COLORS[tier];

  return (
    <div>
      <div className="flex items-baseline gap-1">
        <span
          className="text-4xl font-bold"
          style={{ color: colors.primary }}
        >
          ${formatPrice(price)}
        </span>
        <span className="text-gray-400">/{billingCycle === 'monthly' ? 'month' : 'year'}</span>
      </div>
    </div>
  );
}
