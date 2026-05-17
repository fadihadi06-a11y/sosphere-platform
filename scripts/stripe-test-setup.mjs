#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — Stripe test-mode setup (R-19 + R-29)
// Creates the products and prices in Stripe via API.
// Usage:  node scripts/stripe-test-setup.mjs sk_test_xxxxx
// or:     $env:STRIPE_SECRET_KEY = "sk_test_..."; node scripts/stripe-test-setup.mjs
// ═══════════════════════════════════════════════════════════════════════════

// R-25: accept the key as a positional CLI arg in addition to the env var.
const cliArg = process.argv[2];
const STRIPE_KEY = (cliArg && cliArg.startsWith("sk_test_"))
  ? cliArg
  : process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY) {
  console.error("ERROR: no Stripe test key provided.");
  console.error("");
  console.error("Easiest (single paste action):");
  console.error("  node scripts/stripe-test-setup.mjs sk_test_PASTE_KEY_HERE");
  console.error("");
  console.error("Or via env var:");
  console.error("  $env:STRIPE_SECRET_KEY = \"sk_test_...\"");
  console.error("  node scripts/stripe-test-setup.mjs");
  process.exit(2);
}
if (!STRIPE_KEY.startsWith("sk_test_")) {
  console.error(`ERROR: key must start with sk_test_ (got: ${STRIPE_KEY.slice(0,8)}...)`);
  console.error("This script is TEST-MODE ONLY. Use a sk_test_ key, not sk_live_.");
  process.exit(2);
}

const STRIPE_API = "https://api.stripe.com/v1";

const B2B_PRODUCTS = [
  { plan: "starter",  name: "SOSphere Starter",  description: "For small teams 5–25 employees",   monthly: 14900,  annual: 142800 },
  { plan: "growth",   name: "SOSphere Growth",   description: "For growing teams 26–100 employees", monthly: 34900,  annual: 334800 },
  { plan: "business", name: "SOSphere Business", description: "For large teams 101–500 employees",  monthly: 79900,  annual: 766800 },
];
// R-29 (2026-05-17): go-to-market is Free + Basic ($7) + Elite ($14).
// Annual is ~30% off list (SaaS B2C convention). Cents per Stripe convention.
const B2C_PRODUCTS = [
  { plan: "basic",    name: "SOSphere Basic", description: "Unlimited SOS + Advanced GPS + Fall Detection", monthly: 700,  annual: 5900  },
  { plan: "elite",    name: "SOSphere Elite", description: "Basic + Safe Walk + Voice-bridge + Forensic PDF", monthly: 1400, annual: 11900 },
];
const ADDON_PRODUCTS = [
  { plan: "addon_extra_reports",  name: "SOSphere Add-on: Extra PDF Reports", description: "+50 reports/month",       monthly: 1500 },
  { plan: "addon_twilio_sms",     name: "SOSphere Add-on: SMS Alerts",        description: "1,000 SMS/month",         monthly: 1900 },
  { plan: "addon_extra_zones",    name: "SOSphere Add-on: Extra Zones",       description: "+5 zones",                monthly: 2900 },
  { plan: "addon_advanced_gps",   name: "SOSphere Add-on: Advanced GPS",      description: "GPS update every 30 sec", monthly: 3900 },
  { plan: "addon_custom_branding",name: "SOSphere Add-on: Custom Branding",   description: "Company logo in reports", monthly: 4900 },
];

async function stripePost(path, params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.append(k, String(v));
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Stripe ${path} -> ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.json();
}

async function stripeGet(path) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_KEY}` },
  });
  if (!res.ok) throw new Error(`Stripe GET ${path} -> ${res.status}`);
  return res.json();
}

async function findOrCreateProduct(planId, name, description) {
  const list = await stripeGet(`/products?limit=100&active=true`);
  const existing = (list.data || []).find((p) => p.metadata?.plan_id === planId);
  if (existing) {
    console.log(`  - reusing existing product: ${planId} (${existing.id})`);
    return existing;
  }
  const product = await stripePost("/products", {
    name,
    description,
    "metadata[plan_id]": planId,
    "metadata[source]": "sosphere-test-setup",
  });
  console.log(`  + created product: ${planId} (${product.id})`);
  return product;
}

async function createPrice(productId, planId, cycle, unitAmount) {
  const interval = cycle === "monthly" ? "month" : "year";
  const price = await stripePost("/prices", {
    product: productId,
    unit_amount: unitAmount,
    currency: "usd",
    "recurring[interval]": interval,
    nickname: `${planId}-${cycle}`,
    "metadata[plan_id]": planId,
    "metadata[cycle]": cycle,
  });
  console.log(`    + price ${cycle}: $${(unitAmount/100).toFixed(2)} -> ${price.id}`);
  return price.id;
}

async function setupAll() {
  console.log("======================================================================");
  console.log("SOSphere - Stripe Test Mode Setup");
  console.log("======================================================================");
  console.log(`Stripe key: ${STRIPE_KEY.slice(0, 12)}...`);
  console.log("");

  const priceEnvVars = {};

  console.log("-- B2B Plans -----------------------------------------------------");
  for (const p of B2B_PRODUCTS) {
    console.log(`\n${p.name}:`);
    const product = await findOrCreateProduct(p.plan, p.name, p.description);
    const mId = await createPrice(product.id, p.plan, "monthly", p.monthly);
    const aId = await createPrice(product.id, p.plan, "annual", p.annual);
    priceEnvVars[`STRIPE_PRICE_${p.plan.toUpperCase()}_MONTHLY`] = mId;
    priceEnvVars[`STRIPE_PRICE_${p.plan.toUpperCase()}_ANNUAL`] = aId;
  }

  console.log("\n-- B2C Plans -----------------------------------------------------");
  for (const p of B2C_PRODUCTS) {
    console.log(`\n${p.name}:`);
    const product = await findOrCreateProduct(p.plan, p.name, p.description);
    const mId = await createPrice(product.id, p.plan, "monthly", p.monthly);
    const aId = await createPrice(product.id, p.plan, "annual", p.annual);
    priceEnvVars[`STRIPE_PRICE_${p.plan.toUpperCase()}_MONTHLY`] = mId;
    priceEnvVars[`STRIPE_PRICE_${p.plan.toUpperCase()}_ANNUAL`] = aId;
  }

  console.log("\n-- Add-ons (monthly only) ----------------------------------------");
  for (const a of ADDON_PRODUCTS) {
    console.log(`\n${a.name}:`);
    const product = await findOrCreateProduct(a.plan, a.name, a.description);
    const mId = await createPrice(product.id, a.plan, "monthly", a.monthly);
    priceEnvVars[`STRIPE_PRICE_${a.plan.toUpperCase()}_MONTHLY`] = mId;
  }

  console.log("\n======================================================================");
  console.log("DONE - paste this command to wire prices into Supabase:");
  console.log("======================================================================");
  console.log("");
  const pairs = Object.entries(priceEnvVars).map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(`npx supabase secrets set ${pairs} --project-ref rtfhkbskgrasamhjraul`);
  console.log("");
  console.log(`Total: ${Object.keys(priceEnvVars).length} price env vars`);

  // Also write to a local file for the operator's records (test mode only)
  const fs = await import("node:fs");
  const stamp = new Date().toISOString().replace(/:/g, "-").slice(0, 19);
  const outPath = `stripe-test-setup-${stamp}.txt`;
  fs.writeFileSync(outPath, Object.entries(priceEnvVars).map(([k,v]) => `${k}=${v}`).join("\n") + "\n");
  console.log(`(also saved to ${outPath} - gitignored by default)`);
}

setupAll().catch((e) => {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
});
