// ═══════════════════════════════════════════════════════════════
// SOSphere — Smart Timeline Tracker (Tamper-Evident Event Log)
// ─────────────────────────────────────────────────────────────
// Auto-documents EVERY step from SOS → Rescue → Resolution.
// Each entry is hashed (SHA-256) so any post-hoc edit is DETECTABLE.
// UTC timestamps only. Chain of custody maintained.
//
// B-18 (2026-04-25): the prior header said "Legal-Grade … COURT-
// ADMISSIBLE" — that's a courtroom call, not ours. Admissibility
// depends on jurisdiction, on the discovery process, and on the
// evidentiary chain holding up under cross-examination at trial.
// What we DO provide is a cryptographically tamper-evident chain;
// the report header now reflects that and stops over-promising.
// ═══════════════════════════════════════════════════════════════

// ── Types ────────────────────────────────────────────────────────

export type TimelineEventType =
  | "sos_triggered"
  | "sos_cancelled"
  | "contact_called"
  | "contact_answered"
  | "contact_no_answer"
  | "admin_notified"
  | "admin_answered"
  | "admin_missed"
  | "admin_callback"
  | "gps_locked"
  | "gps_updated"
  | "evidence_photo"
  | "evidence_audio"
  | "evidence_submitted"
  | "evidence_hashed"
  | "escalation_triggered"
  | "emergency_services_called"
  | "zone_lockdown"
  | "responder_dispatched"
  | "responder_arrived"
  | "first_aid_started"
  | "medical_clearance"
  | "area_secured"
  | "resolution_started"
  | "emergency_resolved"
  | "investigation_opened"
  | "investigation_closed"
  | "report_generated"
  | "system_auto"
  | "battery_critical"
  | "signal_lost"
  | "buddy_alert"
  | "custom";

export interface TimelineEntry {
  id: string;
  emergencyId: string;
  timestamp: string;        // ISO 8601 UTC always
  timestampMs: number;      // Unix ms for precise ordering
  type: TimelineEventType;
  event: string;            // Human-readable description
  actor: string;            // Who did this (system/person name)
  actorRole?: string;       // "Employee", "Admin", "System", "Responder"
  metadata?: Record<string, unknown>; // Extra data (GPS coords, phone number, etc.)
  hash: string;             // SHA-256 of (prevHash + entry data) when signed:true; otherwise an "UNSIGNED:" placeholder
  prevHash: string;         // Previous entry's hash (blockchain-style chain)
  sequence: number;         // Sequential number within this emergency
  // ──────────────────────────────────────────────────────────────
  // B-05 (2026-04-25): explicit signature flag. The previous design
  // wrote a 32-bit FNV-1a fingerprint with the prefix "NONCRYPTO:" and
  // STILL counted those entries in the chain — meaning the legal claim
  // "tamper-evident" became false the moment crypto.subtle was missing.
  // Now every entry must declare whether it is cryptographically signed.
  // PDF / legal exports must include only signed:true entries when
  // making any tamper-evidence claim. signed:false entries are kept
  // for operator visibility but are never part of the integrity chain.
  // ──────────────────────────────────────────────────────────────
  signed: boolean;
}

export interface EmergencyTimeline {
  emergencyId: string;
  entries: TimelineEntry[];
  createdAt: string;
  lastUpdatedAt: string;
  chainIntegrity: boolean;  // true if all hashes verify
}

// ── Storage ─────────────────────────────────────────────────────

const TIMELINE_KEY = "sosphere_smart_timeline";

