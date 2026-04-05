// ═══════════════════════════════════════════════════════════════
// SOSphere — Continuous Offline GPS Tracker
// ─────────────────────────────────────────────────────────────
// Records GPS breadcrumbs even when completely offline.
// Workers in mines/desert/sea stay tracked:
//
//  • watchPosition() runs continuously in background
//  • Points stored in IndexedDB (survives app close)
//  • Battery-aware: reduces frequency on low battery
//  • Dead reckoning: estimates position when GPS is lost
//  • Configurable intervals per risk zone
//  • Auto-resumes on app restart
//
// This is the #1 life-saving feature — if a worker goes
// missing, their last GPS trail tells rescuers WHERE to look.
// ═══════════════════════════════════════════════════════════════

import { recordGPSPoint, recordGPSBatch, getGPSTrailCount, type GPSPoint } from "./offline-database";
import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";

// ── Configuration ──────────────────────────────────────────────

export interface GPSTrackerConfig {
  /** Recording interval in ms — default 15s, min 5s, max 300s */
  intervalMs: number;
  /** High accuracy mode (uses more battery but better in urban/indoor) */
  highAccuracy: boolean;
  /** Maximum age of cached position in ms */
  maximumAge: number;
  /** Timeout for position request in ms */
  timeout: number;
  /** Minimum distance (meters) to record a new point (dedup) */
  minDistanceMeters: number;
  /** Battery threshold to switch to power-saving mode (0-1) */
  batterySaveThreshold: number;
  /** Interval in power-saving mode */
  batterySaveIntervalMs: number;
  /** Enable dead reckoning when GPS is unavailable */
  deadReckoningEnabled: boolean;
  /** Employee ID for this tracker */
  employeeId: string;
}

const DEFAULT_CONFIG: GPSTrackerConfig = {
  intervalMs: 15000,          // 15 seconds
  highAccuracy: true,
  maximumAge: 10000,          // 10s
  timeout: 10000,             // 10s
  minDistanceMeters: 5,       // Don't record if moved less than 5m
  batterySaveThreshold: 0.2,  // 20% battery
  batterySaveIntervalMs: 60000, // 1 minute in save mode
  deadReckoningEnabled: true,
  employeeId: "EMP-001",
};

// ── Tracker State ──────────────────────────────────────────────

export interface GPSTrackerState {
  isTracking: boolean;
  lastPosition: { lat: number; lng: number; accuracy: number; timestamp: number } | null;
  totalPointsRecorded: number;
  unsyncedPoints: number;
  batteryLevel: number | null;
  isLowBattery: boolean;
  gpsAvailable: boolean;
  deadReckoningActive: boolean;
  currentInterval: number;
  errors: string[];
  startedAt: number | null;
  lastError: string | null;
}

type StateListener = (state: GPSTrackerState) => void;

// ── Singleton Tracker ──────────────────────────────────────────

let trackerState: GPSTrackerState = {
  isTracking: false,
  lastPosition: null,
  totalPointsRecorded: 0,
  unsyncedPoints: 0,
  batteryLevel: null,
  isLowBattery: false,
  gpsAvailable: "geolocation" in navigator,
  deadReckoningActive: false,
  currentInterval: DEFAULT_CONFIG.intervalMs,
  errors: [],
  startedAt: null,
  lastError: null,
};

let config = { ...DEFAULT_CONFIG };
let watchId: number | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let lastRecordedPosition: { lat: number; lng: number; timestamp: number } | null = null;
let lastSpeed: number | null = null;
let lastHeading: number | null = null;
let _batteryObj: any = null;
let _batteryHandler: (() => void) | null = null;
let stateListeners: StateListener[] = [];
let deadReckoningIntervalId: ReturnType<typeof setInterval> | null = null;

// ── Haversine Distance (meters) ────────────────────────────────

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── State Management ───────────────────────────────────────────

function updateState(partial: Partial<GPSTrackerState>) {
  trackerState = { ...trackerState, ...partial };
  stateListeners.forEach(fn => {
    try { fn(trackerState); } catch { /* ignore listener errors */ }
  });
}

export function subscribeToTracker(listener: StateListener): () => void {
  stateListeners.push(listener);
  // Immediately emit current state
  listener(trackerState);
  return () => {
    stateListeners = stateListeners.filter(fn => fn !== listener);
  };
}

export function getTrackerState(): GPSTrackerState {
  return { ...trackerState };
}

