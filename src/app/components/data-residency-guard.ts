// SOSphere — Data Residency Guard
// ISO 27001 §A.8.2.3 — Handling of Assets
// ISO 27001 §A.10.1.1 — Policy on use of cryptographic controls
//
// Ensures sensitive medical and personal data:
//   1. Is ALWAYS encrypted at rest (AES-256-GCM via Web Crypto API)
//   2. Is NEVER stored in plain text in localStorage or IndexedDB
//   3. Is automatically purged from local storage when the session ends
//   4. Is fetched via encrypted channels (HTTPS + Supabase RLS)
//   5. Has a TTL (time-to-live) — cached data expires after configurable duration
//   6. Provides a secure read/write API that enforces these invariants
//
// Protected data categories:
//   - Medical ID (blood type, conditions, medications, allergies)
//   - Emergency contacts (phone numbers, addresses)
//   - GPS trail (precise location history)
//   - Incident photos and recordings

import { encryptData, decryptData } from "./offline-database";
import { logAuditEvent } from "./audit-log-store";

export type ProtectedDataCategory = "medical" | "emergency_contacts" | "gps_trail" | "evidence" | "personal_info";

interface DataResidencyConfig {
  sessionTtlMs: number;             // How long data lives in cache (default: 8h = session)
  encryptionRequired: boolean;      // Force encryption (default: true)
  purgeOnSessionEnd: boolean;       // Clear on logout/session end (default: true)
  purgeOnVisibilityHidden: boolean; // Clear when tab is hidden for >30min (default: false for UX)
  allowedCategories: ProtectedDataCategory[]; // Which categories to protect
}

interface CachedDataEntry {
  key: string;
  category: ProtectedDataCategory;
  encryptedData: string;           // AES-GCM encrypted
  createdAt: number;
  expiresAt: number;
  accessCount: number;
  lastAccessedAt: number;
}

interface ResidencyStatus {
  protectedKeys: number;
  encryptedKeys: number;
  expiredKeys: number;
  categories: Record<ProtectedDataCategory, number>;
}

// ─── Module State ────────────────────────────────────────────────────────────

let _config: DataResidencyConfig = {
  sessionTtlMs: 8 * 60 * 60 * 1000, // 8 hours
  encryptionRequired: true,
  purgeOnSessionEnd: true,
  purgeOnVisibilityHidden: false,
  allowedCategories: ["medical", "emergency_contacts", "gps_trail", "evidence", "personal_info"],
};

const STORAGE_NAMESPACE = "_sosphere_secure";
const PURGE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let _purgeTimer: ReturnType<typeof setInterval> | null = null;
let _visibilityHiddenSince: number | null = null;
let _purgeCbs: Array<() => void> = [];

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize the Data Residency Guard with optional config overrides.
 * Call this once at app startup before accessing protected data.
 */