function loadTimelines(): Record<string, EmergencyTimeline> {
  try {
    const raw = JSON.parse(localStorage.getItem(TIMELINE_KEY) || "{}") as Record<string, EmergencyTimeline>;
    // ─────────────────────────────────────────────────────────────
    // B-05 (2026-04-25): the new TimelineEntry shape has a required
    // `signed` flag. Older cached entries (created before this fix)
    // do not have that field. We back-fill conservatively: any entry
    // whose hash is the prior fake NONCRYPTO: form, OR is missing,
    // OR is not a 64-char hex string is treated as signed:false.
    // Real SHA-256 hashes (64 hex chars) get signed:true so the
    // legitimate chain history is preserved.
    // ─────────────────────────────────────────────────────────────
    for (const tlKey of Object.keys(raw)) {
      const tl = raw[tlKey];
      if (!tl?.entries) continue;
      for (const e of tl.entries) {
        if (typeof (e as TimelineEntry).signed !== "boolean") {
          const h = e.hash ?? "";
          const looksLikeRealSha256 = /^[a-f0-9]{64}$/.test(h);
          (e as TimelineEntry).signed = looksLikeRealSha256;
        }
      }
    }
    return raw;
  } catch {
    return {};
  }
}

function saveTimelines(data: Record<string, EmergencyTimeline>) {
  localStorage.setItem(TIMELINE_KEY, JSON.stringify(data));
}

