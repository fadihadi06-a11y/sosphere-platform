// ═══════════════════════════════════════════════════════════════
// R-19 Phase 4 (2026-05-15) — Stripe signature parsing + audit fixes
// ─────────────────────────────────────────────────────────────
// FINDINGS THIS PHASE FIXES
//
//   #13 MEDIUM — signature header parser used Object.fromEntries, which
//      silently drops duplicate keys. Stripe's documented key-rotation
//      pattern signs each payload with BOTH the old and new secret during
//      the rotation window: `t=...,v1=<old>,v1=<new>`. Pre-R-19 we kept
//      only the LAST v1 and rejected legitimate events if the rotated
//      key signature came first. Now: collect ALL v1 candidates, accept
//      if any matches (Stripe's documented multi-key verification).
//
//   #9 MEDIUM — customer.subscription.deleted + invoice.payment_failed
//      audit rows used hardcoded actor_level="user". For B2B companies
//      where the subscription row has company_id (not user_id), the
//      audit log was mis-tagged. Auditor queries for "owner-initiated
//      cancellations" missed real B2B cancellations. Now: derive
//      actor_level from deletedRow.company_id (matches L227 pattern).
//
// CONTRACT (locked by this test)
//   - Signature parser collects ALL v1 values, not just the last one
//   - Verifies each v1 candidate, accepts on first match (constant-time)
//   - subscription.deleted audit uses owner-vs-user from row.company_id
//   - invoice.payment_failed audit uses the same pattern
//   - No remaining hardcoded p_actor_level:"user" in billing audits
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

describe("R-19 #13: signature parser supports Stripe key rotation (multi-v1)", () => {
  it("collects v1 values into an array, not a single string", () => {
    expect(webhookSrc).toMatch(/const\s+v1s:\s*string\[\]\s*=\s*\[\]/);
  });

  it("does NOT use Object.fromEntries on the signature header (the bug pattern)", () => {
    // Object.fromEntries silently keeps the LAST duplicate key — that's
    // the bug we're locking out.
    expect(webhookSrc).not.toMatch(/Object\.fromEntries\s*\(\s*sigHeader\.split/);
  });

  it("parses parts by indexOf('=') / slice, not split('=')", () => {
    // The new parser uses indexOf to find the first '=' so v1 values
    // containing '=' (base64 padding) parse correctly.
    expect(webhookSrc).toMatch(/const\s+eqIdx\s*=\s*part\.indexOf\(\s*["']=["']\s*\)/);
    expect(webhookSrc).toMatch(/part\.slice\(\s*0\s*,\s*eqIdx\s*\)/);
    expect(webhookSrc).toMatch(/part\.slice\(\s*eqIdx\s*\+\s*1\s*\)/);
  });

  it("iterates ALL v1 candidates and accepts on first match", () => {
    expect(webhookSrc).toMatch(/for\s*\(\s*const\s+v1\s+of\s+v1s\s*\)/);
    // Inside the loop, constant-time compare then return true on match
    expect(webhookSrc).toMatch(/for\s*\(\s*const\s+v1\s+of\s+v1s\s*\)\s*\{[\s\S]{0,400}return\s+true/);
  });

  it("rejects when no v1 candidates verify (return false)", () => {
    expect(webhookSrc).toMatch(/\}\s*\n\s*return false;\s*\n\s*\}\s*catch/);
  });

  it("requires t + at least one v1 (header validity)", () => {
    expect(webhookSrc).toMatch(/if\s*\(\s*!t\s*\|\|\s*v1s\.length\s*===\s*0\s*\)\s*return false/);
  });
});

describe("R-19 #9: audit actor_level derived from company_id, not hardcoded", () => {
  it("subscription.deleted audit reads deletedRow.company_id", () => {
    expect(webhookSrc).toMatch(
      /stripe_subscription_cancelled[\s\S]{0,800}p_actor_level:\s*deletedRow\.company_id\s*\?\s*["']owner["']\s*:\s*["']user["']/,
    );
  });

  it("invoice.payment_failed audit reads failRow.company_id", () => {
    expect(webhookSrc).toMatch(
      /stripe_payment_failed[\s\S]{0,400}p_actor_level:\s*failRow\.company_id\s*\?\s*["']owner["']\s*:\s*["']user["']/,
    );
  });

  it("zero remaining hardcoded p_actor_level: \"user\" in billing audits", () => {
    // Find every p_actor_level line in the file, ensure none is the literal
    // bug pattern. Each must be a conditional based on company_id presence.
    const lines = webhookSrc.split("\n").filter((l) => l.includes("p_actor_level:"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line, `line should NOT hardcode "user": ${line.trim()}`).not.toMatch(
        /p_actor_level:\s*["']user["']\s*,/,
      );
    }
  });

  it("subscription.deleted audit uses p_actor_user_id with null fallback (B2B-safe)", () => {
    expect(webhookSrc).toMatch(
      /stripe_subscription_cancelled[\s\S]{0,800}p_actor_user_id:\s*deletedRow\.user_id\s*\?\?\s*null/,
    );
  });

  it("invoice.payment_failed audit uses p_actor_user_id with null fallback (B2B-safe)", () => {
    expect(webhookSrc).toMatch(
      /stripe_payment_failed[\s\S]{0,200}p_actor_user_id:\s*failRow\.user_id\s*\?\?\s*null/,
    );
  });
});