// ── FIX FATAL-1: Expose last known position for SOS to consume ──
// SOS was using hardcoded coords. Now it can call this to get real GPS.
export function getLastKnownPosition(): {
  lat: number; lng: number; accuracy: number; address: string;
} | null {
  if (trackerState.lastPosition) {
    return {
      lat: trackerState.lastPosition.lat,
      lng: trackerState.lastPosition.lng,
      accuracy: trackerState.lastPosition.accuracy,
      address: `GPS ${trackerState.lastPosition.lat.toFixed(5)}, ${trackerState.lastPosition.lng.toFixed(5)}`,
    };
  }
  // Fallback: check if we have a recorded position from before state init
  if (lastRecordedPosition) {
    return {
      lat: lastRecordedPosition.lat,
      lng: lastRecordedPosition.lng,
      accuracy: 9999,
      address: `Last recorded ${lastRecordedPosition.lat.toFixed(5)}, ${lastRecordedPosition.lng.toFixed(5)}`,
    };
  }
  return null;
}

// ── FIX FATAL-2: Expose battery level for SOS battery-critical detection ──
export function getBatteryLevel(): number | null {
  return trackerState.batteryLevel;
}

// ── Battery Monitoring ─────────────────────────────────────────

async function checkBattery(): Promise<void> {
  try {
    if ("getBattery" in navigator) {
      // Clean up previous listener to prevent memory leak
      if (_batteryObj && _batteryHandler) {
        _batteryObj.removeEventListener("levelchange", _batteryHandler);
      }

      const battery = await (navigator as any).getBattery();
      _batteryObj = battery;
      const level = battery.level;
      const isLow = level < config.batterySaveThreshold;
      updateState({
        batteryLevel: level,
        isLowBattery: isLow,
        currentInterval: isLow ? config.batterySaveIntervalMs : config.intervalMs,
      });

      // Listen for battery changes (single handler, stored for cleanup)
      _batteryHandler = () => {
        const newLevel = battery.level;
        const newIsLow = newLevel < config.batterySaveThreshold;
        updateState({
          batteryLevel: newLevel,
          isLowBattery: newIsLow,
          currentInterval: newIsLow ? config.batterySaveIntervalMs : config.intervalMs,
        });

        // Adjust tracking interval dynamically
        if (trackerState.isTracking && intervalId) {
          clearInterval(intervalId);
          intervalId = setInterval(recordCurrentPosition, newIsLow ? config.batterySaveIntervalMs : config.intervalMs);
        }
      };
      battery.addEventListener("levelchange", _batteryHandler);
    }
  } catch {
    // Battery API not available — continue normally
  }
}

// ── Record Position ────────────────────────────────────────────

async function processPosition(position: GeolocationPosition): Promise<void> {
  const { latitude: lat, longitude: lng, accuracy, altitude, speed, heading } = position.coords;
  const timestamp = position.timestamp;

  // Update last known speed/heading for dead reckoning
  if (speed !== null) lastSpeed = speed;
  if (heading !== null) lastHeading = heading;

  // Deduplication: skip if moved less than minDistance
  if (lastRecordedPosition) {
    const dist = haversineDistance(lastRecordedPosition.lat, lastRecordedPosition.lng, lat, lng);
    if (dist < config.minDistanceMeters) {
      // Update position display but don't store
      updateState({
        lastPosition: { lat, lng, accuracy, timestamp },
        gpsAvailable: true,
        deadReckoningActive: false,
      });
      return;
    }
  }

  // Store in IndexedDB
  try {
    await recordGPSPoint({
      employeeId: config.employeeId,
      lat,
      lng,
      altitude: altitude,
      accuracy,
      speed: speed,
      heading: heading,
      timestamp,
      batteryLevel: trackerState.batteryLevel,
      source: "gps",
    });

    lastRecordedPosition = { lat, lng, timestamp };

    const counts = await getGPSTrailCount();
    updateState({
      lastPosition: { lat, lng, accuracy, timestamp },
      totalPointsRecorded: counts.total,
      unsyncedPoints: counts.unsynced,
      gpsAvailable: true,
      deadReckoningActive: false,
      lastError: null,
    });

    // Background sync to Supabase (non-blocking)
    syncPointToSupabase({
      employeeId: config.employeeId,
      lat, lng, accuracy,
      altitude, speed, heading,
      timestamp,
      batteryLevel: trackerState.batteryLevel,
      source: "gps",
    });
  } catch (err) {
    const errMsg = `Storage error: ${err}`;
    updateState({
      lastError: errMsg,
      errors: [...trackerState.errors.slice(-9), errMsg],
    });
  }
}