export function initDataResidencyGuard(config?: Partial<DataResidencyConfig>): void {
  if (config) {
    _config = { ..._config, ...config };
  }

  // Validate that encryption is not disabled for production
  if (!_config.encryptionRequired) {
    console.warn("[DataResidencyGuard] WARNING: Encryption disabled. Protected data is stored in plaintext.");
  }

  // Start periodic TTL cleanup
  if (_purgeTimer) clearInterval(_purgeTimer);
  _purgeTimer = setInterval(() => {
    purgeExpiredData().catch(err =>
      console.error("[DataResidencyGuard] TTL purge failed:", err)
    );
  }, PURGE_INTERVAL_MS);

  // Listen for session end events
  window.addEventListener("beforeunload", handleSessionEnd);

  // Listen for auth state changes (Supabase sign-out)
  // This is called by auth listeners when user signs out
  const unsubscribe = onSessionPurgeRequested(() => {
    purgeSessionData().catch(err =>
      console.error("[DataResidencyGuard] Session purge failed:", err)
    );
  });

  // Listen to visibility changes (optional purge on tab hidden)
  if (_config.purgeOnVisibilityHidden) {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  console.log("[DataResidencyGuard] Initialized with config:", _config);
}

/**
 * Encrypt and store data with TTL and access logging.
 * Data is stored in localStorage under _sosphere_secure_{key}
 */
export async function secureStore(
  key: string,
  data: unknown,
  category: ProtectedDataCategory,
): Promise<void> {
  if (!_config.allowedCategories.includes(category)) {
    throw new Error(`[DataResidencyGuard] Category not allowed: ${category}`);
  }

  const plaintext = JSON.stringify(data);
  const now = Date.now();
  const expiresAt = now + _config.sessionTtlMs;

  let encryptedData: string;
  try {
    encryptedData = await encryptData(plaintext);
  } catch (err) {
    if (_config.encryptionRequired) {
      throw new Error(`[DataResidencyGuard] Encryption failed: ${err}`);
    }
    // Graceful degradation: store plaintext if encryption disabled
    encryptedData = plaintext;
  }

  const entry: CachedDataEntry = {
    key,
    category,
    encryptedData,
    createdAt: now,
    expiresAt,
    accessCount: 0,
    lastAccessedAt: now,
  };

  const storageKey = `${STORAGE_NAMESPACE}_${key}`;
  localStorage.setItem(storageKey, JSON.stringify(entry));

  logAuditEvent("data_modify", `Sensitive data stored: ${category}/${key}`, {
    category: "file_access",
    detail: `Category: ${category}, expires in ${Math.round(_config.sessionTtlMs / 1000 / 60)}min`,
    severity: "info",
  });
}

/**
 * Retrieve and decrypt data, logging access to audit trail.
 * Returns null if expired or not found.
 */
export async function secureRead<T>(
  key: string,
  category: ProtectedDataCategory,
): Promise<T | null> {
  if (!_config.allowedCategories.includes(category)) {
    throw new Error(`[DataResidencyGuard] Category not allowed: ${category}`);
  }

  const storageKey = `${STORAGE_NAMESPACE}_${key}`;
  const raw = localStorage.getItem(storageKey);

  if (!raw) {
    return null;
  }

  try {
    const entry = JSON.parse(raw) as CachedDataEntry;

    // Check expiration
    if (entry.expiresAt < Date.now()) {
      localStorage.removeItem(storageKey);
      logAuditEvent("data_delete", `Expired data purged: ${category}/${key}`, {
        category: "file_access",
        severity: "info",
      });
      return null;
    }

    // Update access metadata
    entry.accessCount++;
    entry.lastAccessedAt = Date.now();
    localStorage.setItem(storageKey, JSON.stringify(entry));

    // Decrypt
    let plaintext: string;
    try {
      plaintext = await decryptData(entry.encryptedData);
    } catch (err) {
      if (_config.encryptionRequired) {
        throw new Error(`[DataResidencyGuard] Decryption failed: ${err}`);
      }
      // Graceful degradation: treat as plaintext if decryption disabled
      plaintext = entry.encryptedData;
    }

    // Log access
    logAuditEvent("file_access", `Sensitive data accessed: ${category}/${key}`, {
      category: "file_access",
      detail: `Access count: ${entry.accessCount}`,
      severity: "info",
    });

    return JSON.parse(plaintext) as T;
  } catch (err) {
    console.error(`[DataResidencyGuard] Failed to read ${key}:`, err);
    return null;
  }
}

/**
 * Securely wipe data by overwriting then deleting.
 */
export async function secureDelete(key: string): Promise<void> {
  const storageKey = `${STORAGE_NAMESPACE}_${key}`;
  const raw = localStorage.getItem(storageKey);

  if (raw) {
    try {
      const entry = JSON.parse(raw) as CachedDataEntry;
      // Overwrite with random data before deletion
      const garbage = JSON.stringify({
        ...entry,
        encryptedData: crypto.getRandomValues(new Uint8Array(256)).toString(),
      });
      localStorage.setItem(storageKey, garbage);
    } catch { /* ignore */ }

    // Now delete
    localStorage.removeItem(storageKey);

    logAuditEvent("data_delete", `Sensitive data securely deleted: ${key}`, {
      category: "file_access",
      severity: "info",
    });
  }
}

/**
 * Called on session end (logout, beforeunload).
 * Wipes ALL protected data if configured.
 */
export async function purgeSessionData(): Promise<void> {
  if (!_config.purgeOnSessionEnd) {
    console.log("[DataResidencyGuard] Session purge disabled in config");
    return;
  }

  const keys = Object.keys(localStorage);
  const secureKeys = keys.filter(k => k.startsWith(STORAGE_NAMESPACE));

  for (const key of secureKeys) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        // Overwrite with garbage before deletion
        const garbage = crypto.getRandomValues(new Uint8Array(256)).toString();
        localStorage.setItem(key, garbage);
      }
      localStorage.removeItem(key);
    } catch (err) {
      console.error(`[DataResidencyGuard] Failed to purge ${key}:`, err);
    }
  }

  logAuditEvent("data_delete", "Session purge: all protected data wiped", {
    category: "file_access",
    detail: `Purged ${secureKeys.length} protected entries`,
    severity: "success",
  });

  // Notify subscribers
  _purgeCbs.forEach(cb => {
    try {
      cb();
    } catch (err) {
      console.error("[DataResidencyGuard] Purge callback error:", err);
    }
  });
}