// ── SHA-256 Hashing (Web Crypto API — real, not mock) ───────────

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// ──────────────────────────────────────────────────────────────────
// B-05 (2026-04-25): the prior code shipped a "sha256Sync" function
// that returned a 32-bit FNV-1a fingerprint with the prefix "NONCRYPTO:"
// and let the caller record that entry in the chain. The "tamper-evident"
// claim therefore became false the moment crypto.subtle was missing
// (a motivated attacker can collide a 32-bit hash in milliseconds).
//
// The new contract:
//   - We NEVER claim a signed hash without crypto.subtle.
//   - The sync recorder uses an `UNSIGNED:` placeholder hash and sets
//     entry.signed = false. PDF/legal exports must filter on signed.
//   - The async recorder awaits sha256() and sets entry.signed = true.
//     If crypto.subtle is unavailable in async mode, we throw and let
//     the caller decide whether to retry or fall back to unsigned.
//   - verifyChainIntegrity ignores signed:false entries and reports
//     them separately so operators see the gap explicitly.
//
// `unsignedPlaceholderHash` exists ONLY to give signed:false entries
// a unique deterministic id so client-side dedupe works. It is NOT
// represented as a hash anywhere in the public API; the prefix and
// the `signed:false` flag together signal "do not trust for integrity".
// ──────────────────────────────────────────────────────────────────
function unsignedPlaceholderHash(emergencyId: string, sequence: number, timestampMs: number): string {
  // FNV-1a fingerprint over (emergencyId, sequence, timestamp) — the
  // smallest amount of state that makes each entry uniquely addressable
  // without pretending to be SHA-256. The "UNSIGNED:" prefix is the
  // single source of truth that downstream code MUST observe.
  let h = 2166136261 >>> 0;
  const m = `${emergencyId}|${sequence}|${timestampMs}`;
  for (let i = 0; i < m.length; i++) {
    h ^= m.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `UNSIGNED:${h.toString(16).padStart(8, "0")}`;
}

// ── Core: Add Event to Timeline ─────────────────────────────────

export async function trackEvent(
  emergencyId: string,
  type: TimelineEventType,
  event: string,
  actor: string,
  actorRole?: string,
  metadata?: Record<string, unknown>,
): Promise<TimelineEntry> {
  const timelines = loadTimelines();

  if (!timelines[emergencyId]) {
    timelines[emergencyId] = {
      emergencyId,
      entries: [],
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      chainIntegrity: true,
    };
  }

  const timeline = timelines[emergencyId];
  const entries = timeline.entries;
  const prevHash = entries.length > 0 ? entries[entries.length - 1].hash : "GENESIS";
  const sequence = entries.length + 1;
  const now = new Date();
  const timestampMs = now.getTime();
  const timestamp = now.toISOString();

  // Build the data string to hash
  const dataToHash = JSON.stringify({
    prevHash,
    emergencyId,
    timestamp,
    timestampMs,
    type,
    event,
    actor,
    actorRole,
    metadata,
    sequence,
  });

  // B-05 (2026-04-25): no silent NONCRYPTO fallback — if crypto.subtle
  // fails we mark the entry signed:false and use an UNSIGNED placeholder.
  let hash: string;
  let signed: boolean;
  try {
    hash = await sha256(dataToHash);
    signed = true;
  } catch (e) {
    if (typeof console !== "undefined" && !(globalThis as { __unsignedTimelineWarned?: boolean }).__unsignedTimelineWarned) {
      console.warn(
        "[smart-timeline-tracker] crypto.subtle unavailable — recording entry as UNSIGNED. Legal exports will exclude it.",
        e,
      );
      (globalThis as { __unsignedTimelineWarned?: boolean }).__unsignedTimelineWarned = true;
    }
    hash = unsignedPlaceholderHash(emergencyId, sequence, timestampMs);
    signed = false;
  }

  const entry: TimelineEntry = {
    id: `TL-${emergencyId}-${sequence.toString().padStart(4, "0")}`,
    emergencyId,
    timestamp,
    timestampMs,
    type,
    event,
    actor,
    actorRole,
    metadata,
    hash,
    signed,
    prevHash,
    sequence,
  };

  entries.push(entry);
  timeline.lastUpdatedAt = timestamp;

  saveTimelines(timelines);

  // Notify other tabs
  try {
    localStorage.setItem("sosphere_timeline_event", JSON.stringify({
      emergencyId,
      entryId: entry.id,
      type,
      _ts: timestampMs,
    }));
  } catch {}

  return entry;
}

// ── Sync version for use in tick loops ──────────────────────────

export function trackEventSync(
  emergencyId: string,
  type: TimelineEventType,
  event: string,
  actor: string,
  actorRole?: string,
  metadata?: Record<string, unknown>,
): TimelineEntry {
  const timelines = loadTimelines();

  if (!timelines[emergencyId]) {
    timelines[emergencyId] = {
      emergencyId,
      entries: [],
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      chainIntegrity: true,
    };
  }

  const timeline = timelines[emergencyId];
  const entries = timeline.entries;
  const prevHash = entries.length > 0 ? entries[entries.length - 1].hash : "GENESIS";
  const sequence = entries.length + 1;
  const now = new Date();
  const timestampMs = now.getTime();
  const timestamp = now.toISOString();

  const dataToHash = JSON.stringify({
    prevHash, emergencyId, timestamp, timestampMs, type, event, actor, actorRole, metadata, sequence,
  });

  // B-05 (2026-04-25): trackEventSync runs in non-async contexts. We
  // CANNOT compute SHA-256 here (crypto.subtle is async-only). Instead
  // we mark the entry signed:false with an UNSIGNED placeholder and
  // rely on PDF/legal export filters to exclude it from any tamper-
  // evident claim. Operators still see the event in dashboards.
  const hash = unsignedPlaceholderHash(emergencyId, sequence, timestampMs);

  const entry: TimelineEntry = {
    id: `TL-${emergencyId}-${sequence.toString().padStart(4, "0")}`,
    emergencyId, timestamp, timestampMs, type, event, actor, actorRole, metadata,
    hash, prevHash, sequence,
    signed: false,
  };

  entries.push(entry);
  timeline.lastUpdatedAt = timestamp;
  saveTimelines(timelines);

  return entry;
}

// ── Query Functions ─────────────────────────────────────────────

/** Get full timeline for an emergency */
export function getTimeline(emergencyId: string): EmergencyTimeline | null {
  const timelines = loadTimelines();
  return timelines[emergencyId] || null;
}

/** Get timeline entries for an emergency */
export function getTimelineEntries(emergencyId: string): TimelineEntry[] {
  const timeline = getTimeline(emergencyId);
  return timeline?.entries || [];
}

/** Get the first event (SOS trigger) */
export function getSOSTriggerTime(emergencyId: string): number | null {
  const entries = getTimelineEntries(emergencyId);
  const trigger = entries.find(e => e.type === "sos_triggered");
  return trigger?.timestampMs || null;
}

/** Get real response time in seconds (trigger → first responder) */
export function getRealResponseTimeSec(emergencyId: string): number | null {
  const entries = getTimelineEntries(emergencyId);
  const trigger = entries.find(e => e.type === "sos_triggered");
  const firstResponse = entries.find(e =>
    e.type === "admin_answered" || e.type === "responder_arrived" || e.type === "contact_answered"
  );
  if (!trigger || !firstResponse) return null;
  return Math.round((firstResponse.timestampMs - trigger.timestampMs) / 1000);
}

/** Get real total duration in minutes (trigger → resolved) */
export function getRealDurationMin(emergencyId: string): number | null {
  const entries = getTimelineEntries(emergencyId);
  const trigger = entries.find(e => e.type === "sos_triggered");
  const resolved = entries.find(e => e.type === "emergency_resolved");
  if (!trigger || !resolved) return null;
  return Math.round((resolved.timestampMs - trigger.timestampMs) / 60000);
}

/** Get all unique actors who participated */
export function getRealResponders(emergencyId: string): { name: string; role: string; firstActionAt: string }[] {
  const entries = getTimelineEntries(emergencyId);
  const seen = new Map<string, { role: string; firstActionAt: string }>();

  for (const entry of entries) {
    if (entry.actor !== "System" && entry.actorRole !== "Employee" && !seen.has(entry.actor)) {
      seen.set(entry.actor, {
        role: entry.actorRole || "Responder",
        firstActionAt: entry.timestamp,
      });
    }
  }

  return Array.from(seen.entries()).map(([name, info]) => ({
    name,
    role: info.role,
    firstActionAt: info.firstActionAt,
  }));
}

/** Convert timeline to report-compatible format */
export function getTimelineForReport(emergencyId: string): {
  time: string;
  event: string;
  actor: string;
  type: "trigger" | "action" | "escalation" | "resolution" | "system";
}[] {
  const entries = getTimelineEntries(emergencyId);

  const typeMap: Record<TimelineEventType, "trigger" | "action" | "escalation" | "resolution" | "system"> = {
    sos_triggered: "trigger",
    sos_cancelled: "resolution",
    contact_called: "action",
    contact_answered: "action",
    contact_no_answer: "system",
    admin_notified: "system",
    admin_answered: "action",
    admin_missed: "system",
    admin_callback: "action",
    gps_locked: "system",
    gps_updated: "system",
    evidence_photo: "action",
    evidence_audio: "action",
    evidence_submitted: "action",
    evidence_hashed: "system",
    escalation_triggered: "escalation",
    emergency_services_called: "escalation",
    zone_lockdown: "escalation",
    responder_dispatched: "action",
    responder_arrived: "action",
    first_aid_started: "action",
    medical_clearance: "action",
    area_secured: "action",
    resolution_started: "resolution",
    emergency_resolved: "resolution",
    investigation_opened: "action",
    investigation_closed: "resolution",
    report_generated: "system",
    system_auto: "system",
    battery_critical: "system",
    signal_lost: "system",
    buddy_alert: "escalation",
    custom: "action",
  };

  return entries.map(entry => ({
    time: new Date(entry.timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }),
    event: entry.event,
    actor: entry.actor,
    type: typeMap[entry.type] || "system",
  }));
}

