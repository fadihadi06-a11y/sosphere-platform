// ═══════════════════════════════════════════════════════════════
// SOSphere — Scalable Pricing Engine Configuration
// Three tiers (Free, Pro, Enterprise) with feature-gating logic
// Ready for Stripe integration with placeholder price IDs
// ═══════════════════════════════════════════════════════════════

// ── Plan tier type definitions ──────────────────────────────────
export type PlanTier = 'free' | 'pro' | 'enterprise';

// ── Feature definition interface ────────────────────────────────
export interface PlanFeature {
  key: string;
  label: string;
  description: string;
  includedIn: PlanTier[];
  limit?: Record<PlanTier, number | 'unlimited'>;  // for usage-based features
  icon?: string;  // optional icon key for UI
}

// ── Pricing plan interface ──────────────────────────────────────
export interface PricingPlan {
  tier: PlanTier;
  name: string;
  tagline: string;
  monthlyPrice: number;      // USD cents (0 for free)
  annualPrice: number;       // USD cents per year (discount)
  stripePriceIdMonthly?: string;  // placeholder: 'price_xxx'
  stripePriceIdAnnual?: string;
  maxEmployees: number | 'unlimited';
  maxLocations: number | 'unlimited';
  features: string[];        // feature keys included
  highlighted?: boolean;     // for "Most Popular" badge
  ctaLabel: string;
  ctaVariant: 'primary' | 'secondary' | 'outline';
}

// ═══════════════════════════════════════════════════════════════
// Feature Catalog — 20+ features with clear gating
// ═══════════════════════════════════════════════════════════════

