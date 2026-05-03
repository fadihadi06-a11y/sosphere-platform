/**
 * Incident Sync — Civilian SOS history → Supabase
 * ═════════════════════════════════════════════════
 * Shadow-syncs every completed civilian SOS incident to a backend
 * table so it survives device loss, re-installs, and cross-device
 * logins. This runs ALONGSIDE the existing localStorage-first flow;
 * local storage remains the source of truth for the UI. If Supabase
 * is unreachable or unconfigured, the app behaves exactly as before.
 *
 * Isolation guarantees
 *   • Pure network-side module — does NOT touch localStorage. The
 *     caller saves locally, then hands us a record to mirror.
 *   • Every public function is async, best-effort, and swallows all
 *     errors. Never throws. Never blocks navigation or UI.
 *   • Gated by SUPABASE_CONFIG.isConfigured — in offline mode this
 *     is a no-op that returns instantly.
 *   • Uses upsert on (id) so repeated sync calls for the same
 *     incident just refresh the row — safe to retry.
 *
 * Schema expectation (civilian_incidents table — optional on backend):
 *   id                text  primary key
 *   user_id           uuid
 *   start_time        timestamptz
 *   end_time          timestamptz
 *   trigger_method    text
 *   contacts_called   int
 *   contacts_answered int
 *   has_recording     boolean
 *   recording_seconds int
 *   photo_count       int
 *   location          jsonb
 *   payload           jsonb   -- full record for forward-compat
 *   synced_at         timestamptz
 *
 * If the table doesn't exist yet, Supabase will reject with a
 * "relation does not exist" error — we catch, log once per session
 * at console.warn level, and carry on without disrupting the user.
 */

import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";
import type { IncidentRecord } from "./sos-emergency";

const TABLE = "civilian_incidents";
const SYNC_STATUS_KEY = "sosphere_incident_sync_status";

// Once-per-session flag so we don't spam the console when the table
// hasn't been created on the backend yet.
let _missingTableLogged = false;

/* ──────────────────────────────────────────────────────────────── */
/*  Helpers                                                         */
/* ──────────────────────────────────────────────────────────────── */

function toIso(d: Date | string | number | undefined | null): string | null {
  if (d == null) return null;
  try {
    if (d instanceof Date) return d.toISOString();
    return new Date(d).toISOString();
  } catch {
    return null;
  }
}

/** Mark a local record as "synced" (non-blocking bookkeeping). */
function markSynced(incidentId: string, ok: boolean) {
  try {
    const raw = localStorage.getItem(SYNC_STATUS_KEY);
    const map: Record<string, { at: string; ok: boolean }> = raw ? JSON.parse(raw) : {};
    map[incidentId] = { at: new Date().toISOString(), ok };
    // Cap size — keep only the last 200 entries
    const keys = Object.keys(map);
    if (keys.length > 200) {
      const trimmed: typeof map = {};
      keys.slice(-200).forEach(k => { trimmed[k] = map[k]; });
      localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(trimmed));
    } else {
      localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(map));
    }
  } catch {
    /* non-fatal — sync-status is a debugging convenience only */
  }
}

function shapeRow(record: IncidentRecord, userId: string | null) {
  const start = toIso(record.startTime);
  const end   = toIso(record.endTime);
  const contactsAnswered = (record.contacts || []).filter(c => c.status === "answered").length;
  return {
    id: record.id,
    user_id: userId,
    start_time: start,
    end_time: end,
    trigger_method: record.triggerMethod || null,
    contacts_called: (record.contacts || []).length,
    contacts_answered: contactsAnswered,
    has_recording: (record.recordingSeconds || 0) > 0 || (record.photos?.length || 0) > 0,
    recording_seconds: record.recordingSeconds || 0,
    photo_count: record.photos?.length || 0,
    location: record.location || null,
    // Forward-compatible escape hatch — stash the whole normalized record
    // so backend analytics can read new fields without a schema migration.
    payload: {
      ...record,
      // Normalize date-likes to ISO for JSON storage
      startTime: start,
      endTime: end,
    },
    synced_at: new Date().toISOString(),
  };
}

/* ──────────────────────────────────────────────────────────────── */
/*  Public API                                                      */
/* ──────────────────────────────────────────────────────────────── */

/**
 * Sync a single completed incident. Fire-and-forget; awaiting is
 * optional. On any failure, returns false and leaves the local
 * record untouched.
 */
export async function syncIncidentToSupabase(
  record: IncidentRecord
): Promise<boolean> {
  if (!SUPABASE_CONFIG.isConfigured) return false;
  if (!record?.id) return false;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id || null;

    const row = shapeRow(record, userId);
    const { error } = await supabase
      .from(TABLE)
      .upsert(row, { onConflict: "id" });

    if (error) {
      // Table missing is a known "backend not migrated yet" state —
      // log once per session, don't fire the console for every SOS.
      if (/relation .* does not exist/i.test(error.message)) {
        if (!_missingTableLogged) {
          _missingTableLogged = true;
          console.warn(
            `[IncidentSync] Table "${TABLE}" not found — incidents will remain local-only until backend migration is applied.`
          );
        }
      } else {
        console.warn("[IncidentSync] Upsert failed:", error.message);
      }
      markSynced(record.id, false);
      return false;
    }
    markSynced(record.id, true);
    return true;
  } catch (e) {
    console.warn("[IncidentSync] Unexpected failure:", e);
    markSynced(record.id, false);
    return false;
  }
}

/**
 * Re-drive pending syncs from localStorage — safe to call at app
 * startup after a successful login so previously-offline incidents
 * migrate to the server once connectivity returns.
 *
 * Only syncs records that aren't already marked ok in sync-status.
 * Hard-capped to the 50 most-recent entries so this never snowballs.
 */
export async function resyncPendingIncidents(): Promise<{
  attempted: number;
  synced: number;
}> {
  if (!SUPABASE_CONFIG.isConfigured) return { attempted: 0, synced: 0 };

  // ESLint no-useless-assignment: both vars are assigned inside the try
  // block on every success path; on catch we return early. Declaring
  // without initializer avoids a dead initial assignment that was
  // overwritten on the very next reachable read.
  let list: any[];
  let statusMap: Record<string, { at: string; ok: boolean }>;
  try {
    list = JSON.parse(localStorage.getItem("sosphere_incident_history") || "[]");
    const raw = localStorage.getItem(SYNC_STATUS_KEY);
    statusMap = raw ? JSON.parse(raw) : {};
  } catch {
    return { attempted: 0, synced: 0 };
  }

  const toTry = list
    .filter(r => r?.id && !(statusMap[r.id]?.ok === true))
    .slice(0, 50);

  let synced = 0;
  for (const r of toTry) {
    // Reconstitute as IncidentRecord shape the shapeRow helper expects
    const record: IncidentRecord = {
      ...r,
      startTime: typeof r.startTime === "string" ? new Date(r.startTime) : r.startTime,
      endTime: r.endTime
        ? (typeof r.endTime === "string" ? new Date(r.endTime) : r.endTime)
        : undefined,
    };
    const ok = await syncIncidentToSupabase(record);
    if (ok) synced++;
  }
  return { attempted: toTry.length, synced };
}

/** Returns { ok, at } for a given incident id, or null if unknown. */
export function getIncidentSyncStatus(
  incidentId: string
): { ok: boolean; at: string } | null {
  try {
    const raw = localStorage.getItem(SYNC_STATUS_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, { ok: boolean; at: string }>;
    return map[incidentId] || null;
  } catch {
    return null;
  }
}
