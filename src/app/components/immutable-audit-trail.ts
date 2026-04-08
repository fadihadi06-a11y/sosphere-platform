// ═══════════════════════════════════════════════════════════════
// SOSphere — Immutable Audit Trail
// ISO 27001 §A.12.4.1 — Event Logging
// ISO 27001 §A.12.4.2 — Protection of Log Information
// ISO 27001 §A.12.4.3 — Administrator and Operator Logs
// ═══════════════════════════════════════════════════════════════
//
// Architecture:
//   1. All sensitive actions are logged via logAuditEvent()
//   2. Events are written to BOTH localStorage (for offline) and Supabase audit_log table
//   3. Supabase table uses RLS policies to make it APPEND-ONLY:
//      - INSERT: allowed for authenticated users
//      - UPDATE: DENIED (no one can modify logs)
//      - DELETE: DENIED (no one can delete logs)
//      - SELECT: allowed for admin roles only
//   4. Each log includes: timestamp, actor, action, target, deviceId, IP hash, checksum
//   5. Checksum = SHA-256(timestamp + actor + action + target + previousChecksum)
//      This creates a blockchain-like chain that detects tampering.
//
// ═══════════════════════════════════════════════════════════════

import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";
import { reportError } from "./error-boundary";

export type SensitiveAction =
  | "sos_viewed"
  | "sos_acknowledged"
  | "sos_dismissed"
  | "medical_id_accessed"
  | "medical_id_modified"
  | "medical_id_shared"
  | "user_deleted"
  | "user_suspended"
  | "role_changed"
  | "permission_changed"
  | "data_exported"
  | "data_downloaded"
  | "pin_verified"
  | "pin_failed"
  | "session_started"
  | "session_ended"
  | "settings_changed"
  | "encryption_key_rotated"
  | "audit_log_accessed"
  | "compliance_report_viewed"
  | "emergency_contact_modified"
  | "location_data_accessed"
  | "cold_storage_purged";

export interface ImmutableAuditEntry {
  id: string;
  timestamp: string;           // ISO 8601
  timestampMs: number;
  actor: {
    userId: string;
    email: string;
    role: string;
    displayName: string;
  };
  action: SensitiveAction;
  target?: {
    type: "user" | "record" | "system" | "data";
    id: string;
    name?: string;
  };
  metadata?: Record<string, any>;
  deviceId: string;            // Fingerprint of the device
  ipHash: string;              // SHA-256 hash of IP (privacy-preserving)
  userAgent: string;           // Browser info (for forensics)
  checksum: string;            // SHA-256 chain hash (tamper detection)
  previousChecksum: string;    // Previous entry's checksum (chain link)
  severity: "info" | "warning" | "critical";
}

// ── State & Storage ──────────────────────────────────────────────

const AUDIT_TRAIL_KEY = "sosphere_immutable_audit_trail";
const LAST_CHECKSUM_KEY = "sosphere_audit_last_checksum";
const DEVICE_ID_KEY = "sosphere_device_fingerprint";

let _lastChecksum = "";
let _deviceId = "";
let _initialized = false;

// ── Utility: SHA-256 Hash ────────────────────────────────────────

/**
 * Compute SHA-256 hash of a string.
 * Uses SubtleCrypto for secure hashing.
 */
async function sha256(message: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  } catch (err) {
    reportError(err, {
      context: "sha256",
      message: "Failed to compute SHA-256 hash",
      severity: "warning",
    }, "warning");
    // Fallback to simple hash if crypto fails (dev mode)
    return `fallback_${message.slice(0, 20)}_${Date.now()}`;
  }
}

// ── Device ID: Stable Fingerprint ───────────────────────────────

/**
 * Generate stable device fingerprint from navigator and screen properties.
 * Uses: language, screen width/height, timezone (similar to supabase-client.ts approach)
 */
