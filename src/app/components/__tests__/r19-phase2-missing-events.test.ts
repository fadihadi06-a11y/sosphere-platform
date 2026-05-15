// ═══════════════════════════════════════════════════════════════
// R-19 Phase 2 (2026-05-15) — Missing Stripe webhook event handlers
// ─────────────────────────────────────────────────────────────
// FINDINGS THIS PHASE FIXES
//
//   #3 HIGH — charge.dispute.created / .funds_withdrawn unhandled.
//      Customer disputed → bank reversed the charge → Stripe withdrew
//      funds. Our DB kept status=active. The user retained Elite features
//      until the next renewal ~30 days later. Real money burn (Twilio
//      voice calls, SMS, push) during dunning, every single time. Fix:
//      cancel subscription on dispute.
//
//   #4 HIGH — invoice.payment_action_required unhandled.
//      EU customers' monthly renewal triggers 3DS (PSD2 SCA). Stripe
//      fires this event with a hosted_invoice_url for the customer to
//      complete authentication. Pre-R-19, we ignored it. 7 days later
//      the renewal fails silently and the customer drops to free tier
//      without ever knowing. Fix: store the hosted_invoice_url so the
//      UI can surface a banner.
//
//   #4.1 — invoice.payment_succeeded clears requires_action_url so
//      the UI banner disappears after the customer completes 3DS.
//
//   #5 MEDIUM — customer.subscription.trial_will_end unhandled.
//      Stripe fires this 3 days before a trial ends. Without handling,
//      the user is never warned mid-app that their card will be charged
//      in 3 days, increasing involuntary churn / chargeback risk. Fix:
//      mark trial_ending_notified_at so the app shows a "trial ends in
//      3 days" banner.
//
//   #6 MEDIUM — customer.deleted unhandled.
//      Operator deletes a customer in Stripe Dashboard (cleanup, GDPR
//      erasure). subscriptions row keeps stripe_customer_id pointing
//      at the dead customer. Next /stripe-portal call → 502 against
//      "No such customer". Fix: null the IDs, cancel the subscription.
//
// CONTRACT (locked by this test)
//   - All 5 new case labels exist in the switch
//   - Each uses DbHandlerError (atomic with dedup row from Phase 1)
//   - Dispute path resolves charge → invoice → subscription correctly
//   - Action-required path stores hosted_invoice_url
//   - Payment-succeeded clears requires_action_url
//   - Trial-will-end stamps trial_ending_notified_at
//   - Customer-deleted nullifies stripe_customer_id + stripe_subscription_id
//   - New columns exist in the latest migration
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let webhookSrc = "";
let migrationSrc = "";

beforeAll(() => {
  webhookSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/stripe-webhook/index.ts"),
    "utf8",
  );
  migrationSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260515140000_r19_subscription_event_columns.sql"),
    "utf8",
  );
});

describe("R-19 Phase 2: migration adds requires_action_url + trial_ending_notified_at", () => {
  it("ALTERs subscriptions to add requires_action_url (text, nullable)", () => {
    expect(migrationSrc).toMatch(/ADD COLUMN IF NOT EXISTS\s+requires_action_url\s+text/);
  });

  it("ALTERs subscriptions to add trial_ending_notified_at (timestamptz, nullable)", () => {
    expect(migrationSrc).toMatch(/ADD COLUMN IF NOT EXISTS\s+trial_ending_notified_at\s+timestamptz/);
  });

  it("creates a partial index on rows with requires_action_url IS NOT NULL", () => {
    expect(migrationSrc).toMatch(/CREATE INDEX[\s\S]{0,200}requires_action_url IS NOT NULL/);
  });
});

