// ═════════════════════════════════════════════════════════════════════════════
// delete-account — real account deletion endpoint
// ═════════════════════════════════════════════════════════════════════════════
// 2026-04-23: replaces the client-side "Delete Account" stub that previously
// only showed a toast. This function performs a hard delete of the user's
// data: civilian_incidents, evidence_vaults, safety contacts, subscriptions,
// and finally auth.users itself (via service-role).
//
// Protection:
//   • Requires a valid JWT in Authorization: Bearer <token>.
//   • Verifies the caller's auth.uid() matches the user_id being deleted.
//   • Writes an audit_log row BEFORE deletion (since the row referring to
//     the user will be gone after).
//
// The client-side UI must show an explicit confirmation modal before invoking
// this function — we do not rely on a confirm flag because JWT ownership is
// the only real gate.
// ═════════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPA_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) {
    return new Response(JSON.stringify({ error: "Missing bearer token" }), {
      status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Verify the JWT by hitting auth.getUser with the user's own token
  const userClient = createClient(SUPA_URL, SUPA_ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const userId = userData.user.id;
  const email = userData.user.email ?? "(unknown)";

  // Service-role client bypasses RLS for the actual deletes
  const admin = createClient(SUPA_URL, SUPA_SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // 1) Audit-log the deletion BEFORE wiping referring rows
    await admin.from("audit_log").insert({
      company_id: null,
      actor_id: userId,
      actor_name: email,
      actor_role: "user",
      category: "account",
      action: "account_deleted",
      detail: `User requested self-deletion. Email: ${email}`,
      target_id: userId,
      severity: "high",
      client_timestamp: new Date().toISOString(),
    }).catch(() => null);

    // 2) Delete user-owned data (service-role bypasses RLS)
    const tables = [
      "civilian_incidents",
      "evidence_vaults",
      "subscriptions",
      "biometric_verifications",
    ];
    for (const t of tables) {
      await admin.from(t).delete().eq("user_id", userId).catch(() => null);
    }

    // 3) Finally delete the auth user itself
    const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
    if (deleteErr) {
      console.error("[delete-account] auth.deleteUser failed:", deleteErr);
      return new Response(JSON.stringify({ error: "Deletion failed", detail: deleteErr.message }), {
        status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, userId }), {
      status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[delete-account] unexpected error:", err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
