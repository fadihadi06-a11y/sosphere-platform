// ═══════════════════════════════════════════════════════════════
// SOSphere — Privacy Obfuscation Engine
// ─────────────────────────────────────────────────────────────
// Automatically obfuscates historical location data older than 24 hours.
//
// Strategy:
//  1. Every 15 minutes, scan IndexedDB gps_trail for records older than 24h
//  2. For each old record:
//     a. Round lat/lng to 2 decimal places (~1.1km precision) — enough for
//        general area but not exact location
//     b. Remove altitude, speed, heading (precise movement data)
//     c. Set accuracy to 9999 (indicates obfuscated)
//     d. Add obfuscated_at timestamp
//     e. Encrypt the original data and move to cold_storage store
//  3. Cold storage is double-encrypted (app key + per-record key)
//  4. Cold storage auto-deletes after 90 days (configurable retention)
//  5. During active SOS, obfuscation is PAUSED (need precise trail for rescue)
//
// GDPR compliance: This implements data minimization (Art. 5(1)(c))
// and storage limitation (Art. 5(1)(e)).
// ═══════════════════════════════════════════════════════════════

import {
  openDB as getDB,
  getUnsyncedGPS,
  type GPSPoint,
  encryptData,
  saveColdLocationRecord,
  deleteColdLocationRecord,
  getColdLocationRecordsExpiredBefore,
  deleteColdLocationRecordsBulk,
} from "./offline-database";
import { reportError } from "./error-boundary";

// ── Configuration ──────────────────────────────────────────────

export interface ObfuscationConfig {
  obfuscateAfterMs: number;      // 24h default (86400000)
  coldRetentionMs: number;       // 90 days default
  scanIntervalMs: number;        // 15 min default
  precisionDecimals: number;     // 2 = ~1.1km, 3 = ~111m
  pauseDuringSos: boolean;       // true — never obfuscate during emergency
  enabled: boolean;              // feature flag
}

// ── Statistics ─────────────────────────────────────────────────

export interface ObfuscationStats {
  lastScanAt: number | null;
  totalObfuscated: number;
  totalColdPurged: number;
  isRunning: boolean;
  isPausedForSos: boolean;
  nextScanAt: number | null;
}

// ── Event Listeners ────────────────────────────────────────────

type ObfuscationEventCallback = (event: { type: string; count: number }) => void;

// ── Internal State ─────────────────────────────────────────────

let _config: ObfuscationConfig = {
  obfuscateAfterMs: 86400000,  // 24 hours
  coldRetentionMs: 7776000000, // 90 days
  scanIntervalMs: 900000,      // 15 minutes
  precisionDecimals: 2,
  pauseDuringSos: true,
  enabled: true,
};

let _stats: ObfuscationStats = {
  lastScanAt: null,
  totalObfuscated: 0,
  totalColdPurged: 0,
  isRunning: false,
  isPausedForSos: false,
  nextScanAt: null,
};

let _scanIntervalId: ReturnType<typeof setInterval> | null = null;
let _eventListeners: ObfuscationEventCallback[] = [];

// ── Helper: Round coordinates to specified decimal places ──────