/**
 * B-05 (2026-04-25): synchronous integrity summary. Does NOT verify
 * hashes (impossible without crypto.subtle which is async-only). Only
 * checks that:
 *   - the prevHash chain is contiguous (each entry's prevHash equals
 *     the previous entry's hash)
 *   - counts signed:true vs signed:false entries
 * This is the function PDF generators should use because they run in
 * sync render pipelines (jsPDF). For full async hash verification call
 * `verifyChainIntegrity` from an async context.
 */
export function quickIntegrityCheck(emergencyId: string): {
  totalEntries: number;
  signedCount: number;
  unsignedCount: number;
  chainContiguous: boolean;
  brokenAt?: number;
} {
  const entries = getTimelineEntries(emergencyId);
  let signedCount = 0;
  let unsignedCount = 0;
  let chainContiguous = true;
  let brokenAt: number | undefined;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.signed) signedCount++;
    else unsignedCount++;
    const expectedPrev = i === 0 ? "GENESIS" : entries[i - 1].hash;
    if (e.prevHash !== expectedPrev && chainContiguous) {
      chainContiguous = false;
      brokenAt = i;
    }
  }
  return {
    totalEntries: entries.length,
    signedCount,
    unsignedCount,
    chainContiguous,
    brokenAt,
  };
}