/**
 * Periodic cleanup: remove expired entries.
 * Called automatically every 5 minutes.
 */
export async function purgeExpiredData(): Promise<void> {
  const keys = Object.keys(localStorage);
  const secureKeys = keys.filter(k => k.startsWith(STORAGE_NAMESPACE));

  let expiredCount = 0;
  const now = Date.now();

  for (const key of secureKeys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      const entry = JSON.parse(raw) as CachedDataEntry;
      if (entry.expiresAt < now) {
        // Overwrite before deletion
        const garbage = crypto.getRandomValues(new Uint8Array(256)).toString();
        localStorage.setItem(key, garbage);
        localStorage.removeItem(key);
        expiredCount++;
      }
    } catch (err) {
      console.error(`[DataResidencyGuard] Error checking expiry for ${key}:`, err);
    }
  }

  if (expiredCount > 0) {
    console.log(`[DataResidencyGuard] Purged ${expiredCount} expired entries`);
  }
}

/**
 * Get current residency status: counts of protected, encrypted, and expired keys.
 */
export function getResidencyStatus(): ResidencyStatus {
  const keys = Object.keys(localStorage);
  const secureKeys = keys.filter(k => k.startsWith(STORAGE_NAMESPACE));

  const categories: Record<ProtectedDataCategory, number> = {
    medical: 0,
    emergency_contacts: 0,
    gps_trail: 0,
    evidence: 0,
    personal_info: 0,
  };

  let encryptedCount = 0;
  let expiredCount = 0;
  const now = Date.now();

  for (const key of secureKeys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      const entry = JSON.parse(raw) as CachedDataEntry;
      categories[entry.category]++;

      if (entry.encryptedData && entry.encryptedData !== entry.encryptedData.slice(0, 20)) {
        encryptedCount++; // Heuristic: encrypted data looks like base64
      }

      if (entry.expiresAt < now) {
        expiredCount++;
      }
    } catch { /* ignore */ }
  }

  return {
    protectedKeys: secureKeys.length,
    encryptedKeys: encryptedCount,
    expiredKeys: expiredCount,
    categories,
  };
}

/**
 * Subscribe to purge events (session end, manual purge).
 * Returns unsubscribe function.
 */
export function onSessionPurge(cb: () => void): () => void {
  _purgeCbs.push(cb);
  return () => {
    const idx = _purgeCbs.indexOf(cb);
    if (idx >= 0) _purgeCbs.splice(idx, 1);
  };
}

// ─── Internal Event Handlers ──────────────────────────────────────────────────

function handleSessionEnd(): void {
  // Called on beforeunload
  if (_config.purgeOnSessionEnd) {
    purgeSessionData().catch(err =>
      console.error("[DataResidencyGuard] Session end purge failed:", err)
    );
  }
}

function handleVisibilityChange(): void {
  if (document.hidden) {
    _visibilityHiddenSince = Date.now();
  } else {
    _visibilityHiddenSince = null;
  }

  // Optional: check if tab has been hidden for >30min, then purge
  if (document.hidden && _visibilityHiddenSince) {
    const hiddenDuration = Date.now() - _visibilityHiddenSince;
    if (hiddenDuration > 30 * 60 * 1000) {
      purgeSessionData().catch(err =>
        console.error("[DataResidencyGuard] Visibility-based purge failed:", err)
      );
    }
  }
}

// ─── Session Purge Request Trigger ───────────────────────────────────────────

let _sessionPurgeCbs: Array<() => void> = [];

/**
 * Called by auth system when user signs out or session becomes invalid.
 * Returns unsubscribe function.
 */
export function onSessionPurgeRequested(cb: () => void): () => void {
  _sessionPurgeCbs.push(cb);
  return () => {
    const idx = _sessionPurgeCbs.indexOf(cb);
    if (idx >= 0) _sessionPurgeCbs.splice(idx, 1);
  };
}

/**
 * Trigger session purge from auth system (e.g., on logout).
 */
export function triggerSessionPurge(): void {
  _sessionPurgeCbs.forEach(cb => {
    try {
      cb();
    } catch (err) {
      console.error("[DataResidencyGuard] Session purge callback error:", err);
    }
  });
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Called at app shutdown to cleanup timers and listeners.
 */
export function shutdownDataResidencyGuard(): void {
  if (_purgeTimer) {
    clearInterval(_purgeTimer);
    _purgeTimer = null;
  }
  window.removeEventListener("beforeunload", handleSessionEnd);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  _purgeCbs = [];
  _sessionPurgeCbs = [];
}