// ── Supabase Sync (background, non-blocking) ─────────────────
let _syncBuffer: any[] = [];
let _syncTimer: ReturnType<typeof setTimeout> | null = null;

function syncPointToSupabase(point: any): void {
  if (!SUPABASE_CONFIG.isConfigured) return;

  _syncBuffer.push({
    employee_id: point.employeeId,
    lat: point.lat,
    lng: point.lng,
    accuracy: point.accuracy,
    altitude: point.altitude,
    speed: point.speed,
    heading: point.heading,
    battery_level: point.batteryLevel,
    source: point.source || "gps",
    recorded_at: new Date(point.timestamp).toISOString(),
  });

  // Batch sync every 30 seconds (reduce API calls)
  if (!_syncTimer) {
    _syncTimer = setTimeout(async () => {
      const batch = [..._syncBuffer];
      _syncBuffer = [];
      _syncTimer = null;

      if (batch.length === 0) return;

      try {
        const { error } = await supabase.from("gps_trail").insert(batch);
        if (error) throw error;
        console.log(`[GPS] Synced ${batch.length} points to Supabase`);
      } catch (e) {
        console.warn("[GPS] Supabase sync failed, points saved locally:", e);
        // Points are already in IndexedDB — they'll sync later
      }
    }, 30000);
  }
}

/** Force sync all buffered points immediately (call on app close) */
export async function flushGPSSync(): Promise<void> {
  if (!SUPABASE_CONFIG.isConfigured || _syncBuffer.length === 0) return;
  const batch = [..._syncBuffer];
  _syncBuffer = [];
  if (_syncTimer) { clearTimeout(_syncTimer); _syncTimer = null; }
  try {
    await supabase.from("gps_trail").insert(batch);
    console.log(`[GPS] Flushed ${batch.length} points to Supabase`);
  } catch (e) {
    console.warn("[GPS] Flush failed:", e);
  }
}

function handlePositionError(error: GeolocationPositionError): void {
  const errMsg = `GPS Error [${error.code}]: ${error.message}`;
  updateState({
    gpsAvailable: false,
    lastError: errMsg,
    errors: [...trackerState.errors.slice(-9), errMsg],
  });

  // Activate dead reckoning if enabled
  if (config.deadReckoningEnabled && lastRecordedPosition && lastSpeed !== null) {
    startDeadReckoning();
  }
}

function recordCurrentPosition(): void {
  if (!("geolocation" in navigator)) return;

  navigator.geolocation.getCurrentPosition(
    processPosition,
    handlePositionError,
    {
      enableHighAccuracy: trackerState.isLowBattery ? false : config.highAccuracy,
      maximumAge: config.maximumAge,
      timeout: config.timeout,
    }
  );
}

// ── Dead Reckoning ─────────────────────────────────────────────
// When GPS is lost (tunnel, mine, building), estimate position
// based on last known speed + heading

function startDeadReckoning(): void {
  if (deadReckoningIntervalId) return;
  if (!lastRecordedPosition || lastSpeed === null || lastHeading === null) return;

  updateState({ deadReckoningActive: true });

  deadReckoningIntervalId = setInterval(async () => {
    if (!lastRecordedPosition || lastSpeed === null || lastHeading === null) {
      stopDeadReckoning();
      return;
    }

    // Estimate new position based on speed + heading
    const elapsedSec = (Date.now() - lastRecordedPosition.timestamp) / 1000;
    const distanceMoved = lastSpeed * elapsedSec; // meters

    // Convert distance + heading to lat/lng delta
    const R = 6371000;
    const headingRad = (lastHeading * Math.PI) / 180;
    const dLat = (distanceMoved * Math.cos(headingRad)) / R;
    const dLng = (distanceMoved * Math.sin(headingRad)) / (R * Math.cos((lastRecordedPosition.lat * Math.PI) / 180));

    const estLat = lastRecordedPosition.lat + (dLat * 180) / Math.PI;
    const estLng = lastRecordedPosition.lng + (dLng * 180) / Math.PI;

    try {
      await recordGPSPoint({
        employeeId: config.employeeId,
        lat: estLat,
        lng: estLng,
        altitude: null,
        accuracy: 500 + elapsedSec * 2, // Accuracy degrades over time
        speed: lastSpeed,
        heading: lastHeading,
        timestamp: Date.now(),
        batteryLevel: trackerState.batteryLevel,
        source: "dead_reckoning",
      });

      const counts = await getGPSTrailCount();
      updateState({
        lastPosition: { lat: estLat, lng: estLng, accuracy: 500 + elapsedSec * 2, timestamp: Date.now() },
        totalPointsRecorded: counts.total,
        unsyncedPoints: counts.unsynced,
      });
    } catch { /* ignore storage errors during dead reckoning */ }
  }, config.intervalMs * 2); // Dead reckoning at half the normal rate
}

