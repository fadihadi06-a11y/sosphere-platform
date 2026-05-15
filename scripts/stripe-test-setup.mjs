#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — Stripe test-mode setup (R-19 follow-up)
// ─────────────────────────────────────────────────────────────────────────
// WHAT
//   Creates all 13 SOSphere products + prices in Stripe via API in one shot:
//     - 6 B2B: Starter/Growth/Business × Monthly/Annual
//     - 2 B2C: Personal Monthly + Annual
//     - 5 Add-ons: Extra Reports / SMS / Zones / GPS / Branding
//
//   Prints a `npx supabase secrets set ...` command at the end with all
//   the price IDs. Run that to wire the prices into our lookupPlanByPriceEnv
//   function in stripe-webhook.
//
// USAGE (Stripe test mode)
//   $env:STRIPE_SECRET_KEY = "sk_test_..."         # paste your test key
//   node scripts/stripe-test-setup.mjs
//
// IDEMPOTENCY
//   This script will REUSE products it finds by metadata.plan_id.
//   Re-running is safe — it doesn't create duplicates. Prices are created
//   fresh each run (Stripe doesn't allow editing prices) so a re-run
//   produces NEW price IDs; the old prices remain "Archive me" candidates
//   in Stripe Dashboard.
// ═══════════════════════════════════════════════════════════════════════════

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY) {
  console.error("ERROR: STRIPE_SECRET_KEY env var not set.");
  console.error("");
  console.error("PowerShell:");
  console.error("  $env:STRIPE_SECRET_KEY = Read-Host \"Paste sk_test_... key\"");
  console.error("  node scripts/stripe-test-setup.mjs");
  process.exit(2);
}
if (!STRIPE_KEY.startsWith("sk_test_")) {
  console.error(`ERROR: STRIPE_SECRET_KEY must start with sk_test_ (got: ${STRIPE_KEY.slice(0,8)}...)`);
  console.error("This script is TEST-MODE ONLY. Use a sk_test_ key, not sk_live_.");
  process.exit(2);
}

const STRIPE_API = "https://api.stripe.com/v1";

// ── Product catalog (from src/app/constants/pricing.ts) ────────────────────
// All amounts in cents (Stripe convention).
const B2B_PRODUCTS = [
  { plan: "starter",  name: "SOSphere Starter",  description: "For small teams 5–25 employees",   monthly: 14900,  annual: 142800 },
  { plan: "growth",   name: "SOSphere Growth",   description: "For growing teams 26–100 employees", monthly: 34900,  annual: 334800 },
  { plan: "business", name: "SOSphere Business", description: "For large teams 101–500 employees",  monthly: 79900,  annual: 766800 },
];
const B2C_PRODUCTS = [
  { plan: "personal", name: "SOSphere Personal", description: "Unlimited SOS + Family Circle",    monthly: 499,    annual: 3999 },
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
    throw new Error(`Stripe ${path} → ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.json();
}

async function stripeGet(path) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_KEY}` },
  });
  if (!res.ok) throw new Error(`Stripe GET ${path} → ${res.status}`);
  return res.json();
}

// Idempotency: look up existing product by metadata.plan_id
async function findOrCreateProduct(planId, name, description) {
  // List products and filter by metadata. Stripe doesn't expose metadata
  // filter on the list API directly, so we list+filter client-side.
  const list = await stripeGet(`/products?limit=100&active=true`);
  const existing = (list.data || []).find((p) => p.metadata?.plan_id === planId);
  if (existing) {
    console.log(`  ✓ reusing existing product: ${planId} (${existing.id})`);
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
  console.log(`    + price ${cycle}: $${(unitAmount/100).toFixed(2)} → ${price.id}`);
  return price.id;
}

async function setupAll() {
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log("SOSphere — Stripe Test Mode Setup");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log(`Stripe key: ${STRIPE_KEY.slice(0, 12)}...`);
  console.log("");

  const priceEnvVars = {};

  console.log("── B2B Plans ─────────────────────────────────────────────────────────");
  for (const p of B2B_PRODUCTS) {
    console.log(`\n${p.name}:`);
    const product = await findOrCreateProduct(p.plan, p.name, p.description);
    const mId = await createPrice(product.id, p.plan, "monthly", p.monthly);
    const aId = await createPrice(product.id, p.plan, "annual", p.annual);
    priceEnvVars[`STRIPE_PRICE_${p.plan.toUpperCase()}_MONTHLY`] = mId;
    priceEnvVars[`STRIPE_PRICE_${p.plan.toUpperCase()}_ANNUAL`] = aId;
  }

  console.log("\n── B2C Plans ─────────────────────────────────────────────────────────");
  for (const p of B2C_PRODUCTS) {
    console.log(`\n${p.name}:`);
    const product = await findOrCreateProduct(p.plan, p.name, p.description);
    const mId = await createPrice(product.id, p.plan, "monthly", p.monthly);
    const aId = await createPrice(product.id, p.plan, "annual", p.annual);
    priceEnvVars[`STRIPE_PRICE_${p.plan.toUpperCase()}_MONTHLY`] = mId;
    priceEnvVars[`STRIPE_PRICE_${p.plan.toUpperCase()}_ANNUAL`] = aId;
  }

  console.log("\n── Add-ons (monthly only) ────────────────────────────────────────────");
  for (const a of ADDON_PRODUCTS) {
    console.log(`\n${a.name}:`);
    const product = await findOrCreateProduct(a.plan, a.name, a.description);
    const mId = await createPrice(product.id, a.plan, "monthly", a.monthly);
    priceEnvVars[`STRIPE_PRICE_${a.plan.toUpperCase()}_MONTHLY`] = mId;
  }

  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log("DONE — paste this command to wire prices into Supabase:");
  console.log("══════════════════════════════════════════════════════════════════════");
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
  console.log(`(also saved to ${outPath} — gitignored by default)`);
}

setupAll().catch((e) => {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
});