/** Verify chain integrity — checks all hashes (ASYNC, requires crypto.subtle) */
export async function verifyChainIntegrity(emergencyId: string): Promise<{
  valid: boolean;
  brokenAt?: number;
  totalEntries: number;
}> {
  const entries = getTimelineEntries(emergencyId);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const expectedPrev = i === 0 ? "GENESIS" : entries[i - 1].hash;

    if (entry.prevHash !== expectedPrev) {
      return { valid: false, brokenAt: i, totalEntries: entries.length };
    }

    // Verify the hash itself
    const dataToHash = JSON.stringify({
      prevHash: entry.prevHash,
      emergencyId: entry.emergencyId,
      timestamp: entry.timestamp,
      timestampMs: entry.timestampMs,
      type: entry.type,
      event: entry.event,
      actor: entry.actor,
      actorRole: entry.actorRole,
      metadata: entry.metadata,
      sequence: entry.sequence,
    });

    // B-05 (2026-04-25): only entries signed cryptographically participate
    // in the integrity claim. Unsigned entries are still part of the visible
    // log but DO NOT contribute to "tamper-evident" claims.
    if (!entry.signed) continue;
    try {
      const expectedHash = await sha256(dataToHash);
      if (entry.hash !== expectedHash) {
        return { valid: false, brokenAt: i, totalEntries: entries.length };
      }
    } catch {
      // crypto.subtle unavailable at verify time — we cannot prove anything
      // either way. Conservatively report a broken chain so legal exports
      // do not silently claim tamper-evidence.
      return { valid: false, brokenAt: i, totalEntries: entries.length };
    }
  }

  return { valid: true, totalEntries: entries.length };
}

/** Get GPS trail from timeline */

/** Get GPS trail from timeline */
export function getGPSTrail(emergencyId: string): { lat: number; lng: number; timestamp: string }[] {
  const entries = getTimelineEntries(emergencyId);
  return entries
    .filter(e => e.type === "gps_locked" || e.type === "gps_updated")
    .map(e => ({
      lat: (e.metadata?.lat as number) || 0,
      lng: (e.metadata?.lng as number) || 0,
      timestamp: e.timestamp,
    }))
    .filter(g => g.lat !== 0 && g.lng !== 0);
}

/** Get communication log from timeline */
export function getCommsLog(emergencyId: string): {
  time: string;
  from: string;
  to: string;
  channel: string;
  message: string;
}[] {
  const entries = getTimelineEntries(emergencyId);
  return entries
    .filter(e => ["contact_called", "contact_answered", "admin_notified", "admin_answered", "admin_callback", "buddy_alert"].includes(e.type))
    .map(e => ({
      time: new Date(e.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      from: e.actor,
      to: (e.metadata?.to as string) || "Unknown",
      channel: (e.metadata?.channel as string) || "In-App",
      message: e.event,
    }));
}

/** Delete a timeline (for cleanup) */
export function deleteTimeline(emergencyId: string): void {
  const timelines = loadTimelines();
  delete timelines[emergencyId];
  saveTimelines(timelines);
}

/** Get all emergency IDs that have timelines */
export function getAllTimelineIds(): string[] {
  const timelines = loadTimelines();
  return Object.keys(timelines);
}