export function getDeviceId(): string {
  if (_deviceId) return _deviceId;

  try {
    // Stored fingerprint
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored) {
      _deviceId = stored;
      return _deviceId;
    }

    // Generate new fingerprint from stable properties
    const fingerprint = [
      navigator.language || "unknown",
      screen.width || 0,
      screen.height || 0,
      new Date().getTimezoneOffset(),
    ].join("|");

    // Hash it to a compact ID
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint))
      .then(hashBuffer => {
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        _deviceId = "DEV_" + hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
        localStorage.setItem(DEVICE_ID_KEY, _deviceId);
      })
      .catch(err => {
        console.warn("[AuditTrail] Failed to generate device ID hash, using fallback");
        _deviceId = `DEV_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
        localStorage.setItem(DEVICE_ID_KEY, _deviceId);
      });

    // Return synchronously for now
    if (!_deviceId) {
      _deviceId = `DEV_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      localStorage.setItem(DEVICE_ID_KEY, _deviceId);
    }

    return _deviceId;
  } catch (err) {
    console.warn("[AuditTrail] Error generating device ID:", err);
    return "DEV_UNKNOWN";
  }
}

// ── IP Hash: Privacy-Preserving IP Capture ──────────────────────

/**
 * Get a hashed version of the user's IP address (privacy-preserving).
 * In production, this could be obtained from the server.
 * For now, returns a placeholder hash.
 */
async function getIpHash(): Promise<string> {
  try {
    // In a production setup, you'd get the IP from a backend endpoint
    // For now, return a placeholder or try to get it from client-side API
    // We'll use a client-side approach with WebRTC or similar
    // For MVP, return a placeholder hash
    const placeholder = "IP_HASH_CLIENT_SIDE";
    return await sha256(placeholder + Date.now());
  } catch {
    return "IP_HASH_UNKNOWN";
  }
}

// ── Checksum Chain: Tamper Detection ────────────────────────────

/**
 * Compute checksum for an audit entry.
 * Checksum = SHA-256(timestamp + action + actorId + targetId + previousChecksum)
 * This creates a chain where tampering any entry breaks the chain.
 */
async function computeChecksum(
  timestamp: string,
  action: string,
  actorId: string,
  targetId: string,
  previousChecksum: string
): Promise<string> {
  const chain = `${timestamp}|${action}|${actorId}|${targetId}|${previousChecksum}`;
  return await sha256(chain);
}

// ── Load/Save Audit Trail from localStorage ─────────────────────

function loadAuditTrailFromStorage(): ImmutableAuditEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(AUDIT_TRAIL_KEY) || "[]");
    return raw;
  } catch {
    return [];
  }
}

function saveAuditTrailToStorage(entries: ImmutableAuditEntry[]): void {
  try {
    // Keep last 1000 entries
    const toSave = entries.slice(0, 1000);
    localStorage.setItem(AUDIT_TRAIL_KEY, JSON.stringify(toSave));
  } catch (err) {
    console.warn("[AuditTrail] Failed to save to localStorage:", err);
  }
}

// ── Get Current Actor ────────────────────────────────────────────

function getCurrentActor(): {
  userId: string;
  email: string;
  role: string;
  displayName: string;
} {
  try {
    const profile = JSON.parse(localStorage.getItem("sosphere_admin_profile") || "{}");
    const auth = JSON.parse(localStorage.getItem("sosphere_auth") || "{}");

    return {
      userId: profile.id || auth.userId || "unknown",
      email: profile.email || auth.email || "unknown@sosphere.local",
      role: profile.role || auth.role || "viewer",
      displayName: profile.displayName || profile.name || "Unknown User",
    };
  } catch {
    return {
      userId: "unknown",
      email: "unknown@sosphere.local",
      role: "viewer",
      displayName: "Unknown User",
    };
  }
}

// ── Initialize Audit Trail ───────────────────────────────────────

/**
 * Initialize the audit trail system.
 * Loads the last checksum from localStorage for chain continuity.
 * In production, should load from Supabase on startup.
 */
