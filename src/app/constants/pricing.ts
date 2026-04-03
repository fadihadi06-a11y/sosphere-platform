// ═══════════════════════════════════════════════════════════════
// SOSphere — Unified Pricing Constants (New Flat-Rate Model)
// Single source of truth for ALL plan data across:
//   - company-register.tsx (Step 5)
//   - dashboard-pricing-page.tsx
//   - dashboard-billing-page.tsx
// [SUPABASE_READY] — All plan data marked for migration
// ═══════════════════════════════════════════════════════════════

export interface PlanDefinition {
  id: "starter" | "growth" | "business" | "enterprise";
  name: string;
  nameAr: string;
  description: string;
  color: string;
  maxEmployees: number;       // -1 = unlimited
  maxZones: number;           // -1 = unlimited
  monthlyPrice: number;       // flat company price (-1 = custom/contact sales)
  annualPrice: number;        // total per year (-1 = custom)
  annualMonthly: number;      // annualPrice / 12 pre-calculated (-1 = custom)
  extraEmployeePrice: number; // cost per extra employee above maxEmployees
  features: string[];
  popular?: boolean;
}

// SUPABASE_MIGRATION_POINT: UNIFIED_PLANS → supabase.from('plans').select('*').order('sort_order')
export const UNIFIED_PLANS: PlanDefinition[] = [
  {
    id: "starter",
    name: "Starter",
    nameAr: "ستارتر",
    description: "For small teams 5–25 employees",
    color: "#00C8E0",
    maxEmployees: 25,
    maxZones: 3,
    monthlyPrice: 149,
    annualPrice: 1428,
    annualMonthly: 119,
    extraEmployeePrice: 8,
    features: [
      "SOS + GPS + Check-in",
      "Up to 25 employees",
      "Up to 3 zones",
      "Basic Reports",
      "Email Support",
      "14-day free trial",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    nameAr: "قروث",
    description: "For growing teams 26–100 employees",
    color: "#7B5EFF",
    maxEmployees: 100,
    maxZones: 10,
    monthlyPrice: 349,
    annualPrice: 3348,
    annualMonthly: 279,
    extraEmployeePrice: 6,
    popular: true,
    features: [
      "Everything in Starter",
      "Up to 100 employees",
      "Up to 10 zones",
      "Buddy System + Pre-Shift",
      "Advanced Analytics",
      "Audit Trail",
      "Priority Support",
    ],
  },
  {
    id: "business",
    name: "Business",
    nameAr: "بزنس",
    description: "For large teams 101–500 employees",
    color: "#F59E0B",
    maxEmployees: 500,
    maxZones: -1,
    monthlyPrice: 799,
    annualPrice: 7668,
    annualMonthly: 639,
    extraEmployeePrice: 4,
    features: [
      "Everything in Growth",
      "Up to 500 employees",
      "Unlimited zones",
      "AI Co-Admin",
      "Custom PDF Reports",
      "White-label options",
      "24/7 Priority Support",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    nameAr: "إنتربرايز",
    description: "For 500+ employees",
    color: "#00C853",
    maxEmployees: -1,
    maxZones: -1,
    monthlyPrice: -1,
    annualPrice: -1,
    annualMonthly: -1,
    extraEmployeePrice: 0,
    features: [
      "Unlimited everything",
      "White-label complete",
      "SLA 99.99% guaranteed",
      "Dedicated server option",
      "Custom integrations",
      "Dedicated Account Manager",
      "On-premise option",
    ],
  },
];

// ── Individual Plans (B2C / Personal Safety) ─────────────────
export interface IndividualPlan {
  id: "free" | "personal";
  name: string;
  monthlyPrice: number;
  annualPrice: number;
  features: string[];
  limits: { sosPerMonth: number; contacts: number };
}

// SUPABASE_MIGRATION_POINT: INDIVIDUAL_PLANS → supabase.from('individual_plans').select('*')
export const INDIVIDUAL_PLANS: IndividualPlan[] = [
  {
    id: "free",
    name: "Free",
    monthlyPrice: 0,
    annualPrice: 0,
    features: [
      "3 SOS triggers/month",
      "Basic GPS",
      "3 Emergency Contacts",
      "Limited Medical ID",
    ],
    limits: { sosPerMonth: 3, contacts: 3 },
  },
  {
    id: "personal",
    name: "Personal",
    monthlyPrice: 4.99,
    annualPrice: 39.99,
    features: [
      "Unlimited SOS",
      "Advanced GPS + Safe Walk",
      "Full Medical ID",
      "Family Circle (5 people)",
      "Buddy System personal",
      "Fall Detection",
      "Monthly Reports",
    ],
    limits: { sosPerMonth: -1, contacts: -1 },
  },
];

// ── Add-ons ──────────────────────────────────────────────────
export interface Addon {
  id: string;
  name: string;
  description: string;
  price: number; // USD/month
}

// SUPABASE_MIGRATION_POINT: ADDONS → supabase.from('addons').select('*').order('price')
export const ADDONS: Addon[] = [
  { id: "extra_reports", name: "Extra PDF Reports", description: "+50 reports/month", price: 15 },
  { id: "twilio_sms", name: "SMS Alerts (Twilio)", description: "1,000 SMS/month", price: 19 },
  { id: "extra_zones", name: "Extra Zones Pack", description: "+5 zones", price: 29 },
  { id: "advanced_gps", name: "Advanced GPS", description: "Update every 30 seconds", price: 39 },
  { id: "custom_branding", name: "Custom Branding", description: "Company logo in reports", price: 49 },
];

// ── Helper: recommend plan by employee count ──────────────────
export function recommendPlan(employeeCount: number): PlanDefinition["id"] {
  if (employeeCount <= 25) return "starter";
  if (employeeCount <= 100) return "growth";
  if (employeeCount <= 500) return "business";
  return "enterprise";
}

// ── Helper: get plan by ID ───────────────────────────────────
export function getPlanById(id: string): PlanDefinition | undefined {
  return UNIFIED_PLANS.find(p => p.id === id);
}

// ── Bill Calculation ─────────────────────────────────────────
export function calculateMonthlyBill(
  plan: PlanDefinition,
  billingCycle: "monthly" | "annual",
  currentEmployees: number,
  activeAddonIds: string[] = [],
): { planCost: number; extraEmployeeCost: number; addonsCost: number; total: number } {
  const baseCost = billingCycle === "annual" ? plan.annualMonthly : plan.monthlyPrice;
  const planCost = baseCost > 0 ? baseCost : 0;
  const extraEmployees = plan.maxEmployees > 0 ? Math.max(0, currentEmployees - plan.maxEmployees) : 0;
  const extraEmployeeCost = extraEmployees * plan.extraEmployeePrice;
  const addonsCost = activeAddonIds.reduce((sum, id) => {
    const addon = ADDONS.find(a => a.id === id);
    return sum + (addon?.price ?? 0);
  }, 0);
  return {
    planCost,
    extraEmployeeCost,
    addonsCost,
    total: planCost + extraEmployeeCost + addonsCost,
  };
}

// ── Annual savings in dollars ────────────────────────────────
export function annualSavings(plan: PlanDefinition): number {
  if (plan.monthlyPrice <= 0 || plan.annualPrice <= 0) return 0;
  return Math.round(plan.monthlyPrice * 12 - plan.annualPrice);
}
