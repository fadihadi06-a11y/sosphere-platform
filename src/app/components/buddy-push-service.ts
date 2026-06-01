// ═══════════════════════════════════════════════════════════════
// SOSphere — buddy-push-service (Phase 2 CRIT-4-B world-class)
// ─────────────────────────────────────────────────────────────
// Server-side delivery path that turns a BUDDY_ALERT SyncEvent into
// an actual notification on buddy B's device (push) with Twilio SMS
// as the durable fallback when push fails / no token registered.
//
// Architecture (mirrors CRIT-2 / CRIT-4-A / CRIT-3 / CRIT-3-P2):
//   • DB is THE source of truth (buddy_pairs + employees + push_tokens
//     — all RLS-scoped; the new SECDEF RPC get_buddy_user_ids
//     resolves the buddy-uuid → user-uuid chain that RLS would
//     otherwise block).
//   • All cross-user lookups go through the SECDEF RPC; client code
//     never reads other users' employees rows directly.
//   • Two-channel delivery (push first, SMS fallback) so a buddy
//     without an installed app still gets the alert. Both channels
//     are idempotent at the recipient side (push notification IDs +
//     Twilio SMS dedup window).
//
// This file contains:
//   1. Pure helpers (Vitest-testable): formatBuddyAlertTitle/Body,
//      decideDeliveryChannel (push vs SMS fallback rule).
//   2. RPC wrapper: resolveBuddiesForUser → list of {user_id, name,
//      phone, employee_id, company_id, pair_id}.
//   3. notifyBuddyAlert(): the one-call entry point used by
//      sos-emergency.tsx after emitSyncEvent("BUDDY_ALERT").
//      Resolves buddies, fans out send-push-notification edge fn
//      calls, falls back to twilio-sms when push delivery returns
//      no recipients (no active push_tokens for the buddy).
// ═══════════════════════════════════════════════════════════════

export interface BuddyResolveRow {
  buddy_user_id:     string;
  buddy_employee_id: string;
  buddy_name:        string | null;
  buddy_phone:       string | null;
  company_id:        string;
  pair_id:           string;
}

export interface BuddyAlertContext {
  /** Who is in distress (caller). Used in the message body. */
  selfName: string;
  /** Optional emergency id so admin dashboards can correlate. */
  emergencyId?: string;
  /** Optional GPS context (last known coords of the distressed user). */
  lat?: number;
  lng?: number;
}

export interface BuddyNotifyResult {
  buddiesAttempted: number;
  pushSent:         number;
  smsSent:          number;
  failures:         Array<{ buddyUserId: string; reason: string }>;
  /** True if at least one buddy was reached by at least one channel. */
  reachedAtLeastOne: boolean;
}

// ───────── PURE HELPERS ─────────

/** Stable, translation-ready title for buddy alerts. */
export function formatBuddyAlertTitle(selfName: string): string {
  return selfName && selfName.trim() !== ""
    ? `${selfName.trim()} needs help`
    : "Your buddy needs help";
}

/** Body text. Keep short (push notification 160-char budget). */
export function formatBuddyAlertBody(ctx: BuddyAlertContext): string {
  const who = (ctx.selfName ?? "").trim() || "Your buddy";
  const hasLoc = typeof ctx.lat === "number" && typeof ctx.lng === "number";
  return hasLoc
    ? `${who} triggered an SOS. Open SOSphere to see their location.`
    : `${who} triggered an SOS. Open SOSphere to respond.`;
}

/** Decide which channels to attempt for a given buddy.
 *  Pure — testable without Supabase.
 *  Rule:
 *    - If buddy has at least 1 active push_token: try PUSH only
 *      (cheap, instant). If push fails the caller can retry SMS.
 *    - If buddy has 0 push_tokens AND a phone: try SMS.
 *    - Else: cannot deliver — mark failure.
 *  Future: hybrid (both channels when life-safety priority) is a
 *  policy decision, not a code limit. */
export type Channel = "push" | "sms" | "none";
export function decideDeliveryChannel(
  pushTokenCount: number,
  phone: string | null | undefined,
): Channel {
  if (pushTokenCount > 0) return "push";
  if (phone && phone.trim() !== "") return "sms";
  return "none";
}

// ───────── RPC + EDGE-FN WRAPPERS ─────────

/** Look up all active buddies for the given user via the SECDEF RPC.
 *  Errors are returned (not thrown) — the SOS hot path must not crash. */
export async function resolveBuddiesForUser(
  selfUserId: string,
): Promise<{ ok: boolean; rows: BuddyResolveRow[]; error?: string }> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data, error } = await supabase.rpc("get_buddy_user_ids", {
      p_self_user_id: selfUserId,
    });
    if (error) return { ok: false, rows: [], error: error.message };
    return { ok: true, rows: Array.isArray(data) ? (data as BuddyResolveRow[]) : [] };
  } catch (err) {
    return { ok: false, rows: [], error: err instanceof Error ? err.message : "Unexpected error" };
  }
}

