// ═══════════════════════════════════════════════════════════════════════════
// delete-account — GDPR Art. 17 account erasure endpoint
//   2026-04-24: rewritten to hit EVERY user-linked table + Supabase Storage.
//   G-20 (B-20, 2026-04-26): replaces wildcard CORS with origin allowlist.
//                            A malicious origin holding a stolen JWT (e.g. via
//                            XSS on a subdomain) can no longer call delete-
//                            account cross-origin.
//   G-30 (B-20, 2026-04-26): 500 response no longer includes raw err.message;
//                            schema names stay out of the public response.
//   CRIT-#11 (2026-04-28):   cancel Stripe subscription BEFORE the cascade so
//                            an erased account stops being charged. Block the
//                            deletion if Stripe rejects (idempotent retry-safe).
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkRateLimit,
  getRateLimitHeaders,
} from "../_shared/rate-limiter.ts";

const SUPA_URL          = Deno.env.get("SUPABASE_URL")!;
const SUPA_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPA_ANON         = Deno.env.get("SUPABASE_ANON_KEY")!;

// G-20 (B-20): origin allowlist — same pattern as twilio-call/stripe-checkout.
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://sosphere-platform.vercel.app")
  .split(",").map(s => s.trim()).filter(Boolean);
function getCorsOrigin(req: Request): string {
  const origin = req.headers.get("origin") || "";
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}
function buildCors(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getCorsOrigin(req),
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

Deno.serve(async (req) => {
  const CORS = buildCors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: CORS,
    });
  }

  const auth = req.headers.get("Authorization") || "";
  const jwt  = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) {
    return new Response(JSON.stringify({ error: "Missing bearer token" }), {
      status: 401, headers: CORS,
    });
  }

  const userClient = createClient(SUPA_URL, SUPA_ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401, headers: CORS,
    });
  }

  const userId = userData.user.id;
  const email  = userData.user.email ?? "(unknown)";

  // ── DD-9 (2026-04-27): rate-limit account deletion ──────────────
  // The endpoint validates JWT (above) but a stolen JWT could trigger
  // repeated cascades, flooding the RPC queue and locking legitimate
  // users out of their deletion experience during crisis moments.
  // We use the AUTH tier (10/min) — account deletion is irreversible
  // and a real user calls this exactly ONCE in their lifetime.
  // SOS calls bypass any user-tier rate limit (this isn't an SOS).
  const rl = checkRateLimit(userId, "auth", false);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({
        error: "Rate limit exceeded",
        retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000),
      }),
      {
        status: 429,
        headers: { ...CORS, ...getRateLimitHeaders(rl) },
      },
    );
  }

  const admin = createClient(SUPA_URL, SUPA_SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // CRIT-#11 (2026-04-28): cancel Stripe subscription BEFORE deleting DB
    // ─────────────────────────────────────────────────────────────────────
    // GDPR Art. 17 mandates erasure, but erasing user_id while leaving the
    // Stripe subscription active = user keeps getting charged with no way
    // to log in to manage it = chargebacks + GDPR fine. We must cancel
    // Stripe FIRST and FAIL the deletion if Stripe rejects (it is idempotent
    // by subscription_id, so the user can safely retry).
    //
    // Free-tier users have stripe_subscription_id = NULL → skip gracefully.
    // Stripe API errors (auth, network, rate-limit) → return 503, do NOT
    // proceed to DB delete. The user retries; Stripe re-reads the same
    // subscription_id and either cancels (200) or returns "already canceled"
    // (also 200). Either way: safe.
    // ═══════════════════════════════════════════════════════════════════════
    let stripeSubId: string | null = null;
    let stripeCustomerId: string | null = null;
    try {
      const { data: subRow, error: subLookupErr } = await admin
        .from("subscriptions")
        .select("stripe_subscription_id, stripe_customer_id, status")
        .eq("user_id", userId)
        .maybeSingle();
      if (subLookupErr) {
        console.error("[delete-account] subscription lookup failed:", subLookupErr);
        return new Response(JSON.stringify({
          error: "subscription_lookup_failed",
          stage: "stripe_pre_delete",
        }), { status: 500, headers: CORS });
      }
      stripeSubId      = (subRow as any)?.stripe_subscription_id ?? null;
      stripeCustomerId = (subRow as any)?.stripe_customer_id ?? null;
    } catch (e) {
      console.error("[delete-account] subscription lookup threw:", e);
      return new Response(JSON.stringify({
        error: "subscription_lookup_exception",
        stage: "stripe_pre_delete",
      }), { status: 500, headers: CORS });
    }

    // Only call Stripe if we actually have a subscription to cancel.
    if (stripeSubId) {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) {
        console.error("[delete-account] STRIPE_SECRET_KEY missing — refusing to proceed (would orphan subscription)");
        return new Response(JSON.stringify({
          error: "stripe_not_configured",
          stage: "stripe_pre_delete",
          note: "Server is missing Stripe credentials; cannot cancel your subscription. Contact support.",
        }), { status: 503, headers: CORS });
      }
      // Stripe DELETE on a subscription = immediate cancel (no proration).
      // Immediate cancel is correct for GDPR erasure: no further charges, ever.
      try {
        const stripeRes = await fetch(
          `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(stripeSubId)}`,
          {
            method: "DELETE",
            headers: {
              "Authorization": `Bearer ${stripeKey}`,
              "Content-Type": "application/x-www-form-urlencoded",
              // Idempotency-Key prevents accidental double-cancellations on retry.
              "Idempotency-Key": `del-acct-${userId}-${stripeSubId}`,
            },
          },
        );
        if (!stripeRes.ok) {
          const body = await stripeRes.text().catch(() => "(unreadable)");
          // 404 means already canceled or never existed — treat as success.
          if (stripeRes.status === 404) {
            console.warn(`[delete-account] Stripe sub ${stripeSubId} already gone (404), proceeding`);
          } else {
            console.error(`[delete-account] Stripe cancel ${stripeRes.status}:`, body.slice(0, 500));
            return new Response(JSON.stringify({
              error: "stripe_cancel_failed",
              stage: "stripe_pre_delete",
              stripe_status: stripeRes.status,
              retryable: stripeRes.status >= 500 || stripeRes.status === 429,
            }), { status: 503, headers: CORS });
          }
        } else {
          console.info(`[delete-account] Stripe sub ${stripeSubId} cancelled for user ${userId}`);
        }
      } catch (stripeErr) {
        console.error("[delete-account] Stripe network error:", stripeErr);
        return new Response(JSON.stringify({
          error: "stripe_network_error",
          stage: "stripe_pre_delete",
          retryable: true,
        }), { status: 503, headers: CORS });
      }

      // Best-effort audit trail (do not fail deletion if audit insert fails).
      try {
        await admin.rpc("log_sos_audit", {
          p_action: "stripe_subscription_cancelled_on_account_delete",
          p_actor: userId,
          p_actor_level: "self",
          p_operation: "account_deletion",
          p_target: stripeSubId,
          p_target_name: null,
          p_metadata: {
            stripe_customer_id: stripeCustomerId,
            email_hint: email.split("@")[0].slice(0, 3) + "***",
            source: "delete-account/CRIT-#11",
          },
        });
      } catch (auditErr) {
        console.warn("[delete-account] audit log entry failed (non-fatal):", auditErr);
      }
    } else {
      console.info(`[delete-account] no stripe_subscription_id for ${userId} — free tier, skipping Stripe cancel`);
    }

    // ── Audit #5 / B2 (2026-04-29): record account deletion BEFORE
    // it happens. The delete_user_completely RPC cascades and removes
    // FK references to the user; audit rows written AFTER would have
    // no actor to bind to, and the RPC itself does not write an audit
    // row. So we capture the forensic evidence now, while the user
    // identity is still intact.
    try {
      await admin.rpc("log_sos_audit", {
        p_action: "account_deleted",
        p_actor_user_id: userId,
        p_actor_level: "self",
        p_category: "account",
        p_operation: "DELETE",
        p_metadata: {
          email_hint: email.split("@")[0].slice(0, 3) + "***",
          had_stripe_subscription: !!stripeSubId,
          stripe_customer_id_hint: stripeCustomerId
            ? stripeCustomerId.slice(0, 8) + "***"
            : null,
          source: "delete-account/audit5-B2",
        },
      });
    } catch (auditErr) {
      // Non-blocking: deletion proceeds even if audit write fails.
      console.warn("[delete-account] account_deleted audit failed (non-fatal):", auditErr);
    }

    // ── Proceed with the original RPC cascade (unchanged) ──
    const { data: rpcResult, error: rpcErr } = await admin.rpc(
      "delete_user_completely", { p_user_id: userId }
    );
    if (rpcErr) {
      console.error("[delete-account] RPC failed:", rpcErr);
      return new Response(JSON.stringify({
        error: "deletion_failed",
        stage: "rpc_cascade",
      }), { status: 500, headers: CORS });
    }

    const summary = (rpcResult as any) ?? {};
    if (summary.success === false) {
      return new Response(JSON.stringify(summary), { status: 409, headers: CORS });
    }

    let storageDeleted = 0;
    let storageFailed  = 0;
    try {
      let offset = 0;
      const BATCH = 100;
      while (true) {
        const { data: owned, error: listErr } = await admin
          .from("storage.objects" as any)
          .select("name")
          .eq("bucket_id", "evidence")
          .eq("owner", userId)
          .range(offset, offset + BATCH - 1);
        if (listErr) break;
        if (!owned || owned.length === 0) break;
        const paths = (owned as any[]).map((o) => o.name);
        const { error: rmErr } = await admin.storage.from("evidence").remove(paths);
        if (rmErr) {
          storageFailed += paths.length;
          console.warn("[delete-account] storage.remove partial failure:", rmErr.message);
        } else {
          storageDeleted += paths.length;
        }
        if (owned.length < BATCH) break;
        offset += BATCH;
      }
    } catch (storErr) {
      console.warn("[delete-account] storage cleanup exception (non-fatal):", storErr);
    }

    const { error: authDelErr } = await admin.auth.admin.deleteUser(userId);
    if (authDelErr) {
      console.error("[delete-account] auth.deleteUser failed:", authDelErr);
      return new Response(JSON.stringify({
        error: "auth_delete_failed",
        stage: "auth_users",
        note: "Your data has been erased from the application tables but " +
              "the authentication record remains. Contact support to finish.",
      }), { status: 500, headers: CORS });
    }

    return new Response(JSON.stringify({
      success: true,
      userId,
      email_scrubbed: "[deleted]",
      stripe_subscription_cancelled: stripeSubId ? true : false,
      solo_companies_deleted: summary.solo_companies_deleted ?? 0,
      storage_objects_deleted: storageDeleted,
      storage_objects_failed:  storageFailed,
      completed_at: new Date().toISOString(),
    }), { status: 200, headers: CORS });

  } catch (err) {
    // G-30: log full error server-side, return generic message client-side.
    console.error("[delete-account] unexpected:", err);
    return new Response(JSON.stringify({ error: "server_error" }),
      { status: 500, headers: CORS });
  }
});