function roundCoordinate(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// ── Helper: Emit events to listeners ───────────────────────────

function emitEvent(type: string, count: number): void {
  for (const cb of _eventListeners) {
    try {
      cb({ type, count });
    } catch (err) {
      console.warn("[PrivacyObfuscator] Event listener error:", err);
    }
  }
}

// ── Core Obfuscation Logic ─────────────────────────────────────

async function performObfuscationScan(): Promise<number> {
  if (!_config.enabled || _stats.isPausedForSos) {
    return 0;
  }

  if (_stats.isRunning) {
    console.warn("[PrivacyObfuscator] Scan already in progress, skipping");
    return 0;
  }

  _stats.isRunning = true;
  let obfuscatedCount = 0;

  try {
    const now = Date.now();
    const cutoffTime = now - _config.obfuscateAfterMs;

    // Get database instance
    const db = await (getDB as any)();

    // Open a read-write transaction on gps_trail
    return new Promise<number>((resolve) => {
      const tx = db.transaction("gps_trail", "readwrite");
      const store = tx.objectStore("gps_trail");
      const index = store.index("by_timestamp");

      // Query all records older than cutoffTime
      const range = IDBKeyRange.upperBound(cutoffTime, false);
      const req = index.getAll(range);

      req.onsuccess = async () => {
        const recordsToObfuscate: GPSPoint[] = req.result || [];

        for (const record of recordsToObfuscate) {
          // Skip if already obfuscated
          if ((record as any).obfuscated_at) {
            continue;
          }

          try {
            // Create cold storage copy with original data encrypted
            const originalDataJson = JSON.stringify({
              lat: record.lat,
              lng: record.lng,
              altitude: record.altitude,
              speed: record.speed,
              heading: record.heading,
              accuracy: record.accuracy,
              timestamp: record.timestamp,
            });

            const encryptedData = await encryptData(originalDataJson);

            const coldRecord = {
              id: record.id,
              originalDataEncrypted: encryptedData,
              obfuscatedAt: now,
              expiresAt: now + _config.coldRetentionMs,
            };

            await saveColdLocationRecord(coldRecord);

            // Modify the GPS trail record in-place
            const obfuscatedRecord = {
              ...record,
              lat: roundCoordinate(record.lat, _config.precisionDecimals),
              lng: roundCoordinate(record.lng, _config.precisionDecimals),
              altitude: null,
              speed: null,
              heading: null,
              accuracy: 9999, // Indicates obfuscated
              obfuscated_at: now,
            };

            store.put(obfuscatedRecord);
            obfuscatedCount++;
          } catch (err) {
            reportError(
              `Failed to obfuscate GPS record ${record.id}: ${err}`,
              { recordId: record.id, component: "PrivacyObfuscator" },
              "warning"
            );
          }
        }

        // After obfuscation, purge expired cold storage records
        let purgedCount = 0;
        try {
          const expiredRecords = await getColdLocationRecordsExpiredBefore(now);
          if (expiredRecords.length > 0) {
            const ids = expiredRecords.map((r) => r.id);
            await deleteColdLocationRecordsBulk(ids);
            purgedCount = ids.length;
            _stats.totalColdPurged += purgedCount;
            emitEvent("cold_purged", purgedCount);
          }
        } catch (err) {
          reportError(
            `Failed to purge expired cold storage: ${err}`,
            { component: "PrivacyObfuscator" },
            "warning"
          );
        }

        _stats.lastScanAt = now;
        _stats.totalObfuscated += obfuscatedCount;
        _stats.nextScanAt = now + _config.scanIntervalMs;
        _stats.isRunning = false;

        if (obfuscatedCount > 0) {
          console.log(
            `[PrivacyObfuscator] Obfuscated ${obfuscatedCount} GPS records (${purgedCount} cold records purged)`
          );
          emitEvent("obfuscated", obfuscatedCount);
        }

        resolve(obfuscatedCount);
      };

      req.onerror = () => {
        _stats.isRunning = false;
        reportError(
          `IndexedDB query failed in obfuscation scan: ${req.error}`,
          { component: "PrivacyObfuscator" },
          "error"
        );
        resolve(0);
      };

      tx.onerror = () => {
        _stats.isRunning = false;
        reportError(
          `Transaction error in obfuscation scan: ${tx.error}`,
          { component: "PrivacyObfuscator" },
          "error"
        );
        resolve(0);
      };
    });
  } catch (err) {
    _stats.isRunning = false;
    reportError(
      `Obfuscation scan failed: ${err}`,
      { component: "PrivacyObfuscator" },
      "error"
    );
    return 0;
  }
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Initialize the privacy obfuscator with optional config overrides.
 * Starts the periodic scan timer.
 */
export function initPrivacyObfuscator(
  config?: Partial<ObfuscationConfig>
): void {
  if (config) {
    _config = { ..._config, ...config };
  }

  if (!_config.enabled) {
    console.log("[PrivacyObfuscator] Disabled via configuration");
    return;
  }

  // Stop any existing scan
  if (_scanIntervalId !== null) {
    clearInterval(_scanIntervalId);
  }

  // Start periodic scan
  _scanIntervalId = setInterval(() => {
    performObfuscationScan().catch((err) => {
      reportError(
        `Periodic obfuscation scan error: ${err}`,
        { component: "PrivacyObfuscator" },
        "error"
      );
    });
  }, _config.scanIntervalMs);

  _stats.nextScanAt = Date.now() + _config.scanIntervalMs;

  console.log(
    `[PrivacyObfuscator] Initialized with scan interval ${_config.scanIntervalMs}ms`
  );
}

/**
 * Pause obfuscation (called when SOS is active).
 * Prevents data loss during emergency rescue operations.
 */
export function pauseObfuscation(): void {
  _stats.isPausedForSos = true;
  console.log("[PrivacyObfuscator] Paused for active SOS");
}

/**
 * Resume obfuscation after SOS is resolved.
 */
export function resumeObfuscation(): void {
  _stats.isPausedForSos = false;
  console.log("[PrivacyObfuscator] Resumed after SOS resolution");
}

/**
 * Get current obfuscation statistics.
 */
export function getObfuscationStats(): ObfuscationStats {
  return { ..._stats };
}

/**
 * Force an immediate obfuscation scan (instead of waiting for timer).
 * Returns the number of records obfuscated.
 */
export async function forceObfuscationScan(): Promise<number> {
  return performObfuscationScan();
}

/**
 * Manually purge cold storage records older than specified age.
 * If olderThanMs is not provided, uses configured coldRetentionMs.
 * Returns the number of records deleted.
 */
export async function purgeColdStorage(olderThanMs?: number): Promise<number> {
  const retentionMs = olderThanMs ?? _config.coldRetentionMs;
  const cutoffTime = Date.now() - retentionMs;

  try {
    const expiredRecords = await getColdLocationRecordsExpiredBefore(cutoffTime);
    if (expiredRecords.length === 0) {
      return 0;
    }

    const ids = expiredRecords.map((r) => r.id);
    await deleteColdLocationRecordsBulk(ids);
    _stats.totalColdPurged += ids.length;

    console.log(
      `[PrivacyObfuscator] Purged ${ids.length} cold storage records`
    );
    emitEvent("cold_purged", ids.length);

    return ids.length;
  } catch (err) {
    reportError(
      `Failed to purge cold storage: ${err}`,
      { component: "PrivacyObfuscator" },
      "error"
    );
    return 0;
  }
}

/**
 * Subscribe to obfuscation events (obfuscated, cold_purged).
 * Returns an unsubscribe function.
 */
export function onObfuscationEvent(
  cb: ObfuscationEventCallback
): () => void {
  _eventListeners.push(cb);
  return () => {
    const idx = _eventListeners.indexOf(cb);
    if (idx >= 0) {
      _eventListeners.splice(idx, 1);
    }
  };
}

/**
 * Shutdown the privacy obfuscator (call on app unload).
 */
export function shutdownPrivacyObfuscator(): void {
  if (_scanIntervalId !== null) {
    clearInterval(_scanIntervalId);
    _scanIntervalId = null;
  }
  _eventListeners = [];
  console.log("[PrivacyObfuscator] Shutdown complete");
}
