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
  /** GPS interval when user is stationary (default: 2min = 120000ms) */
  stationaryIntervalMs: number;
  /** Acceleration std dev threshold to detect motion (default: 0.3 m/s²) */
  motionThreshold: number;
  /** Milliseconds without motion before switching to stationary (default: 30000 = 30s) */
  stationaryDelayMs: number;
  /** Enable motion-aware GPS frequency reduction */
  motionAwareEnabled: boolean;
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
  stationaryIntervalMs: 120000, // 2 minutes when stationary
  motionThreshold: 0.3,       // m/s² std dev threshold
  stationaryDelayMs: 30000,   // 30 seconds of no motion to declare stationary
  motionAwareEnabled: true,   // Enable by default
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
  // Motion-aware fields
  motionState: "moving" | "stationary" | "unknown";
  motionAwareActive: boolean;
  lastMotionDetected: number | null;
  estimatedBatterySavedPct: number;
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
  motionState: "unknown",
  motionAwareActive: false,
  lastMotionDetected: null,
  estimatedBatterySavedPct: 0,
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

// ── Motion-Aware Tracking ──────────────────────────────────────
let _motionHandler: ((event: DeviceMotionEvent) => void) | null = null;
let _motionAccelerations: number[] = []; // Rolling 5-second window of acceleration magnitudes
let _lastMotionCheckTime: number = 0;
let _stationaryStartTime: number | null = null;
let _sosActive: boolean = false; // Flag to prevent motion-aware from reducing SOS frequency

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

// ── Motion Detection via DeviceMotion API ──────────────────────
// Calculates acceleration magnitude and maintains rolling window
// for motion state detection (stationary vs moving)

function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function startMotionDetection(): void {
  if (!config.motionAwareEnabled || _motionHandler) return;
  if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) return;

  _motionHandler = (event: DeviceMotionEvent) => {
    const acc = event.acceleration;
    if (!acc) return;

    // Calculate total acceleration magnitude: sqrt(x² + y² + z²)
    const magnitude = Math.sqrt(
      (acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2
    );

    // Maintain rolling 5-second window (at ~60Hz events, ~300 samples)
    _motionAccelerations.push(magnitude);
    if (_motionAccelerations.length > 300) {
      _motionAccelerations.shift();
    }

    // Check motion state every 100ms to avoid excessive processing
    const now = Date.now();
    if (now - _lastMotionCheckTime < 100) return;
    _lastMotionCheckTime = now;

    if (_motionAccelerations.length < 50) return; // Wait for buffer to fill

    const stdDev = calculateStdDev(_motionAccelerations);
    const wasMoving = trackerState.motionState === "moving";
    let newMotionState = trackerState.motionState;

    // Hysteresis: use thresholds to prevent flickering
    if (trackerState.motionState === "moving") {
      // Moving → Stationary threshold is lower (0.3)
      if (stdDev < config.motionThreshold) {
        newMotionState = "stationary";
        _stationaryStartTime = now;
      }
    } else if (trackerState.motionState === "stationary") {
      // Stationary → Moving threshold is higher (0.5)
      if (stdDev > 0.5) {
        newMotionState = "moving";
        _stationaryStartTime = null;
      }
    } else if (trackerState.motionState === "unknown") {
      // Initial state: decide based on motion threshold
      if (stdDev < config.motionThreshold) {
        newMotionState = "stationary";
        _stationaryStartTime = now;
      } else if (stdDev > 0.5) {
        newMotionState = "moving";
      }
    }

    // Transition handling
    if (newMotionState !== trackerState.motionState) {
      updateState({ motionState: newMotionState });

      if (newMotionState === "stationary" && wasMoving) {
        // Transition to stationary: reduce GPS frequency
        if (!_sosActive && config.motionAwareEnabled) {
          console.log("[GPSTracker] Motion-Aware: stationary detected, reducing to 2min interval");
          applyMotionAwareInterval();
        }
      } else if (newMotionState === "moving" && trackerState.motionState === "stationary") {
        // Transition to moving: record position immediately and restore normal frequency
        recordCurrentPosition();
        if (!_sosActive && config.motionAwareEnabled) {
          console.log("[GPSTracker] Motion-Aware: motion detected, restoring normal interval");
          applyMotionAwareInterval();
        }
      }
    }

    updateState({ lastMotionDetected: now });
  };

  if (typeof window !== "undefined") {
    window.addEventListener("devicemotion", _motionHandler as any);
    updateState({ motionAwareActive: true });
    console.log("[GPSTracker] Motion detection started");
  }
}

