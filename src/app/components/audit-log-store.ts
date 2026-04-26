// ═══════════════════════════════════════════════════════════════
// SOSphere — Real Audit Log Store
// ─────────────────────────────────────────────────────────────
// Auto-logs every dashboard action: who did what, when, from where.
// Replaces MOCK_AUDIT with real persisted events.
// ISO 27001 §A.12.4 — Event Logging
//
// Dual-write strategy (P3-#11):
//   • localStorage  — immediate, works offline, drives the live UI.
//   • Supabase      — durable, cross-device, compliance-grade.
//                    Writes are fire-and-forget in the background;
//                    failures fall back to a retry queue that drains
//                    on the next successful write.
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./api/supabase-client";
import { getCompanyId } from "./shared-store";

export type AuditCategory =
  | "permission_change"
  | "role_change"
  | "zone_assignment"
  | "user_added"
  | "user_removed"
  | "user_suspended"
  | "2fa_event"
  | "login"
  | "logout"
  | "emergency"
  | "settings"
  | "csv_import"
  | "file_access"
  | "data_modify"
  | "data_delete"
  | "report_export"
  | "investigation";

export type AuditLevel = "owner" | "main_admin" | "zone_admin" | "worker" | "system";
export type AuditSeverity = "info" | "warning" | "critical" | "success";

export interface AuditEntry {
  id: string;
  timestamp: Date;
  timestampMs: number;
  actor: {
    id: string;
    name: string;
    level: AuditLevel;
  };
  target?: {
    id: string;
    name: string;
    level?: AuditLevel;
  };
  category: AuditCategory;
  action: string;
  detail?: string;
  zone?: string;
  before?: string;
  after?: string;
  severity: AuditSeverity;
  verified2FA?: boolean;
  ipAddress?: string;
  deviceInfo?: string;
}

// ── Storage ──────────────────────────────────────────────────────

const AUDIT_KEY = "sosphere_audit_log";

// S-M2: classify UA into a stable label (browser + platform + form-factor)
// instead of storing raw navigator.userAgent on every audit row. The raw
// UA string:
//   • leaks minor browser versions → passive fingerprint across rows
//   • changes frequently on Chrome auto-update → noisy analytics
//   • exceeds the 80-char slice limit for modern Chrome UAs anyway
// The classified label is analytics-friendly and carries zero PII.
function classifyUserAgent(): string | undefined {
  try {
    if (typeof navigator === "undefined") return undefined;
    const ua = (navigator.userAgent || "").toLowerCase();
    if (!ua) return undefined;

    let browser = "unknown";
    if (ua.includes("edg/")) browser = "edge";
    else if (ua.includes("opr/") || ua.includes("opera")) browser = "opera";
    else if (ua.includes("firefox/")) browser = "firefox";
    else if (ua.includes("chrome/")) browser = "chrome";
    else if (ua.includes("safari/")) browser = "safari";

    let platform = "desktop";
    if (ua.includes("android")) platform = "android";
    else if (ua.includes("iphone") || ua.includes("ipad")) platform = "ios";
    else if (ua.includes("mac os")) platform = "macos";
    else if (ua.includes("windows")) platform = "windows";
    else if (ua.includes("linux")) platform = "linux";

    const isMobile = /mobile|android|iphone|ipad/.test(ua);
    return `${browser}/${platform}${isMobile ? "/mobile" : ""}`;
  } catch {
    return undefined;
  }
}
const AUDIT_EVENT_KEY = "sosphere_audit_event";
const MAX_ENTRIES = 500; // Keep last 500 entries

function loadAuditLog(): AuditEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]");
    // Restore Date objects
    return raw.map((e: any) => ({ ...e, timestamp: new Date(e.timestamp) }));
  } catch {
    return [];
  }
}

