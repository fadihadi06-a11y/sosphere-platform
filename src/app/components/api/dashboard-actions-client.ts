// ═══════════════════════════════════════════════════════════════════════════
// dashboard-actions-client — single channel for every dispatcher action
// ─────────────────────────────────────────────────────────────────────────
// 2026-04-25 (B-02): extracted from hub-incident-reports.tsx so that
//   every consumer (Incident Reports tab, AI Co-Admin, Intelligent Guide,
//   Emergency Lifecycle PDF, future automations) hits the same single
//   gateway. "Behave like a beehive": one entry, one audit chain, one
//   tamper-evident server record. Local UI never claims success unless
//   the server confirms it.
//
// All requests target the `dashboard-actions` edge function (v3+),
// which validates the caller JWT, scopes the row, updates the
// tamper-evident columns, and writes an audit_log row.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, SUPABASE_CONFIG } from "./supabase-client";

// ── Action shapes (one variant per supported edge-function action) ──
export type DispatcherAction =
  | { action: "resolve";            emergencyId: string; note?: string }
  | { action: "acknowledge";        emergencyId: string; note?: string }
  | { action: "assign";             emergencyId: string; responderId: string }
  | { action: "message";            emergencyId: string; body: string }
  | { action: "broadcast";          emergencyId: string; scope: "zone"|"dept"|"all"; message: string }
  | { action: "forward_to_owner";   emergencyId: string; note?: string }
  | { action: "mark_reviewed";      emergencyId: string; note?: string };

export type DispatcherActionResult =
  | { ok: true;  data: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Send a dispatcher action to the server. Pure, side-effect-free in the
 * UI sense — never updates local state. The caller is responsible for
 * mirroring success / error into its own state.
 *
 * Failure is ALWAYS returned (never thrown). The shape is discriminated
 * so the call site can branch with full type safety.
 */
export async function callDispatcherAction(
  req: DispatcherAction,
): Promise<DispatcherActionResult> {
  if (!SUPABASE_CONFIG.isConfigured) {
    return { ok: false, error: "Supabase not configured (offline mode)" };
  }
  try {
    const { data, error } = await supabase.functions.invoke("dashboard-actions", {
      body: req,
    });
    if (error) {
      const detail = (error as { message?: string })?.message ?? String(error);
      return { ok: false, error: detail };
    }
    if (data && typeof data === "object" && "error" in data && data.error) {
      return { ok: false, error: String((data as { error: unknown }).error) };
    }
    return { ok: true, data: (data ?? {}) as Record<string, unknown> };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// High-level helpers — composed actions that AI Co-Admin / Intelligent
// Guide can call directly. Each helper writes a real audit trail; on
// network or RLS failure the caller gets `ok:false` and is expected to
// keep its UI state unchanged + show a real error to the dispatcher.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * "Dispatch response team" — uses broadcast at zone scope. Optional
 * forward to owner when severity is critical so the owner is in the
 * loop alongside the zone notification.
 */
export async function dispatchResponseTeam(args: {
  emergencyId: string;
  zone: string;
  severity: "critical" | "high" | "medium" | "low";
  customMessage?: string;
}): Promise<DispatcherActionResult> {
  const message =
    args.customMessage ??
    `Response team mobilized to ${args.zone}. Stand by for arrival.`;

  const broadcast = await callDispatcherAction({
    action: "broadcast",
    emergencyId: args.emergencyId,
    scope: "zone",
    message,
  });
  if (!broadcast.ok) return broadcast;

  if (args.severity === "critical") {
    // Best-effort owner notification; we do NOT fail the dispatch
    // if owner forwarding fails — the broadcast already succeeded.
    await callDispatcherAction({
      action: "forward_to_owner",
      emergencyId: args.emergencyId,
      note: `Critical incident in ${args.zone} — response team dispatched.`,
    });
  }
  return broadcast;
}

/**
 * "Evacuate zone" — broadcast at zone scope with EVACUATE prefix
 * for client-side filtering / styling.
 */
export async function evacuateZone(args: {
  emergencyId: string;
  zone: string;
  reason?: string;
}): Promise<DispatcherActionResult> {
  const reason = args.reason ? ` Reason: ${args.reason}.` : "";
  return callDispatcherAction({
    action: "broadcast",
    emergencyId: args.emergencyId,
    scope: "zone",
    message: `EVACUATE: leave ${args.zone} immediately via the nearest safe exit.${reason}`,
  });
}

/**
 * "Request emergency services call" — does NOT actually dial the number.
 * It writes a structured audit entry and forwards to the owner so a human
 * is held accountable for the call. The dispatcher is then expected to
 * dial from their device via a tel: link in the modal.
 */
export async function requestEmergencyServicesCall(args: {
  emergencyId: string;
  number: string;
  zone: string;
}): Promise<DispatcherActionResult> {
  return callDispatcherAction({
    action: "forward_to_owner",
    emergencyId: args.emergencyId,
    note: `EMERGENCY SERVICES CALL REQUESTED — dispatcher is dialing ${args.number} for incident in ${args.zone}.`,
  });
}

/**
 * "Confirm emergency services call completed" — second leg of the
 * human-in-the-loop pattern. Records that the dispatcher confirmed
 * the call connected, so the audit chain has both intent and outcome.
 */
export async function confirmEmergencyServicesCall(args: {
  emergencyId: string;
  number: string;
  outcomeText: string;
}): Promise<DispatcherActionResult> {
  return callDispatcherAction({
    action: "mark_reviewed",
    emergencyId: args.emergencyId,
    note: `Emergency services call to ${args.number} — outcome: ${args.outcomeText}`,
  });
}

/**
 * "Forward to owner with note" — generic escalation. Used by SAR
 * launch and manual escalation paths.
 */
export async function forwardToOwner(args: {
  emergencyId: string;
  note: string;
}): Promise<DispatcherActionResult> {
  return callDispatcherAction({
    action: "forward_to_owner",
    emergencyId: args.emergencyId,
    note: args.note,
  });
}

/**
 * "Family contact attempt" — same human-in-the-loop pattern as 997.
 * The dispatcher initiates the call/SMS from their device; we record
 * the request and the outcome. Replaces the previous toast-only
 * `handleNotifyFamily` lie.
 */
export async function recordFamilyNotificationAttempt(args: {
  emergencyId: string;
  contactLabel: string;     // e.g. "Spouse — Sarah" (no PII in note)
  channel: "call" | "sms";
}): Promise<DispatcherActionResult> {
  return callDispatcherAction({
    action: "forward_to_owner",
    emergencyId: args.emergencyId,
    note: `FAMILY ${args.channel.toUpperCase()} INITIATED to ${args.contactLabel}`,
  });
}

export async function recordFamilyNotificationOutcome(args: {
  emergencyId: string;
  contactLabel: string;
  outcome: "connected" | "no_answer" | "voicemail" | "wrong_number";
}): Promise<DispatcherActionResult> {
  return callDispatcherAction({
    action: "mark_reviewed",
    emergencyId: args.emergencyId,
    note: `Family contact ${args.contactLabel} — outcome: ${args.outcome}`,
  });
}