describe("R-19 #3: dispute handler cancels subscription", () => {
  it("handles both charge.dispute.created and charge.dispute.funds_withdrawn", () => {
    expect(webhookSrc).toMatch(/case\s+["']charge\.dispute\.created["']/);
    expect(webhookSrc).toMatch(/case\s+["']charge\.dispute\.funds_withdrawn["']/);
  });

  it("resolves dispute → charge → invoice → subscription chain", () => {
    // Disputes reference a charge, not a subscription directly.
    expect(webhookSrc).toMatch(/stripeGet\(`\/charges\/\$\{dispute\.charge\}`\)/);
    expect(webhookSrc).toMatch(/stripeGet\(`\/invoices\/\$\{charge\.invoice\}`\)/);
  });

  it("flips status to canceled IMMEDIATELY (not cancel_at_period_end)", () => {
    expect(webhookSrc).toMatch(/status:\s*["']canceled["'],[\s\S]{0,80}cancel_at_period_end:\s*false/);
  });

  it("uses DbHandlerError so dedup rolls back on update failure", () => {
    expect(webhookSrc).toMatch(/throw new DbHandlerError\("dispute_cancel_failed"/);
  });

  it("logs stripe_subscription_disputed audit row", () => {
    expect(webhookSrc).toMatch(/p_action:\s*["']stripe_subscription_disputed["']/);
  });
});

describe("R-19 #4: payment_action_required surfaces hosted_invoice_url", () => {
  it("case label exists", () => {
    expect(webhookSrc).toMatch(/case\s+["']invoice\.payment_action_required["']/);
  });

  it("stores inv.hosted_invoice_url in requires_action_url column", () => {
    expect(webhookSrc).toMatch(/requires_action_url:\s*inv\.hosted_invoice_url\s*\?\?\s*null/);
  });

  it("uses DbHandlerError on update failure", () => {
    expect(webhookSrc).toMatch(/throw new DbHandlerError\("payment_action_required_update_failed"/);
  });
});

describe("R-19 #4.1: payment_succeeded clears requires_action_url", () => {
  it("case label exists", () => {
    expect(webhookSrc).toMatch(/case\s+["']invoice\.payment_succeeded["']/);
  });

  it("nullifies requires_action_url", () => {
    expect(webhookSrc).toMatch(/requires_action_url:\s*null/);
  });

  it("only touches rows that had a flag (.not is null filter)", () => {
    expect(webhookSrc).toMatch(/\.not\(\s*["']requires_action_url["']\s*,\s*["']is["']\s*,\s*null\s*\)/);
  });

  it("uses DbHandlerError on update failure", () => {
    expect(webhookSrc).toMatch(/throw new DbHandlerError\("payment_succeeded_clear_failed"/);
  });
});

describe("R-19 #5: trial_will_end stamps trial_ending_notified_at", () => {
  it("case label exists", () => {
    expect(webhookSrc).toMatch(/case\s+["']customer\.subscription\.trial_will_end["']/);
  });

  it("sets trial_ending_notified_at to now()-ish ISO timestamp", () => {
    expect(webhookSrc).toMatch(/trial_ending_notified_at:\s*new Date\(\)\.toISOString\(\)/);
  });

  it("uses DbHandlerError on update failure", () => {
    expect(webhookSrc).toMatch(/throw new DbHandlerError\("trial_will_end_update_failed"/);
  });
});

describe("R-19 #6: customer.deleted nullifies stripe IDs + cancels", () => {
  it("case label exists", () => {
    expect(webhookSrc).toMatch(/case\s+["']customer\.deleted["']/);
  });

  it("nullifies both stripe_customer_id and stripe_subscription_id", () => {
    // Otherwise the next portal call 502s against the dead customer.
    expect(webhookSrc).toMatch(/stripe_customer_id:\s*null/);
    expect(webhookSrc).toMatch(/stripe_subscription_id:\s*null/);
  });

  it("flips status to canceled", () => {
    expect(webhookSrc).toMatch(/case\s+["']customer\.deleted["'][\s\S]{0,500}status:\s*["']canceled["']/);
  });

  it("uses DbHandlerError on update failure", () => {
    expect(webhookSrc).toMatch(/throw new DbHandlerError\("customer_deleted_update_failed"/);
  });
});
