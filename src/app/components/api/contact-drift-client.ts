// ═══════════════════════════════════════════════════════════════════════════
// contact-drift-client — C-7 / #14 (2026-04-27)
// ─────────────────────────────────────────────────────────────────────────
// Client-side bridge to the get_emergency_contacts_with_drift RPC.
//
// CONTEXT:
//   C-7's server side is complete (contact_snapshot column on sos_sessions
//   + RPC). This module exposes the bridge to the UI so dispatcher /
//   mobile retry paths can consume it. Without this bridge, the snapshot
//   sits unused — mobile retry would still dial the OLD number.
//
// CONTRACT:
//   getContactsWithDrift(emergencyId) returns:
//     {
//       snapshot: ContactRow[],   // what was dialed at SOS trigger
//       current:  ContactRow[],   // fresh from individual_users.emergency_contacts
//       drift:    DriftRow[],     // contacts whose phone differs OR were deleted/added
//       current_source: 'individual_users' | 'fallback_to_snapshot',
//       session_status: 'active' | 'resolved' | ...,
//     }
//
//   resolveDispatchPhone(contact, drift, policy):
//     pure helper that decides which phone to USE for a retry call given
//     the snapshot entry + drift list. Three policies:
//       - 'current_with_fallback' (default): prefer fresh; fall back to snapshot
//                                            on delete; null on snapshot-empty
//       - 'snapshot_only':                   always use snapshot (audit-stable)
//       - 'skip_deleted':                    null phone on delete (skip the contact)
//
// USAGE PATTERN:
//   const { drift, snapshot } = await getContactsWithDrift(emergencyId);
//   for (const c of snapshot) {
//     const { phone, source } = resolveDispatchPhone(c, drift);
//     if (phone) await sendMessageOrCall(phone);
//     // log audit row with `source` so SOC can trace which phone was used
//   }
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, SUPABASE_CONFIG } from "./supabase-client";

// ── Types ──────────────────────────────────────────────────────
export interface ContactRow {
  name?: string;
  phone?: string;
  relation?: string;
  normalized_at?: string;
}

export type DriftKind =
  | "phone_changed"
  | "deleted"
  | "added_after_trigger";

export interface DriftRow {
  name: string;
  snapshot_phone: string | null;
  current_phone: string | null;
  change_kind: DriftKind;
}

export interface DriftResponse {
  snapshot: ContactRow[];
  current: ContactRow[];
  drift: DriftRow[];
  current_source: "individual_users" | "fallback_to_snapshot";
  session_status: string;
}

export type ResolvePolicy =
  | "current_with_fallback"
  | "snapshot_only"
  | "skip_deleted";

export interface ResolvedDispatch {
  phone: string | null;
  source:
    | "snapshot_no_drift"
    | "current_after_phone_change"
    | "fallback_snapshot_after_delete"
    | "skipped_deleted"
    | "snapshot_only_policy"
    | "missing";
}

// ── Bridge to the RPC ───────────────────────────────────────────
/**
 * Fetch the snapshot + current contact lists + drift for a given emergency.
 *
 * Returns null if Supabase isn't configured (offline mode) or the RPC errors.
 * Caller should treat null as "drift detection unavailable; use snapshot
 * only" — i.e., degrade to legacy SOS behavior, never fail open.
 */
export async function getContactsWithDrift(
  emergencyId: string,
): Promise<DriftResponse | null> {
  if (!SUPABASE_CONFIG.isConfigured) return null;
  if (!emergencyId || typeof emergencyId !== "string") return null;
  try {
    const { data, error } = await supabase.rpc(
      "get_emergency_contacts_with_drift",
      { p_emergency_id: emergencyId },
    );
    if (error) {
      console.warn("[C-7] get_emergency_contacts_with_drift error:", error.message);
      return null;
    }
    if (data && typeof data === "object" && "error" in data) {
      console.warn("[C-7] RPC rejected:", (data as { error: string }).error);
      return null;
    }
    if (!data || typeof data !== "object") return null;
    return data as DriftResponse;
  } catch (e) {
    console.warn("[C-7] getContactsWithDrift threw:", e);
    return null;
  }
}