function stopDeadReckoning(): void {
  if (deadReckoningIntervalId) {
    clearInterval(deadReckoningIntervalId);
    deadReckoningIntervalId = null;
  }
  updateState({ deadReckoningActive: false });
}

// ═══════════════════════════════════════════════════════════════
// Public API — Start / Stop / Configure
// ═══════════════════════════════════════════════════════════════

export function startGPSTracking(userConfig?: Partial<GPSTrackerConfig>): boolean {
  if (trackerState.isTracking) return true;
  if (!("geolocation" in navigator)) {
    updateState({ gpsAvailable: false, lastError: "Geolocation API not available" });
    return false;
  }

  // Apply config
  config = { ...DEFAULT_CONFIG, ...userConfig };

  // Check battery
  checkBattery();

  // Start watchPosition for real-time updates
  watchId = navigator.geolocation.watchPosition(
    processPosition,
    handlePositionError,
    {
      enableHighAccuracy: config.highAccuracy,
      maximumAge: config.maximumAge,
      timeout: config.timeout,
    }
  );

  // Also record at fixed intervals (watchPosition may not fire if stationary)
  intervalId = setInterval(recordCurrentPosition, config.intervalMs);

  // Record immediately
  recordCurrentPosition();

  updateState({
    isTracking: true,
    startedAt: Date.now(),
    currentInterval: config.intervalMs,
    lastError: null,
  });

  console.log("[GPSTracker] Started tracking, interval:", config.intervalMs, "ms");
  return true;
}

export function stopGPSTracking(): void {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  stopDeadReckoning();

  // Clean up battery listener to prevent memory leak
  if (_batteryObj && _batteryHandler) {
    _batteryObj.removeEventListener("levelchange", _batteryHandler);
    _batteryHandler = null;
  }

  updateState({
    isTracking: false,
    startedAt: null,
  });

  console.log("[GPSTracker] Stopped tracking");
}

export function updateTrackerConfig(newConfig: Partial<GPSTrackerConfig>): void {
  config = { ...config, ...newConfig };

  // If tracking, restart with new config
  if (trackerState.isTracking) {
    stopGPSTracking();
    startGPSTracking(config);
  }
}

// ── Zone-Based Configuration Presets ───────────────────────────

export const ZONE_PRESETS: Record<string, Partial<GPSTrackerConfig>> = {
  /** High-risk zones: mines, offshore, construction — track every 5s */
  critical: {
    intervalMs: 5000,
    highAccuracy: true,
    minDistanceMeters: 2,
    deadReckoningEnabled: true,
  },
  /** Medium-risk: remote fieldwork, patrols — track every 15s */
  high: {
    intervalMs: 15000,
    highAccuracy: true,
    minDistanceMeters: 5,
    deadReckoningEnabled: true,
  },
  /** Standard: office adjacent, urban — track every 30s */
  standard: {
    intervalMs: 30000,
    highAccuracy: false,
    minDistanceMeters: 10,
    deadReckoningEnabled: false,
  },
  /** Low-risk: office workers with outdoor tasks — track every 60s */
  low: {
    intervalMs: 60000,
    highAccuracy: false,
    minDistanceMeters: 20,
    deadReckoningEnabled: false,
  },
};

// ── Emergency Override ─────────────────────────────────────────
// When SOS is triggered, switch to maximum tracking frequency

export function activateEmergencyTracking(): void {
  updateTrackerConfig({
    intervalMs: 3000,       // Every 3 seconds
    highAccuracy: true,
    minDistanceMeters: 1,   // Record every meter
    deadReckoningEnabled: true,
    batterySaveThreshold: 0, // Ignore battery saving during emergency
  });
  console.log("[GPSTracker] EMERGENCY MODE: tracking every 3s");
}

export function deactivateEmergencyTracking(): void {
  updateTrackerConfig({
    intervalMs: DEFAULT_CONFIG.intervalMs,
    highAccuracy: DEFAULT_CONFIG.highAccuracy,
    minDistanceMeters: DEFAULT_CONFIG.minDistanceMeters,
    deadReckoningEnabled: DEFAULT_CONFIG.deadReckoningEnabled,
    batterySaveThreshold: DEFAULT_CONFIG.batterySaveThreshold,
  });
  console.log("[GPSTracker] Emergency mode deactivated, normal tracking resumed");
}