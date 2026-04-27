// ═══════════════════════════════════════════════════════════════════════════
// delete-account — GDPR Art. 17 account erasure endpoint
//   2026-04-24: rewritten to hit EVERY user-linked table + Supabase Storage.
//   G-20 (B-20, 2026-04-26): replaces wildcard CORS with origin allowlist.
//                            A malicious origin holding a stolen JWT (e.g. via
//                            XSS on a subdomain) can no longer call delete-
//                            account cross-origin.
//   G-30 (B-20, 2026-04-26): 500 response no longer includes raw err.message;
//                            schema names stay out of the public response.
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