export async function initAuditTrail(): Promise<void> {
  if (_initialized) return;

  try {
    // Load from localStorage
    _lastChecksum = localStorage.getItem(LAST_CHECKSUM_KEY) || "";
    getDeviceId();

    // If Supabase is configured, fetch the last checksum from the server
    if (SUPABASE_CONFIG.isConfigured) {
      try {
        const { data, error } = await supabase
          .from("audit_log")
          .select("checksum")
          .order("timestampMs", { ascending: false })
          .limit(1);

        if (!error && data && data.length > 0) {
          _lastChecksum = data[0].checksum;
          localStorage.setItem(LAST_CHECKSUM_KEY, _lastChecksum);
          console.log("[AuditTrail] Initialized from Supabase, last checksum loaded");
        }
      } catch (err) {
        console.warn("[AuditTrail] Could not fetch last checksum from Supabase, using localStorage", err);
      }
    }

    _initialized = true;
    console.log("[AuditTrail] Initialized. Last checksum:", _lastChecksum.slice(0, 16) + "...");
  } catch (err) {
    reportError(err, {
      context: "initAuditTrail",
      severity: "warning",
    }, "warning");
  }
}

// ── Core: Log an Audit Event ────────────────────────────────────

/**
 * Log a sensitive security event to the immutable audit trail.
 *
 * Writes to both localStorage (immediate) and Supabase (background).
 * The chain checksum ensures tamper detection.
 */