// ── Pure resolution helper ──────────────────────────────────────
/**
 * Given a snapshot contact + the drift array, decide which phone to dial.
 *
 * This is a pure function — no I/O, no side effects, fully deterministic.
 * Tested in isolation in scripts/test-c7-mobile-retry-wire.mjs.
 */
export function resolveDispatchPhone(
  snapshotEntry: ContactRow,
  drift: DriftRow[] | null | undefined,
  policy: ResolvePolicy = "current_with_fallback",
): ResolvedDispatch {
  if (!snapshotEntry || !snapshotEntry.name) {
    return { phone: null, source: "missing" };
  }
  const matchKey = (snapshotEntry.name ?? "").trim().toLowerCase();
  const driftRow = (drift ?? []).find(
    (d) => (d.name ?? "").trim().toLowerCase() === matchKey,
  );

  // Snapshot-only policy: ignore drift entirely, return snapshot phone
  if (policy === "snapshot_only") {
    return {
      phone: snapshotEntry.phone ?? null,
      source: "snapshot_only_policy",
    };
  }

  // No drift entry for this contact → use snapshot (audit-stable)
  if (!driftRow) {
    return {
      phone: snapshotEntry.phone ?? null,
      source: "snapshot_no_drift",
    };
  }

  // Phone changed → prefer current (the C-7 fix's actual benefit)
  if (driftRow.change_kind === "phone_changed") {
    return {
      phone: driftRow.current_phone ?? snapshotEntry.phone ?? null,
      source: "current_after_phone_change",
    };
  }

  // Deleted: depends on policy
  if (driftRow.change_kind === "deleted") {
    if (policy === "skip_deleted") {
      return { phone: null, source: "skipped_deleted" };
    }
    // current_with_fallback (default): fall back to snapshot phone —
    // the contact may still be reachable at their last-known number
    // even if the user removed them from their list.
    return {
      phone: snapshotEntry.phone ?? null,
      source: "fallback_snapshot_after_delete",
    };
  }

  // added_after_trigger: this case shouldn't appear when iterating snapshot
  // entries (it has no snapshot_phone). Defensive: treat as snapshot.
  return {
    phone: snapshotEntry.phone ?? null,
    source: "snapshot_no_drift",
  };
}

// ── Convenience: build retry plan for entire snapshot ──────────
/**
 * Map every snapshot entry through resolveDispatchPhone and return a
 * plan the dispatcher (or mobile retry) can execute.
 *
 * The plan also includes any added_after_trigger contacts so the
 * dispatcher can choose to dial them as well — useful when the user
 * added a NEW emergency contact mid-SOS hoping someone could help.
 */
export interface DispatchPlanEntry {
  name: string;
  phone: string | null;
  source: ResolvedDispatch["source"] | "added_after_trigger";
  is_new_contact: boolean;  // true if added post-trigger
}

export function buildDispatchPlan(
  snapshot: ContactRow[],
  drift: DriftRow[],
  policy: ResolvePolicy = "current_with_fallback",
): DispatchPlanEntry[] {
  const plan: DispatchPlanEntry[] = [];
  for (const entry of snapshot ?? []) {
    const resolved = resolveDispatchPhone(entry, drift, policy);
    plan.push({
      name: entry.name ?? "",
      phone: resolved.phone,
      source: resolved.source,
      is_new_contact: false,
    });
  }
  // Append added-after-trigger contacts
  for (const d of drift ?? []) {
    if (d.change_kind === "added_after_trigger") {
      plan.push({
        name: d.name,
        phone: d.current_phone,
        source: "added_after_trigger",
        is_new_contact: true,
      });
    }
  }
  return plan;
}