export const FEATURE_CATALOG: Record<string, PlanFeature> = {
  // ── SOS Triggers ────────────────────────────────────────────
  basic_sos: {
    key: 'basic_sos',
    label: 'Basic SOS Button',
    description: 'One-tap emergency alert trigger',
    includedIn: ['free', 'pro', 'enterprise'],
  },
  voice_sos: {
    key: 'voice_sos',
    label: 'Voice-Activated SOS',
    description: 'Hands-free emergency trigger via voice command',
    includedIn: ['pro', 'enterprise'],
  },
  shake_sos: {
    key: 'shake_sos',
    label: 'Shake-Activated SOS',
    description: 'Emergency trigger by shaking device',
    includedIn: ['pro', 'enterprise'],
  },

  // ── Alert Channels ─────────────────────────────────────────
  email_alerts: {
    key: 'email_alerts',
    label: 'Email Alerts',
    description: 'Receive alerts via email',
    includedIn: ['free', 'pro', 'enterprise'],
  },
  sms_alerts: {
    key: 'sms_alerts',
    label: 'SMS Text Alerts',
    description: 'Receive alerts via SMS/text messages',
    includedIn: ['pro', 'enterprise'],
  },
  call_alerts: {
    key: 'call_alerts',
    label: 'Call Alerts',
    description: 'Voice calls for critical emergencies',
    includedIn: ['pro', 'enterprise'],
  },
  push_notifications: {
    key: 'push_notifications',
    label: 'Push Notifications',
    description: 'Real-time push alerts on mobile devices',
    includedIn: ['pro', 'enterprise'],
  },

  // ── Location & Tracking ─────────────────────────────────────
  live_map: {
    key: 'live_map',
    label: 'Live Map View',
    description: 'Real-time map of employee locations',
    includedIn: ['pro', 'enterprise'],
  },
  gps_tracking: {
    key: 'gps_tracking',
    label: 'GPS Tracking',
    description: 'Continuous GPS location tracking',
    includedIn: ['pro', 'enterprise'],
  },
  geofencing: {
    key: 'geofencing',
    label: 'Geofencing',
    description: 'Set safe zones and receive alerts when entering/leaving',
    includedIn: ['pro', 'enterprise'],
    limit: {
      free: 0,
      pro: 10,
      enterprise: 'unlimited',
    },
  },

  // ── Analytics & Reporting ───────────────────────────────────
  basic_analytics: {
    key: 'basic_analytics',
    label: 'Basic Analytics',
    description: 'Simple SOS activity dashboard',
    includedIn: ['free', 'pro', 'enterprise'],
  },
  advanced_analytics: {
    key: 'advanced_analytics',
    label: 'Advanced Analytics',
    description: 'Detailed trends, patterns, and insights',
    includedIn: ['pro', 'enterprise'],
  },
  custom_reports: {
    key: 'custom_reports',
    label: 'Custom Reports',
    description: 'Generate custom PDF/Excel reports',
    includedIn: ['enterprise'],
  },

  // ── Incident Management ─────────────────────────────────────
  incident_reports: {
    key: 'incident_reports',
    label: 'Incident Reports',
    description: 'Detailed incident documentation and timeline',
    includedIn: ['pro', 'enterprise'],
  },
  evidence_pipeline: {
    key: 'evidence_pipeline',
    label: 'Evidence Pipeline',
    description: 'Collect and manage incident evidence (photos, audio, etc)',
    includedIn: ['pro', 'enterprise'],
  },

  // ── Compliance & Security ───────────────────────────────────
  compliance_dashboard: {
    key: 'compliance_dashboard',
    label: 'Compliance Dashboard',
    description: 'Regulatory compliance tracking and reporting',
    includedIn: ['enterprise'],
  },
  audit_trail: {
    key: 'audit_trail',
    label: 'Audit Trail',
    description: 'Complete audit log of all system actions',
    includedIn: ['pro', 'enterprise'],
  },
  data_residency: {
    key: 'data_residency',
    label: 'Data Residency Controls',
    description: 'Choose data storage location (GDPR, CCPA compliance)',
    includedIn: ['enterprise'],
  },

  // ── API & Integration ───────────────────────────────────────
  api_access: {
    key: 'api_access',
    label: 'REST API Access',
    description: 'Full API for custom integrations',
    includedIn: ['enterprise'],
  },
  webhooks: {
    key: 'webhooks',
    label: 'Webhooks',
    description: 'Real-time event webhooks for external systems',
    includedIn: ['enterprise'],
  },
  custom_integrations: {
    key: 'custom_integrations',
    label: 'Custom Integrations',
    description: 'White-glove integration support',
    includedIn: ['enterprise'],
  },

  // ── Authentication & Branding ───────────────────────────────
  sso_saml: {
    key: 'sso_saml',
    label: 'SSO / SAML 2.0',
    description: 'Single Sign-On and enterprise authentication',
    includedIn: ['enterprise'],
  },
  custom_branding: {
    key: 'custom_branding',
    label: 'Custom Branding',
    description: 'White-label with company logo and colors',
    includedIn: ['enterprise'],
  },

  // ── Team Features ───────────────────────────────────────────
  buddy_system: {
    key: 'buddy_system',
    label: 'Buddy System',
    description: 'Pair employees for mutual check-ins',
    includedIn: ['pro', 'enterprise'],
  },
  evacuation_plans: {
    key: 'evacuation_plans',
    label: 'Evacuation Plans',
    description: 'Create and manage emergency evacuation procedures',
    includedIn: ['pro', 'enterprise'],
  },

  // ── Data & History ──────────────────────────────────────────
  data_history_7d: {
    key: 'data_history_7d',
    label: '7-Day History',
    description: 'Keep incident history for 7 days',
    includedIn: ['free'],
  },
  data_history_90d: {
    key: 'data_history_90d',
    label: '90-Day History',
    description: 'Keep incident history for 90 days',
    includedIn: ['pro', 'enterprise'],
  },

  // ── Support ─────────────────────────────────────────────────
  community_support: {
    key: 'community_support',
    label: 'Community Support',
    description: 'Help via community forums',
    includedIn: ['free'],
  },
  email_support: {
    key: 'email_support',
    label: 'Email Support',
    description: 'Email support with 24-hour response time',
    includedIn: ['pro', 'enterprise'],
  },
  priority_support: {
    key: 'priority_support',
    label: 'Priority Support',
    description: '24/7 priority email and phone support',
    includedIn: ['pro', 'enterprise'],
  },
  dedicated_csm: {
    key: 'dedicated_csm',
    label: 'Dedicated Account Manager',
    description: 'Dedicated Customer Success Manager',
    includedIn: ['enterprise'],
  },
};

// ═══════════════════════════════════════════════════════════════
// Pricing Plans — Three-Tier Structure
// ═══════════════════════════════════════════════════════════════

