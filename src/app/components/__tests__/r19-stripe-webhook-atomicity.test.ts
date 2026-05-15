// ═══════════════════════════════════════════════════════════════
// R-19 Phase 1 (2026-05-15) — Stripe webhook atomicity invariants
// ─────────────────────────────────────────────────────────────
// FINDINGS THIS PHASE FIXES
//
//   #1 HIGH — claimStripeEventOnce was fail-OPEN on non-23505 DB
//      errors. During a brief DB degradation, a captured webhook payload
//      could be replayed within the signature's 300s window — and we'd
//      process it twice. Now fail-CLOSED: dedup unavailable → 503 → Stripe
//      retries against a healthy worker.
//
//   #2 HIGHEST — three inline `return 500` paths in the handler switch
//      bypassed the catch block, leaving the dedup row in place after a
//      DB write failure. Stripe retried within seconds, hit the dedup
//      branch, and got 200 deduped:true — but our DB never reflected the
//      event. The customer's subscription drift was permanent until
//      manual intervention. Fix: typed DbHandlerError thrown from each
//      site so the catch block's existing rollback (delete processed
//      _stripe_events row, return 500) runs uniformly.
//
//   #11 MEDIUM — stripeGet didn't check res.ok. A transient Stripe 5xx
//      caused `sub.items.data[0].price.id` to be undefined, which
//      manifested as a bogus UnmappedPriceError → polluted
//      stripe_unmapped_events + burned 24-retry budget. Now: throw on
//      !res.ok so the catch returns 500 and Stripe retries normally.
//
// CONTRACT (locked by this test)
//   - claimStripeEventOnce returns {ok, isFirstSeen} (not bare boolean)
//   - DB-error branch returns ok:false (fail-CLOSED) not true (fail-OPEN)
//   - Serve handler 503s when claim.ok is false
//   - DbHandlerError class exists + is thrown from each DB-error site
//   - stripeGet throws on !res.ok
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let webhookSrc = "";

beforeAll(() => {
  webhookSrc = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/functions/stripe-webhook/index.ts"),
    "utf8",
  );
});

describe("R-19 #1: claimStripeEventOnce is FAIL-CLOSED", () => {
  it("returns a shaped object { ok, isFirstSeen }, NOT a bare boolean", () => {
    expect(webhookSrc).toMatch(
      /Promise<\{\s*ok:\s*boolean;\s*isFirstSeen:\s*boolean\s*\}>/,
    );
  });

  it("returns ok:false on DB error (fail-CLOSED, not fail-OPEN)", () => {
    // The regression we're guarding against: pre-R-19 the code returned
    // `true` on any non-23505 DB error. That's fail-OPEN. We now log and
    // return ok:false so the caller can 503.
    expect(webhookSrc).toMatch(/console\.error\([\s\S]{0,80}fail-CLOSED/);
    // Explicit ok:false on error path
    expect(webhookSrc).toMatch(/return\s*\{\s*ok:\s*false,\s*isFirstSeen:\s*false\s*\}/);
    // Regression guard: no `return true` in the error branches (the
    // pre-R-19 fail-OPEN pattern). The catch block + the non-23505 branch
    // must each return ok:false explicitly.
    const errorReturns = webhookSrc.match(/console\.error\([\s\S]{0,200}fail-CLOSED[\s\S]{0,200}?return\s+\{[^}]+\}/g) || [];
    for (const r of errorReturns) {
      expect(r).toMatch(/ok:\s*false/);
    }
  });

  it("returns ok:true + isFirstSeen:false on 23505 (duplicate event)", () => {
    expect(webhookSrc).toMatch(
      /code\s*===\s*["']23505["']\s*\)\s*return\s*\{\s*ok:\s*true,\s*isFirstSeen:\s*false\s*\}/,
    );
  });

  it("serve handler 503s when claim.ok is false (dedup unavailable)", () => {
    expect(webhookSrc).toMatch(/if\s*\(\s*!claim\.ok\s*\)/);
    expect(webhookSrc).toMatch(/dedup_unavailable/);
    expect(webhookSrc).toMatch(/status:\s*503/);
  });

  it("serve handler still deduplicates when isFirstSeen is false (200 deduped:true)", () => {
    expect(webhookSrc).toMatch(/if\s*\(\s*!claim\.isFirstSeen\s*\)/);
    expect(webhookSrc).toMatch(/deduped:\s*true/);
  });
});

describe("R-19 #2: DbHandlerError throws → catch rolls back dedup row", () => {
  it("DbHandlerError class exists with stage + cause fields", () => {
    expect(webhookSrc).toMatch(/class\s+DbHandlerError\s+extends\s+Error/);
    expect(webhookSrc).toMatch(/public readonly stage:/);
    expect(webhookSrc).toMatch(/public readonly cause/);
  });

  it("subscription.created/updated select error THROWS (not inline 500)", () => {
    // The regression we're locking out: previously this was
    //   return new Response(JSON.stringify({ error: "db_read_failed" }), { status: 500, ... })
    // which bypassed the catch block.
    expect(webhookSrc).toMatch(/throw new DbHandlerError\("subscription_select_failed"/);
    // Make sure the old inline-500 pattern is GONE for this case.
    expect(webhookSrc).not.toMatch(/error:\s*["']db_read_failed["']/);
  });

  it("subscription.deleted update error THROWS (not inline 500)", () => {
    expect(webhookSrc).toMatch(/throw new DbHandlerError\("subscription_delete_update_failed"/);
  });

  it("invoice.payment_failed update error THROWS (not inline 500)", () => {
    expect(webhookSrc).toMatch(/throw new DbHandlerError\("invoice_payment_failed_update_failed"/);
  });

  it("zero inline `db_update_failed` 500 returns remain (all converted to throws)", () => {
    expect(webhookSrc).not.toMatch(/error:\s*["']db_update_failed["']/);
  });

  it("catch block deletes processed_stripe_events row on rollback (already existed pre-R-19; regression guard)", () => {
    expect(webhookSrc).toMatch(
      /processed_stripe_events[\s\S]{0,80}\.delete\(\)[\s\S]{0,100}\.eq\(\s*["']event_id["']/,
    );
  });
});

describe("R-19 #11: stripeGet surfaces non-2xx as a real error", () => {
  it("stripeGet checks res.ok and throws on failure", () => {
    expect(webhookSrc).toMatch(/if\s*\(\s*!res\.ok\s*\)/);
    expect(webhookSrc).toMatch(/throw\s+new\s+Error\(`stripe_api_error:/);
  });

  it("throw message includes the HTTP status + path for forensics", () => {
    expect(webhookSrc).toMatch(/stripe_api_error:\s*\$\{res\.status\}\s*\$\{path\}/);
  });
});
