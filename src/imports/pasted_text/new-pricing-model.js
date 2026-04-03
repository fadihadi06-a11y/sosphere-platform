In dashboard-billing-page.tsx and subscription-plans.tsx,
completely replace the current pricing structure with this new model:

Remove the old per-seat pricing ($39/$59/$89 per user).

Add these new plans:

const UNIFIED_PLANS = [
  {
    id: "starter",
    name: "Starter",
    description: "For small teams 5–25 employees",
    monthlyPrice: 149,
    annualPrice: 1428,
    annualMonthly: 119,
    maxEmployees: 25,
    maxZones: 3,
    extraEmployeePrice: 8,
    features: [
      "SOS + GPS + Check-in",
      "Up to 25 employees",
      "Up to 3 zones",
      "Basic Reports",
      "Email Support",
      "14-day free trial"
    ],
    color: "blue"
  },
  {
    id: "growth", 
    name: "Growth",
    description: "For growing teams 26–100 employees",
    monthlyPrice: 349,
    annualPrice: 3348,
    annualMonthly: 279,
    maxEmployees: 100,
    maxZones: 10,
    extraEmployeePrice: 6,
    features: [
      "Everything in Starter",
      "Up to 100 employees",
      "Up to 10 zones",
      "Buddy System + Pre-Shift",
      "Advanced Analytics",
      "Audit Trail",
      "Priority Support"
    ],
    color: "purple"
  },
  {
    id: "business",
    name: "Business", 
    description: "For large teams 101–500 employees",
    monthlyPrice: 799,
    annualPrice: 7668,
    annualMonthly: 639,
    maxEmployees: 500,
    maxZones: -1,
    extraEmployeePrice: 4,
    features: [
      "Everything in Growth",
      "Up to 500 employees",
      "Unlimited zones",
      "AI Co-Admin",
      "Custom PDF Reports",
      "White-label options",
      "24/7 Priority Support"
    ],
    color: "amber"
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "For 500+ employees",
    monthlyPrice: -1,
    annualPrice: -1,
    annualMonthly: -1,
    maxEmployees: -1,
    maxZones: -1,
    extraEmployeePrice: 0,
    features: [
      "Unlimited everything",
      "White-label complete",
      "SLA 99.99% guaranteed",
      "Dedicated server option",
      "Custom integrations",
      "Dedicated Account Manager",
      "On-premise option"
    ],
    color: "green"
  }
]

const INDIVIDUAL_PLANS = [
  {
    id: "free",
    name: "Free",
    monthlyPrice: 0,
    annualPrice: 0,
    features: [
      "3 SOS triggers/month",
      "Basic GPS",
      "3 Emergency Contacts",
      "Limited Medical ID"
    ],
    limits: { sosPerMonth: 3, contacts: 3 }
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
      "Monthly Reports"
    ],
    limits: { sosPerMonth: -1, contacts: -1 }
  }
]

const ADDONS = [
  { id: "extra_zones", name: "Extra Zones Pack", description: "+5 zones", price: 29 },
  { id: "twilio_sms", name: "SMS Alerts (Twilio)", description: "1,000 SMS/month", price: 19 },
  { id: "advanced_gps", name: "Advanced GPS", description: "Update every 30 seconds", price: 39 },
  { id: "custom_branding", name: "Custom Branding", description: "Company logo in reports", price: 49 },
  { id: "extra_reports", name: "Extra PDF Reports", description: "+50 reports/month", price: 15 }
]

Show annual savings in dollars not percentage:
"Save $360/year" not "Save 20%"

Bill calculation:
totalMonthly = plan.monthlyPrice + (extraEmployees × plan.extraEmployeePrice) + addonsTotal

Add console.log("[SUPABASE_READY] plan_selected: " + JSON.stringify({planId, billingCycle, totalMonthly}))