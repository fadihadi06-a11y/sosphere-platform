// ═══════════════════════════════════════════════════════════════
// SOSphere — delete-account Stripe-cancel contract test (CRIT-#11)
// ─────────────────────────────────────────────────────────────
// Edge functions run in Deno and cannot be imported into Node/vitest.
// This suite reads the edge function source code and pins the safety
// guarantees that GDPR Art. 17 + chargeback-prevention require:
//
//   1. Stripe DELETE call on /v1/subscriptions/{id} BEFORE the DB cascade.
//   2. Idempotency-Key header so retries cannot double-cancel.
//   3. Free-tier users (no stripe_subscription_id) skip Stripe gracefully.
//   4. Stripe 404 ("already canceled") treated as success.
//   5. Stripe 5xx / 429 / network error → 503, NOT 500 (signals retryable).
//   6. STRIPE_SECRET_KEY missing → 503 + clear error (no silent orphan).
//   7. Audit log entry written via log_sos_audit RPC.
//   8. Cascade RPC + storage cleanup + auth.deleteUser still run AFTER cancel.
//
// Without these pins, a future "simplification" of delete-account could
// re-orphan paying subscriptions (the original bug we fixed today).
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let src = "";

beforeAll(() => {
  const p = path.resolve(process.cwd(), "supabase", "functions", "delete-account", "index.ts");
  src = fs.readFileSync(p, "utf8");
});

describe("CRIT-#11 — delete-account Stripe cancellation contract", () => {
  it("CRIT-#11 marker is present (auditable)", () => {
    expect(src).toContain("CRIT-#11");
  });

  it("calls Stripe DELETE /v1/subscriptions/{id}", () => {
    expect(src).toMatch(/api\.stripe\.com\/v1\/subscriptions/);
    expect(src).toMatch(/method:\s*"DELETE"/);
  });

  it("uses Idempotency-Key on the Stripe call (prevents double-cancel on retry)", () => {
    expect(src).toMatch(/"Idempotency-Key":\s*`del-acct-\$\{userId\}-\$\{stripeSubId\}`/);
  });

  it("looks up subscription via subscriptions.stripe_subscription_id", () => {
    expect(src).toMatch(/from\("subscriptions"\)[\s\S]{0,200}?\.select\("stripe_subscription_id/);
    expect(src).toMatch(/\.eq\("user_id",\s*userId\)/);
  });

  it("free-tier path (stripe_subscription_id is null) skips Stripe gracefully", () => {
    // The if (stripeSubId) gate is what makes this safe for free users.
    expect(src).toMatch(/if\s*\(\s*stripeSubId\s*\)/);
    // And the else branch logs an explicit "free tier" message.
    expect(src).toMatch(/free tier, skipping Stripe/);
  });

  it("Stripe 404 (already cancelled or missing) is treated as success", () => {
    expect(src).toMatch(/stripeRes\.status\s*===\s*404/);
    expect(src).toMatch(/already gone \(404\)/);
  });

  it("Stripe 5xx / 429 / network error returns 503 with retryable flag", () => {
    // The error response after a non-OK Stripe response.
    expect(src).toMatch(/error:\s*"stripe_cancel_failed"/);
    expect(src).toMatch(/status:\s*503/);
    expect(src).toMatch(/retryable:\s*stripeRes\.status\s*>=\s*500\s*\|\|\s*stripeRes\.status\s*===\s*429/);
    // Network error path also returns 503 with retryable: true.
    expect(src).toMatch(/error:\s*"stripe_network_error"/);
    expect(src).toMatch(/retryable:\s*true/);
  });

  it("STRIPE_SECRET_KEY missing → 503 with explicit message (not silent orphan)", () => {
    expect(src).toMatch(/STRIPE_SECRET_KEY/);
    expect(src).toMatch(/error:\s*"stripe_not_configured"/);
    // Must be 503, not 500 — operator can fix without code change.
    const ctx = src.slice(src.indexOf("stripe_not_configured"));
    expect(ctx).toMatch(/status:\s*503/);
  });

  it("writes an audit_log entry on successful cancellation", () => {
    expect(src).toMatch(/log_sos_audit/);
    expect(src).toMatch(/p_action:\s*"stripe_subscription_cancelled_on_account_delete"/);
    expect(src).toMatch(/source:\s*"delete-account\/CRIT-#11"/);
  });

  it("Stripe cancel runs BEFORE the delete_user_completely RPC (irreversible cascade)", () => {
    const stripeCallIdx = src.search(/api\.stripe\.com\/v1\/subscriptions/);
    const rpcIdx        = src.search(/admin\.rpc\([\s\S]{0,30}?"delete_user_completely"/);
    expect(stripeCallIdx, "Stripe call must exist").toBeGreaterThan(0);
    expect(rpcIdx,        "RPC call must exist").toBeGreaterThan(0);
    expect(stripeCallIdx, "Stripe call MUST come before RPC delete").toBeLessThan(rpcIdx);
  });

  it("original cascade (RPC + storage cleanup + auth.deleteUser) is preserved", () => {
    // Don't accidentally regress the rest of the function.
    expect(src).toMatch(/admin\.rpc\([\s\S]{0,30}?"delete_user_completely"/);
    expect(src).toMatch(/admin\.storage\.from\("evidence"\)\.remove/);
    expect(src).toMatch(/admin\.auth\.admin\.deleteUser\(userId\)/);
  });

  it("success response includes stripe_subscription_cancelled flag (operator visibility)", () => {
    expect(src).toMatch(/stripe_subscription_cancelled:\s*stripeSubId\s*\?\s*true\s*:\s*false/);
  });
});