function stopMotionDetection(): void {
  if (_motionHandler && typeof window !== "undefined") {
    window.removeEventListener("devicemotion", _motionHandler as any);
    _motionHandler = null;
  }
  _motionAccelerations = [];
  _stationaryStartTime = null;
  _lastMotionCheckTime = 0;
  updateState({ motionAwareActive: false, motionState: "unknown" });
  console.log("[GPSTracker] Motion detection stopped");
}

function applyMotionAwareInterval(): void {
  if (!config.motionAwareEnabled || _sosActive) return;

  const newInterval =
    trackerState.motionState === "stationary"
      ? config.stationaryIntervalMs
      : config.intervalMs;

  if (newInterval === trackerState.currentInterval) return;

  // Update interval in real-time if tracking
  if (trackerState.isTracking && intervalId) {
    clearInterval(intervalId);
    intervalId = setInterval(recordCurrentPosition, newInterval);
  }

  updateState({ currentInterval: newInterval });

  // Calculate battery savings estimate
  if (trackerState.motionState === "stationary" && trackerState.startedAt) {
    const uptime = Date.now() - trackerState.startedAt;
    const stationaryTime = _stationaryStartTime ? Date.now() - _stationaryStartTime : 0;
    if (stationaryTime > 0) {
      // Estimate calls avoided: if stationary for X seconds with 2min interval vs 15s normal
      const normalCalls = uptime / config.intervalMs;
      const reducedCalls = uptime / config.stationaryIntervalMs;
      const callsAvoided = normalCalls - reducedCalls;
      const savedPct = Math.round((callsAvoided / normalCalls) * 100);
      updateState({ estimatedBatterySavedPct: Math.max(0, savedPct) });
    }
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
const MAX_SYNC_BUFFER = 500; // Prevent unbounded memory growth

function syncPointToSupabase(point: any): void {
  if (!SUPABASE_CONFIG.isConfigured) return;

  // Cap buffer size — drop oldest if full
  if (_syncBuffer.length >= MAX_SYNC_BUFFER) {
    _syncBuffer.shift();
  }

  _syncBuffer.push({
    employee_id: point.employeeId,
    lat: point.lat,
    lng: point.lng,
    accuracy: point.accuracy,
    altitude: point.altitude,
    speed: point.speed,
    heading: point.heading,
    battery: point.batteryLevel != null ? Math.round(point.batteryLevel * 100) : null,
    is_emergency: point.isEmergency || false,
    session_id: point.sessionId || null,
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

    // Bounds: stop dead reckoning after 30 min (accuracy too degraded)
    if (elapsedSec > 1800) {
      console.warn("[GPSTracker] Dead reckoning exceeded 30min, stopping");
      stopDeadReckoning();
      return;
    }

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

let _startingLock = false; // Prevent concurrent startGPSTracking calls

export function startGPSTracking(userConfig?: Partial<GPSTrackerConfig>): boolean {
  if (trackerState.isTracking || _startingLock) return true;
  _startingLock = true;
  if (!("geolocation" in navigator)) {
    _startingLock = false;
    updateState({ gpsAvailable: false, lastError: "Geolocation API not available" });
    return false;
  }

  // Apply config
  config = { ...DEFAULT_CONFIG, ...userConfig };

  // Check battery
  checkBattery();

  // Start motion-aware detection
  startMotionDetection();

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

  // Flush GPS buffer on app close/background
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => flushGPSSync());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushGPSSync();
    });
  }

  _startingLock = false;
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
  stopMotionDetection();

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
// This overrides motion-aware to ensure high frequency during emergency

export function activateEmergencyTracking(): void {
  _sosActive = true; // Prevent motion-aware from reducing frequency
  updateTrackerConfig({
    intervalMs: 3000,       // Every 3 seconds
    highAccuracy: true,
    minDistanceMeters: 1,   // Record every meter
    deadReckoningEnabled: true,
    batterySaveThreshold: 0, // Ignore battery saving during emergency
  });
  console.log("[GPSTracker] EMERGENCY MODE: tracking every 3s (motion-aware overridden)");
}

export function deactivateEmergencyTracking(): void {
  _sosActive = false; // Re-enable motion-aware
  updateTrackerConfig({
    intervalMs: DEFAULT_CONFIG.intervalMs,
    highAccuracy: DEFAULT_CONFIG.highAccuracy,
    minDistanceMeters: DEFAULT_CONFIG.minDistanceMeters,
    deadReckoningEnabled: DEFAULT_CONFIG.deadReckoningEnabled,
    batterySaveThreshold: DEFAULT_CONFIG.batterySaveThreshold,
  });
  console.log("[GPSTracker] Emergency mode deactivated, normal tracking resumed");
}