export async function logAuditEvent(
  action: SensitiveAction,
  target?: {
    type: "user" | "record" | "system" | "data";
    id: string;
    name?: string;
  },
  metadata?: Record<string, any>,
  severity: "info" | "warning" | "critical" = "info"
): Promise<ImmutableAuditEntry> {
  const actor = getCurrentActor();
  const now = new Date();
  const timestamp = now.toISOString();
  const timestampMs = now.getTime();

  // Compute checksum for this entry
  const checksum = await computeChecksum(
    timestamp,
    action,
    actor.userId,
    target?.id || "none",
    _lastChecksum
  );

  const ipHash = await getIpHash();

  const entry: ImmutableAuditEntry = {
    id: `AUDIT_${timestampMs.toString(36).toUpperCase()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    timestamp,
    timestampMs,
    actor,
    action,
    target,
    metadata,
    deviceId: getDeviceId(),
    ipHash,
    userAgent: navigator.userAgent || "unknown",
    checksum,
    previousChecksum: _lastChecksum,
    severity,
  };

  // Update last checksum for next entry
  _lastChecksum = checksum;
  localStorage.setItem(LAST_CHECKSUM_KEY, checksum);

  // Save to localStorage immediately (offline-first)
  const trail = loadAuditTrailFromStorage();
  trail.unshift(entry);
  saveAuditTrailToStorage(trail);

  // Write to Supabase in background (don't block)
  if (SUPABASE_CONFIG.isConfigured) {
    supabase
      .from("audit_log")
      .insert([entry])
      .then(({ error }) => {
        if (error) {
          console.warn("[AuditTrail] Failed to write to Supabase:", error.message);
          reportError(
            new Error(`Audit trail write failed: ${error.message}`),
            {
              context: "logAuditEvent",
              action,
              severity: "warning",
            },
            "warning"
          );
        } else {
          console.log("[AuditTrail] Entry logged to Supabase:", entry.id);
        }
      })
      .catch(err => {
        console.warn("[AuditTrail] Exception writing to Supabase:", err);
      });
  }

  return entry;
}

// ── Verify Audit Chain: Detect Tampering ───────────────────────

/**
 * Verify the integrity of an audit trail chain.
 * Returns true if all entries' checksums are valid and linked correctly.
 */
export async function verifyAuditChain(entries: ImmutableAuditEntry[]): Promise<boolean> {
  if (entries.length === 0) return true;

  // Start from the oldest entry (last in array) and work forward
  const sorted = [...entries].reverse();
  let previousChecksum = "";

  for (const entry of sorted) {
    const expectedChecksum = await computeChecksum(
      entry.timestamp,
      entry.action,
      entry.actor.userId,
      entry.target?.id || "none",
      previousChecksum
    );

    if (expectedChecksum !== entry.checksum) {
      console.error(
        "[AuditTrail] Checksum mismatch detected! Entry may have been tampered with.",
        { entryId: entry.id, expected: expectedChecksum, actual: entry.checksum }
      );
      return false;
    }

    previousChecksum = entry.checksum;
  }

  return true;
}

// ── Query: Fetch Recent Entries ──────────────────────────────────

/**
 * Get recent audit entries from the local store (or Supabase if configured).
 */
export async function getRecentAuditEntries(limit: number = 50): Promise<ImmutableAuditEntry[]> {
  if (!SUPABASE_CONFIG.isConfigured) {
    return loadAuditTrailFromStorage().slice(0, limit);
  }

  try {
    const { data, error } = await supabase
      .from("audit_log")
      .select("*")
      .order("timestampMs", { ascending: false })
      .limit(limit);

    if (error) {
      console.warn("[AuditTrail] Failed to fetch from Supabase, falling back to localStorage:", error.message);
      return loadAuditTrailFromStorage().slice(0, limit);
    }

    return data || [];
  } catch (err) {
    console.warn("[AuditTrail] Exception fetching entries:", err);
    return loadAuditTrailFromStorage().slice(0, limit);
  }
}

/**
 * Get audit entries for a specific user.
 */
export async function getAuditEntriesForUser(
  userId: string,
  limit: number = 50
): Promise<ImmutableAuditEntry[]> {
  if (!SUPABASE_CONFIG.isConfigured) {
    const local = loadAuditTrailFromStorage();
    return local.filter(e => e.actor.userId === userId).slice(0, limit);
  }

  try {
    const { data, error } = await supabase
      .from("audit_log")
      .select("*")
      .eq("actor->userId", userId)
      .order("timestampMs", { ascending: false })
      .limit(limit);

    if (error) {
      console.warn("[AuditTrail] Failed to fetch user entries from Supabase:", error.message);
      const local = loadAuditTrailFromStorage();
      return local.filter(e => e.actor.userId === userId).slice(0, limit);
    }

    return data || [];
  } catch (err) {
    console.warn("[AuditTrail] Exception fetching user entries:", err);
    const local = loadAuditTrailFromStorage();
    return local.filter(e => e.actor.userId === userId).slice(0, limit);
  }
}

/**
 * Get audit entries for a specific action type.
 */
export async function getAuditEntriesForAction(
  action: SensitiveAction,
  limit: number = 50
): Promise<ImmutableAuditEntry[]> {
  if (!SUPABASE_CONFIG.isConfigured) {
    const local = loadAuditTrailFromStorage();
    return local.filter(e => e.action === action).slice(0, limit);
  }

  try {
    const { data, error } = await supabase
      .from("audit_log")
      .select("*")
      .eq("action", action)
      .order("timestampMs", { ascending: false })
      .limit(limit);

    if (error) {
      console.warn("[AuditTrail] Failed to fetch action entries from Supabase:", error.message);
      const local = loadAuditTrailFromStorage();
      return local.filter(e => e.action === action).slice(0, limit);
    }

    return data || [];
  } catch (err) {
    console.warn("[AuditTrail] Exception fetching action entries:", err);
    const local = loadAuditTrailFromStorage();
    return local.filter(e => e.action === action).slice(0, limit);
  }
}

// ── Compliance Helpers ───────────────────────────────────────────

/**
 * Generate a compliance report from audit entries.
 * Used for ISO 27001 evidence gathering.
 */
export async function generateComplianceReport(
  startDate: Date,
  endDate: Date
): Promise<{
  totalEntries: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  actorsInvolved: Set<string>;
  actionsPerformed: Map<string, number>;
  chainVerified: boolean;
}> {
  const entries = await getRecentAuditEntries(500);

  const filtered = entries.filter(e => {
    const ts = new Date(e.timestamp);
    return ts >= startDate && ts <= endDate;
  });

  const chainVerified = await verifyAuditChain(filtered);

  const report = {
    totalEntries: filtered.length,
    criticalCount: filtered.filter(e => e.severity === "critical").length,
    warningCount: filtered.filter(e => e.severity === "warning").length,
    infoCount: filtered.filter(e => e.severity === "info").length,
    actorsInvolved: new Set(filtered.map(e => e.actor.userId)),
    actionsPerformed: new Map<string, number>(),
    chainVerified,
  };

  // Count actions
  for (const entry of filtered) {
    const count = report.actionsPerformed.get(entry.action) || 0;
    report.actionsPerformed.set(entry.action, count + 1);
  }

  return report;
}