export const PRICING_PLANS: PricingPlan[] = [
  {
    tier: 'free',
    name: 'Free',
    tagline: 'Perfect for getting started',
    monthlyPrice: 0,      // $0/month
    annualPrice: 0,       // $0/year
    maxEmployees: 10,
    maxLocations: 1,
    features: [
      'basic_sos',
      'email_alerts',
      'basic_analytics',
      'data_history_7d',
      'community_support',
    ],
    ctaLabel: 'Get Started Free',
    ctaVariant: 'outline',
  },
  {
    tier: 'pro',
    name: 'Pro',
    tagline: 'For growing teams',
    monthlyPrice: 2900,   // $29/month in cents
    annualPrice: 29000,   // $290/year in cents (17% discount)
    stripePriceIdMonthly: 'price_pro_monthly',
    stripePriceIdAnnual: 'price_pro_annual',
    maxEmployees: 100,
    maxLocations: 5,
    features: [
      'basic_sos',
      'voice_sos',
      'shake_sos',
      'email_alerts',
      'sms_alerts',
      'call_alerts',
      'push_notifications',
      'live_map',
      'gps_tracking',
      'geofencing',
      'basic_analytics',
      'advanced_analytics',
      'incident_reports',
      'evidence_pipeline',
      'audit_trail',
      'buddy_system',
      'evacuation_plans',
      'data_history_90d',
      'email_support',
      'priority_support',
    ],
    highlighted: true,
    ctaLabel: 'Start Free Trial',
    ctaVariant: 'primary',
  },
  {
    tier: 'enterprise',
    name: 'Enterprise',
    tagline: 'For large organizations',
    monthlyPrice: 9900,   // $99/month in cents
    annualPrice: 99000,   // $990/year in cents (17% discount)
    stripePriceIdMonthly: 'price_enterprise_monthly',
    stripePriceIdAnnual: 'price_enterprise_annual',
    maxEmployees: 'unlimited',
    maxLocations: 'unlimited',
    features: [
      'basic_sos',
      'voice_sos',
      'shake_sos',
      'email_alerts',
      'sms_alerts',
      'call_alerts',
      'push_notifications',
      'live_map',
      'gps_tracking',
      'geofencing',
      'basic_analytics',
      'advanced_analytics',
      'custom_reports',
      'incident_reports',
      'evidence_pipeline',
      'compliance_dashboard',
      'audit_trail',
      'data_residency',
      'api_access',
      'webhooks',
      'custom_integrations',
      'sso_saml',
      'custom_branding',
      'buddy_system',
      'evacuation_plans',
      'data_history_90d',
      'email_support',
      'priority_support',
      'dedicated_csm',
    ],
    ctaLabel: 'Contact Sales',
    ctaVariant: 'secondary',
  },
];

// ═══════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Get a plan by tier
 */
export function getPlanByTier(tier: PlanTier): PricingPlan {
  const plan = PRICING_PLANS.find(p => p.tier === tier);
  if (!plan) throw new Error(`Plan tier "${tier}" not found`);
  return plan;
}

/**
 * Check if a user with a given plan has access to a feature
 */
export function hasFeature(tier: PlanTier, featureKey: string): boolean {
  const plan = getPlanByTier(tier);
  return plan.features.includes(featureKey);
}

/**
 * Get the minimum plan tier required for a feature
 */
export function getMinimumTierForFeature(featureKey: string): PlanTier | null {
  const feature = FEATURE_CATALOG[featureKey];
  if (!feature) return null;

  // Return the tier with lowest cost that includes this feature
  const includedTiers = feature.includedIn;
  if (includedTiers.includes('free')) return 'free';
  if (includedTiers.includes('pro')) return 'pro';
  if (includedTiers.includes('enterprise')) return 'enterprise';

  return null;
}

/**
 * Get the usage limit for a metered feature
 */
export function getFeatureLimit(
  tier: PlanTier,
  featureKey: string,
): number | 'unlimited' | null {
  const feature = FEATURE_CATALOG[featureKey];
  if (!feature || !feature.limit) return null;

  return feature.limit[tier] ?? null;
}

/**
 * Check if current usage is at limit for a metered feature
 */
export function isAtLimit(
  tier: PlanTier,
  featureKey: string,
  currentUsage: number,
): boolean {
  const limit = getFeatureLimit(tier, featureKey);
  if (limit === null || limit === 'unlimited') return false;
  return currentUsage >= limit;
}

/**
 * Get the required plan to upgrade to for a feature (if current tier doesn't have it)
 */
export function getUpgradePath(
  currentTier: PlanTier,
  featureKey: string,
): PlanTier | null {
  if (hasFeature(currentTier, featureKey)) return null;

  const minimumTier = getMinimumTierForFeature(featureKey);
  if (!minimumTier) return null;

  // Ensure we suggest an upgrade, not a downgrade
  const tierOrder: PlanTier[] = ['free', 'pro', 'enterprise'];
  const currentIndex = tierOrder.indexOf(currentTier);
  const minimumIndex = tierOrder.indexOf(minimumTier);

  if (minimumIndex > currentIndex) {
    return minimumTier;
  }

  return null;
}

/**
 * Calculate annual savings for a plan
 */
export function calculateAnnualSavings(tier: PlanTier): number {
  const plan = getPlanByTier(tier);
  if (plan.monthlyPrice === 0) return 0;
  const monthlyTotal = plan.monthlyPrice * 12;
  return monthlyTotal - plan.annualPrice;
}

/**
 * Format price for display (cents to dollars)
 */
export function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Get all features available in a plan with metadata
 */
export function getPlanFeatures(tier: PlanTier): PlanFeature[] {
  const plan = getPlanByTier(tier);
  return plan.features
    .map(key => FEATURE_CATALOG[key])
    .filter((f): f is PlanFeature => f !== undefined);
}

/**
 * Debug helper: log all feature gates (use sparingly in dev)
 */
export function logFeatureGate(
  tier: PlanTier,
  featureKey: string,
  allowed: boolean,
): void {
  if (import.meta.env.DEV) {
    console.log(`[FeatureGate] tier="${tier}" feature="${featureKey}" allowed=${allowed}`);
  }
}