/** Count the buddy's active push_tokens via a direct RLS-scoped read.
 *  Mobile cannot see other users' rows by default; we rely on the
 *  send-push-notification edge function to do the authoritative
 *  read with service-role privileges. This helper just lets us
 *  pre-check via a count query when the table policy permits it
 *  (currently no such policy, so this returns 0 in most cases —
 *  the edge function is the only authoritative source). For now we
 *  treat the result as a HINT and always attempt push first when
 *  count is unknown. */
async function countBuddyPushTokens(buddyUserId: string): Promise<number> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { count, error } = await supabase
      .from("push_tokens")
      .select("id", { count: "exact", head: true })
      .eq("user_id", buddyUserId)
      .eq("is_active", true);
    if (error) return -1; // unknown — treat as "attempt push, will see"
    return count ?? 0;
  } catch {
    return -1;
  }
}

/** Invoke the send-push-notification edge function for ONE buddy.
 *  Returns true if the edge function reported success (at least one
 *  device delivered). */
async function sendPushToBuddy(
  buddyUserId: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data: resp, error } = await supabase.functions.invoke("send-push-notification", {
      body: { targetUserId: buddyUserId, title, body, data },
    });
    if (error) {
      console.warn("[BuddyPush] send-push-notification error:", error.message);
      return false;
    }
    // Edge fn returns { sent: N, failed: M } — success = at least 1 sent
    const sent = (resp as { sent?: number } | null)?.sent ?? 0;
    return sent > 0;
  } catch (err) {
    console.warn("[BuddyPush] send-push-notification threw:", err);
    return false;
  }
}

/** SMS fallback via the twilio-sms edge function. */
async function sendSmsToBuddy(phone: string, body: string): Promise<boolean> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data: resp, error } = await supabase.functions.invoke("twilio-sms", {
      body: { to: phone, message: body, type: "sos" },
    });
    if (error) {
      console.warn("[BuddyPush] twilio-sms error:", error.message);
      return false;
    }
    return !!resp;
  } catch (err) {
    console.warn("[BuddyPush] twilio-sms threw:", err);
    return false;
  }
}

/** Main entry point. Called from sos-emergency.tsx right after
 *  emitSyncEvent("BUDDY_ALERT"). Resolves all buddies, attempts
 *  push for each, falls back to SMS when push has nothing to deliver.
 *  Returns a summary the caller can log to audit_log / UI toast. */
export async function notifyBuddyAlert(
  selfUserId: string,
  ctx: BuddyAlertContext,
): Promise<BuddyNotifyResult> {
  const result: BuddyNotifyResult = {
    buddiesAttempted: 0,
    pushSent:         0,
    smsSent:          0,
    failures:         [],
    reachedAtLeastOne: false,
  };
  if (!selfUserId) {
    result.failures.push({ buddyUserId: "(self)", reason: "missing self user id" });
    return result;
  }

  const resolved = await resolveBuddiesForUser(selfUserId);
  if (!resolved.ok) {
    result.failures.push({ buddyUserId: "(rpc)", reason: resolved.error ?? "resolve failed" });
    return result;
  }
  if (resolved.rows.length === 0) {
    // Not a failure — user simply has no buddy configured.
    return result;
  }

  const title = formatBuddyAlertTitle(ctx.selfName);
  const body  = formatBuddyAlertBody(ctx);

  for (const b of resolved.rows) {
    result.buddiesAttempted += 1;
    const tokenCount = await countBuddyPushTokens(b.buddy_user_id);
    // -1 = unknown (RLS blocked), treat as "try push first"
    const primaryChannel = decideDeliveryChannel(
      tokenCount < 0 ? 1 : tokenCount,
      b.buddy_phone,
    );

    let pushOk = false;
    if (primaryChannel === "push") {
      pushOk = await sendPushToBuddy(b.buddy_user_id, title, body, {
        kind:         "buddy_alert",
        emergencyId:  ctx.emergencyId,
        selfUserId,
        selfName:     ctx.selfName,
        pairId:       b.pair_id,
        lat:          ctx.lat,
        lng:          ctx.lng,
      });
      if (pushOk) {
        result.pushSent += 1;
        result.reachedAtLeastOne = true;
        continue;
      }
    }

    // Fallback to SMS if push didn't work and phone is available
    if (b.buddy_phone && b.buddy_phone.trim() !== "") {
      const smsOk = await sendSmsToBuddy(b.buddy_phone, `[SOSphere] ${title}. ${body}`);
      if (smsOk) {
        result.smsSent += 1;
        result.reachedAtLeastOne = true;
        continue;
      }
    }

    result.failures.push({
      buddyUserId: b.buddy_user_id,
      reason: primaryChannel === "none"
        ? "no push token and no phone"
        : pushOk ? "sms_failed_after_push_failed" : "all_channels_failed",
    });
  }

  return result;
}