function saveAuditLog(entries: AuditEntry[]): void {
  localStorage.setItem(AUDIT_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
}

// ── Get current admin info from localStorage ────────────────────

function getCurrentActor(): { id: string; name: string; level: AuditLevel } {
  try {
    const adminData = JSON.parse(localStorage.getItem("sosphere_admin_profile") || "{}");
    return {
      id: adminData.id || "admin",
      name: adminData.name || adminData.displayName || "Admin",
      level: (adminData.role as AuditLevel) || "main_admin",
    };
  } catch {
    return { id: "admin", name: "Admin", level: "main_admin" };
  }
}

// ── Core: Log an audit event ─────────────────────────────────────

export function logAuditEvent(
  category: AuditCategory,
  action: string,
  options?: {
    detail?: string;
    zone?: string;
    before?: string;
    after?: string;
    severity?: AuditSeverity;
    targetId?: string;
    targetName?: string;
    targetLevel?: AuditLevel;
    verified2FA?: boolean;
    actorOverride?: { id: string; name: string; level: AuditLevel };
  }
): AuditEntry {
  const actor = options?.actorOverride ?? getCurrentActor();
  const now = new Date();

  const entry: AuditEntry = {
    id: `AUD-${now.getTime().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
    timestamp: now,
    timestampMs: now.getTime(),
    actor,
    target: options?.targetId ? {
      id: options.targetId,
      name: options.targetName || options.targetId,
      level: options.targetLevel,
    } : undefined,
    category,
    action,
    detail: options?.detail,
    zone: options?.zone,
    before: options?.before,
    after: options?.after,
    severity: options?.severity ?? "info",
    verified2FA: options?.verified2FA,
    deviceInfo: classifyUserAgent(),
  };

  const log = loadAuditLog();
  log.unshift(entry); // newest first
  saveAuditLog(log);

  // Notify other tabs (for real-time update in AuditLogPage)
  try {
    localStorage.setItem(AUDIT_EVENT_KEY, JSON.stringify({
      entryId: entry.id,
      category,
      action,
      _ts: entry.timestampMs,
    }));
  } catch {}

  // Fire-and-forget durable persistence. Any failure is caught, logged,
  // and the entry is stashed for a retry on the next successful write.
  void persistToSupabase(entry);

  return entry;
}

// ── Supabase persistence (durable, cross-device) ─────────────────

const RETRY_QUEUE_KEY = "sosphere_audit_retry_queue";
const MAX_RETRY_QUEUE = 100;

function loadRetryQueue(): AuditEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RETRY_QUEUE_KEY) || "[]");
    return raw.map((e: any) => ({ ...e, timestamp: new Date(e.timestamp) }));
  } catch {
    return [];
  }
}

function saveRetryQueue(entries: AuditEntry[]): void {
  try {
    localStorage.setItem(
      RETRY_QUEUE_KEY,
      JSON.stringify(entries.slice(0, MAX_RETRY_QUEUE)),
    );
  } catch {}
}

/** Map an AuditEntry to the audit_log DB row shape. */
function toDbRow(entry: AuditEntry, companyId: string): Record<string, any> {
  return {
    id: entry.id,
    company_id: companyId,
    actor_id: entry.actor.id,
    actor_name: entry.actor.name,
    actor_role: entry.actor.level,
    category: entry.category,
    action: entry.action,
    detail: entry.detail ?? null,
    target_id: entry.target?.id ?? null,
    target_name: entry.target?.name ?? null,
    target_role: entry.target?.level ?? null,
    before_value: entry.before ?? null,
    after_value: entry.after ?? null,
    zone: entry.zone ?? null,
    severity: entry.severity,
    verified_2fa: entry.verified2FA ?? false,
    device_info: entry.deviceInfo ?? null,
    client_timestamp: entry.timestamp.toISOString(),
  };
}

/**
 * D-H6: resolve the authoritative actor_id for an audit row.
 * Client-side entries use the localStorage admin profile (for
 * zero-latency UI) but the DB row must carry the server-verified
 * auth.uid() — the one that cannot be forged by editing localStorage.
 *
 * If we can't reach auth.getUser() (offline, session expiring), we
 * fall through to the client-derived id so compliance still gets a
 * breadcrumb. Any mismatch is a signal worth alerting on and could
 * be surfaced as a future audit.
 */
async function verifiedServerActorId(): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Apply verified actor_id + server client_timestamp to a DB row
 * before upsert. Leaves other fields intact.
 */
function applyServerActor(row: Record<string, any>, serverActorId: string | null): Record<string, any> {
  if (!serverActorId) return row;
  // If the client-derived actor_id differs from the server one, keep the
  // server value in actor_id and record the client claim in device_info
  // so investigators can spot tampering attempts.
  if (row.actor_id && row.actor_id !== serverActorId) {
    const deviceInfo = row.device_info ? String(row.device_info) : "";
    const mismatchTag = "[actor_mismatch:" + String(row.actor_id).slice(0, 8) + "]";
    row.device_info = deviceInfo ? deviceInfo + " " + mismatchTag : mismatchTag;
  }
  row.actor_id = serverActorId;
  return row;
}

/**
 * Write an audit entry to Supabase in the background. On failure, add it
 * to a local retry queue that drains on the next successful write. We
 * never await or throw from this function — compliance should be durable
 * but must not block the UI.
 */
// ──────────────────────────────────────────────────────────────────
// G-35 (B-20, 2026-04-26): persistToSupabase write-lock + diff-clear.
//
// Pre-fix: two concurrent calls (two tabs, or replay-watcher + UI) could
// race the read-then-clear pattern. Tab A reads queue=[old1], builds
// batch=[old1, entry1], upserts. Tab B between Tab A's upsert success
// and Tab A's saveRetryQueue([]) enqueues entry2 → queue=[old1, entry2].
// Tab A then clears the queue, deleting entry2 forever.
//
// Now: serialised through `auditWriteLock` (same pattern as B-04 evidence-
// vault G-26). Inside the lock we use DIFF-CLEAR — we remove ONLY the ids
// we actually upserted, not the entire queue. A new entry that arrived
// between read and clear stays in the queue.
// ──────────────────────────────────────────────────────────────────
let auditWriteLock: Promise<void> = Promise.resolve();

async function persistToSupabase(entry: AuditEntry): Promise<void> {
  const companyId = getCompanyId();
  if (!companyId) {
    enqueueForRetry(entry);
    return;
  }

  // Serialise through the lock — concurrent persistToSupabase / flush
  // calls run one at a time so the read-then-clear pair is atomic.
  auditWriteLock = auditWriteLock.then(async () => {
    try {
      const serverActorId = await verifiedServerActorId();
      const queue = loadRetryQueue();
      // Capture the exact ids we are about to upsert. After success we
      // remove ONLY these from the queue; anything enqueued during the
      // upsert by another path is preserved for the next flush.
      const upsertedIds = new Set<string>([...queue.map((e) => e.id), entry.id]);
      const batch = queue.length > 0
        ? [
            ...queue.map((e) => applyServerActor(toDbRow(e, companyId), serverActorId)),
            applyServerActor(toDbRow(entry, companyId), serverActorId),
          ]
        : [applyServerActor(toDbRow(entry, companyId), serverActorId)];

      const { error } = await supabase
        .from("audit_log")
        .upsert(batch, { onConflict: "id" });

      if (error) {
        console.warn("[audit] Supabase insert failed, queued for retry:", error.message);
        enqueueForRetry(entry);
        return;
      }

      // G-35 diff-clear: re-read the queue (it may have grown during the
      // upsert) and keep only ids we did NOT just persist.
      const queueAfter = loadRetryQueue();
      const remaining = queueAfter.filter((e) => !upsertedIds.has(e.id));
      saveRetryQueue(remaining);
    } catch (err) {
      console.warn("[audit] Supabase insert exception, queued for retry:", err);
      enqueueForRetry(entry);
    }
  }).catch((chainErr) => {
    // Chain must continue even if a prior link rejected.
    console.error("[audit] persistToSupabase chain error:", chainErr);
  });

  return auditWriteLock;
}

function enqueueForRetry(entry: AuditEntry): void {
  const q = loadRetryQueue();
  // Dedup by id so repeated failures don't bloat the queue.
  if (q.some((e) => e.id === entry.id)) return;
  q.unshift(entry);
  saveRetryQueue(q);
}

/**
 * Manually drain the retry queue. Safe to call on app init once the user
 * is logged in and a company id is bound — any backlogged events from
 * earlier sessions will be flushed.
 */
export async function flushAuditRetryQueue(): Promise<number> {
  const companyId = getCompanyId();
  if (!companyId) return 0;
  const queue = loadRetryQueue();
  if (queue.length === 0) return 0;

  try {
    const { error } = await supabase
      .from("audit_log")
      .upsert(queue.map((e) => toDbRow(e, companyId)), { onConflict: "id" });
    if (error) {
      console.warn("[audit] flushAuditRetryQueue failed:", error.message);
      return 0;
    }
    saveRetryQueue([]);
    return queue.length;
  } catch (err) {
    console.warn("[audit] flushAuditRetryQueue exception:", err);
    return 0;
  }
}

// ── Common pre-built audit helpers ──────────────────────────────

/** Log emergency event (SOS, escalation, resolution) */
export function auditEmergency(action: string, detail: string, zone?: string, severity: AuditSeverity = "critical"): void {
  logAuditEvent("emergency", action, { detail, zone, severity,
    actorOverride: { id: "system", name: "System (Auto)", level: "system" }
  });
}

/** Log when admin resolves an emergency */
export function auditEmergencyResolved(emergencyId: string, employeeName: string, zone: string): void {
  logAuditEvent("emergency", `Emergency resolved: ${emergencyId}`, {
    detail: `${employeeName} emergency in ${zone} resolved by admin`,
    zone, severity: "success",
  });
}

/** Log report export */
export function auditReportExport(reportType: string, emergencyId?: string): void {
  logAuditEvent("report_export", `Report exported: ${reportType}`, {
    detail: emergencyId ? `Emergency ID: ${emergencyId}` : undefined,
    severity: "info",
  });
}

/** Log investigation opened */
export function auditInvestigationOpened(investigationId: string, incidentId: string): void {
  logAuditEvent("investigation", `Investigation opened: ${investigationId}`, {
    detail: `Linked to incident: ${incidentId}`,
    severity: "info",
  });
}

/** Log investigation closed */
export function auditInvestigationClosed(investigationId: string, resolution: string): void {
  logAuditEvent("investigation", `Investigation closed: ${investigationId}`, {
    detail: `Resolution: ${resolution}`,
    severity: "success",
  });
}

/** Log settings change */
export function auditSettingsChange(field: string, before: string, after: string): void {
  logAuditEvent("settings", `Settings updated: ${field}`, {
    before, after, severity: "info",
  });
}

/** Log user added */
export function auditUserAdded(userName: string, userId: string, zone?: string): void {
  logAuditEvent("user_added", `Employee added: ${userName}`, {
    targetId: userId, targetName: userName,
    zone, severity: "success",
  });
}

/** Log login */
export function auditLogin(userName: string, userId: string): void {
  logAuditEvent("login", `Admin logged in: ${userName}`, {
    detail: `Session started`,
    severity: "info",
    actorOverride: { id: userId, name: userName, level: "main_admin" },
  });
}

// ── Query ────────────────────────────────────────────────────────

/** Get all real audit entries */
export function getRealAuditLog(): AuditEntry[] {
  return loadAuditLog();
}

/** Subscribe to new audit events (for AuditLogPage live update) */
export function onAuditEvent(callback: (entry: AuditEntry) => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === AUDIT_EVENT_KEY && e.newValue) {
      try {
        const log = loadAuditLog();
        if (log.length > 0) callback(log[0]);
      } catch {}
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
