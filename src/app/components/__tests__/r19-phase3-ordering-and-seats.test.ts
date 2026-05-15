// ═══════════════════════════════════════════════════════════════
// R-19 Phase 3 (2026-05-15) — ordering guard + seat quantity tracking
// ─────────────────────────────────────────────────────────────
// FINDINGS THIS PHASE FIXES
//
//   #7 HIGH — customer.subscription.updated did not propagate seat changes.
//      Owner buys 10 seats → uses Billing Portal to bump to 50 → Stripe
//      charges for 50 but our row stays at the plan-derived 25-seat default.
//      Customer is silently shortchanged. Fix: mirror sub.items.data[0].quantity
//      into the new seat_quantity column, clamped to 1000 (parity with the
//      checkout-side cap so a portal abuser can't escalate past policy).
//
//   #8 HIGH — customer.subscription.created may arrive before
//      checkout.session.completed (Stripe ordering is at-least-once,
//      unordered). Pre-R-19, when the DB lookup + subscription metadata
//      both failed, the handler `break`ed with a warning and the
//      subscription row was never created — silent paid-customer drop
//      (same class as B-13 bug). Fix: fall back to fetching the Checkout
//      Session by subscription id (GET /checkout/sessions?subscription=...)
//      to recover client_reference_id (userId) + metadata.companyId.
//
//   #10 MEDIUM — out-of-order updates overwrote newer state.
//      Owner upgrades (event A) then immediately downgrades (event B).
//      If B arrives first then A, the upsert with no ordering guard let
//      A's stale state win. Fix: webhook reads existing
//      last_stripe_event_at, skips upsert if incoming event.created is
//      older.
//
// CONTRACT (locked by this test)
//   - Migration adds seat_quantity (int) + last_stripe_event_at (timestamptz)
//   - upsertSubscription accepts eventCreatedAt param + returns {applied, reason}
//   - Ordering guard: SELECT existing, compare, skip if stale
//   - Seat clamp: Math.min(1000, ...) parity with checkout cap
//   - Both columns written into the row payload
//   - All call sites pass event.created
//   - subscription.created/updated has checkout-session fallback
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
    path.resolve(
      process.cwd(),
      "supabase/migrations/20260515150000_r19p3_ordering_guard_and_seats.sql",
    ),
    "utf8",
  );
});

describe("R-19 Phase 3: migration adds the two columns", () => {
  it("adds seat_quantity int (nullable)", () => {
    expect(migrationSrc).toMatch(/ADD COLUMN IF NOT EXISTS\s+seat_quantity\s+int/);
  });

  it("adds last_stripe_event_at timestamptz (nullable)", () => {
    expect(migrationSrc).toMatch(/ADD COLUMN IF NOT EXISTS\s+last_stripe_event_at\s+timestamptz/);
  });
});

describe("R-19 #10: ordering guard in upsertSubscription", () => {
  it("upsertSubscription accepts an optional eventCreatedAt argument", () => {
    expect(webhookSrc).toMatch(/eventCreatedAt\?:\s*string/);
  });

  it("returns { applied, reason? } instead of void", () => {
    expect(webhookSrc).toMatch(/Promise<\{\s*applied:\s*boolean;\s*reason\?:\s*string\s*\}>/);
  });

  it("reads existing last_stripe_event_at before writing", () => {
    expect(webhookSrc).toMatch(
      /\.from\(\s*["']subscriptions["']\s*\)[\s\S]{0,200}\.select\(\s*["']last_stripe_event_at["']/,
    );
  });

  it("compares incoming event.created < existing last_stripe_event_at and skips on stale", () => {
    expect(webhookSrc).toMatch(/new Date\(eventCreatedAt\)\s*<\s*new Date\(existingAt\)/);
    expect(webhookSrc).toMatch(/return\s*\{\s*applied:\s*false,\s*reason:\s*["']stale_event["']/);
  });

  it("writes last_stripe_event_at into the row on accepted upserts", () => {
    expect(webhookSrc).toMatch(/last_stripe_event_at:\s*eventCreatedAt\s*\?\?\s*null/);
  });
});

describe("R-19 #7: seat quantity from Stripe subscription item", () => {
  it("reads sub.items.data[0].quantity from the Stripe payload", () => {
    expect(webhookSrc).toMatch(/items\?\.data\?\.\[0\]\?\.quantity/);
  });

  it("clamps quantity to <= 1000 (parity with checkout-side cap)", () => {
    expect(webhookSrc).toMatch(/Math\.min\(\s*1000\s*,\s*Math\.floor\(rawQuantity\)\s*\)/);
  });

  it("ignores zero / NaN / negative quantities (null instead)", () => {
    expect(webhookSrc).toMatch(/Number\.isFinite\(rawQuantity\)\s*&&\s*rawQuantity\s*>\s*0/);
  });

  it("writes seat_quantity into the row payload", () => {
    expect(webhookSrc).toMatch(/seat_quantity:\s*seatQuantity/);
  });
});

describe("R-19 #8: checkout-session fallback for early subscription.created", () => {
  it("fetches /checkout/sessions?subscription=<id> when DB+metadata both fail", () => {
    expect(webhookSrc).toMatch(/stripeGet\(\s*`\/checkout\/sessions\?subscription=\$\{sub\.id\}/);
  });

  it("recovers client_reference_id (userId) from the session", () => {
    expect(webhookSrc).toMatch(/session\?\.client_reference_id\s+as\s+string\s*\|\s*undefined/);
  });

  it("recovers metadata.companyId from the session", () => {
    expect(webhookSrc).toMatch(/session\?\.metadata\?\.companyId/);
  });

  it("upserts using the fallback target when found", () => {
    expect(webhookSrc).toMatch(/resolved via checkout fallback/);
    expect(webhookSrc).toMatch(/upsertSubscription\(\s*[\s\S]{0,200}fallbackTarget/);
  });

  it("still warns + breaks when ALL three lookup paths fail", () => {
    expect(webhookSrc).toMatch(/DB\+metadata\+checkout fallback all empty/);
  });
});

describe("R-19 Phase 3: all upsertSubscription call sites pass event.created", () => {
  it("checkout.session.completed call site passes event.created", () => {
    expect(webhookSrc).toMatch(
      /await upsertSubscription\(\s*[\s\S]{0,200}session\.metadata\?\.planId[\s\S]{0,200}new Date\(event\.created\s*\*\s*1000\)/,
    );
  });

  it("subscription.created/updated main call site passes event.created", () => {
    // After the cache fallback branch, the primary call also passes event.created
    const matches = webhookSrc.match(/event\.created\s*\?\s*new Date\(event\.created\s*\*\s*1000\)\.toISOString\(\)/g) ?? [];
    // 3 sites: checkout.session.completed + subscription.created/updated (fallback + main path)
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});
