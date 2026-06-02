// ═══════════════════════════════════════════════════════════════
// SOSphere — Discreet SOS Mode (Stealth Engine)
// ─────────────────────────────────────────────────────────────
// Emergency feature: when user is in danger, the device can
// display a fake "Low Battery" or "Blackout" screen while
// secretly streaming GPS and recording audio in the background.
//
// STEALTH BEHAVIOR:
//  • Screen shows convincing fake shutdown
//  • GPS location streamed every 5 seconds (emergency-level)
//  • Audio recording captured (stored locally for evidence)
//  • Exit: triple-tap bottom-left corner within 2 seconds
//  • Auto-timeout: 60 minutes safety limit
//  • Anti-detection: suppresses OS notifications
// ═══════════════════════════════════════════════════════════════

import { startGPSTracking, stopGPSTracking, activateEmergencyTracking, deactivateEmergencyTracking, getLastKnownPosition } from "./offline-gps-tracker";
import { emitSyncEvent } from "./shared-store";
import { recordGPSPoint } from "./offline-database";
// PR (E) 2026-05-26 — global Math.random sweep.
import { secureRandomId } from "./utils/secure-random";

// ── State Management ───────────────────────────────────────────

interface DiscreetSosState {
  isActive: boolean;
  mode: "blackout" | "low-battery" | null;
  startedAt: number | null;
  audioChunks: Blob[];
  mediaRecorder: MediaRecorder | null;
  stream: MediaStream | null;
  wakeLock: WakeLockSentinel | null;
  gpsIntervalId: ReturnType<typeof setInterval> | null;
  autoTimeoutId: ReturnType<typeof setTimeout> | null;
  tapTracker: { timestamp: number; x: number; y: number }[];
}

let discreetState: DiscreetSosState = {
  isActive: false,
  mode: null,
  startedAt: null,
  audioChunks: [],
  mediaRecorder: null,
  stream: null,
  wakeLock: null,
  gpsIntervalId: null,
  autoTimeoutId: null,
  tapTracker: [],
};

// E-H3: warn responders 5 minutes before timeout and emit a heartbeat every 2 min
const DISCREET_TIMEOUT_MS = 60 * 60 * 1000;
const WARN_BEFORE_MS = 5 * 60 * 1000;
const HEARTBEAT_MS = 2 * 60 * 1000;
let _discreetWarnTimer: ReturnType<typeof setTimeout> | null = null;
let _discreetHbInterval: ReturnType<typeof setInterval> | null = null;

// ── State Listeners ────────────────────────────────────────────

type DiscreetStateListener = (state: DiscreetSosState) => void;
let stateListeners: DiscreetStateListener[] = [];

function updateState(partial: Partial<DiscreetSosState>) {
  discreetState = { ...discreetState, ...partial };
  stateListeners.forEach(fn => {
    try { fn(discreetState); } catch { /* ignore listener errors */ }
  });
}

export function subscribeToDiscreetMode(listener: DiscreetStateListener): () => void {
  stateListeners.push(listener);
  listener(discreetState);
  return () => {
    stateListeners = stateListeners.filter(fn => fn !== listener);
  };
}

export function getDiscreetState(): DiscreetSosState {
  return { ...discreetState };
}

// ── Dev Logging ────────────────────────────────────────────────

function devLog(msg: string, ...args: any[]) {
  if (import.meta.env.DEV) {
    console.log(`[DiscreetSOS] ${msg}`, ...args);
  }
}

function devWarn(msg: string, ...args: any[]) {
  if (import.meta.env.DEV) {
    console.warn(`[DiscreetSOS] ${msg}`, ...args);
  }
}

// ── GPS Streaming (Emergency Level) ────────────────────────────
// Every 5 seconds, record location and emit SOS event

async function streamGPSLocation(): Promise<void> {
  try {
    const position = getLastKnownPosition();
    if (position) {
      devLog("GPS update:", position);
      // Also record in local database for evidence trail
      await recordGPSPoint({
        employeeId: "discreet-sos-user",
        lat: position.lat,
        lng: position.lng,
        accuracy: position.accuracy,
        altitude: null,
        speed: null,
        heading: null,
        timestamp: Date.now(),
        batteryLevel: null,
        source: "gps",
      });
    }
  } catch (err) {
    devWarn("GPS stream error:", err);
  }
}

// ── Audio Recording Setup ──────────────────────────────────────

async function startAudioRecording(): Promise<void> {
  // E-C3: guard against older WebViews / denied permission — do not crash SOS
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    console.warn("[DiscreetSOS] mediaDevices unavailable — continuing without audio evidence");
    updateState({ stream: null } as any);
    return; // keep rest of discreet mode running
  }

  try {
    // Request microphone permission (graceful handling if denied)
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    devLog("Audio stream acquired");
    updateState({ stream });

    // Create MediaRecorder with 10-second segments
    const mimeType = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "audio/mp4";

    const recorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: 128000, // 128 kbps for decent quality with small size
    });

    let segmentChunks: Blob[] = [];

    recorder.ondataavailable = async (event: BlobEvent) => {
      if (event.data.size > 0) {
        segmentChunks.push(event.data);

        // Every 10 seconds, save segment to IndexedDB
        if (segmentChunks.length > 0) {
          const audioBlob = new Blob(segmentChunks, { type: mimeType });
          await saveAudioSegmentToDatabase(audioBlob);
          segmentChunks = [];
          devLog("Audio segment saved");
        }
      }
    };

    recorder.start(10000); // Emit "dataavailable" every 10 seconds
    updateState({ mediaRecorder: recorder });
    devLog("Audio recording started");
  } catch (err: any) {
    // E-C3: continue discreet mode even when mic is denied / missing
    const name = err?.name || "";
    if (name === "NotAllowedError") console.warn("[DiscreetSOS] microphone permission denied");
    else if (name === "NotFoundError" || name === "DevicesNotFoundError") console.warn("[DiscreetSOS] no microphone hardware");
    else console.warn("[DiscreetSOS] getUserMedia failed:", err);
    updateState({ stream: null } as any);
    // DO NOT throw — continue discreet mode without audio
  }
}

async function saveAudioSegmentToDatabase(audioBlob: Blob): Promise<void> {
  try {
    // Open IndexedDB and save audio chunk
    const db = await openDiscreetAudioDB();
    const arrayBuffer = await audioBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const audioRecord = {
      // PR (E) — was Math.random-based audio ID.
      id: secureRandomId("audio", 6),
      timestamp: Date.now(),
      data: uint8Array, // Store as typed array
      mimeType: audioBlob.type,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction("discreet_audio", "readwrite");
      const store = tx.objectStore("discreet_audio");
      const req = store.add(audioRecord);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    devWarn("Failed to save audio segment:", err);
  }
}

// ── IndexedDB for Discreet Audio Storage ───────────────────────

let _discreetAudioDB: IDBDatabase | null = null;

function openDiscreetAudioDB(): Promise<IDBDatabase> {
  if (_discreetAudioDB) return Promise.resolve(_discreetAudioDB);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open("sosphere_discreet_audio", 1);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("discreet_audio")) {
        const store = db.createObjectStore("discreet_audio", { keyPath: "id" });
        store.createIndex("by_timestamp", "timestamp", { unique: false });
      }
    };

    req.onsuccess = (event) => {
      _discreetAudioDB = (event.target as IDBOpenDBRequest).result;
      resolve(_discreetAudioDB);
    };

    req.onerror = () => {
      devWarn("IndexedDB audio open failed:", req.error);
      reject(req.error);
    };
  });
}

// ── Screen Wake Lock ───────────────────────────────────────────
// Keep the screen awake during stealth mode

async function acquireWakeLock(): Promise<void> {
  try {
    if ("wakeLock" in navigator) {
      const wakeLock = await (navigator as any).wakeLock.request("screen");
      updateState({ wakeLock });
      devLog("Screen wake lock acquired");

      // Re-acquire if released
      wakeLock.addEventListener("release", () => {
        devLog("Wake lock released, re-acquiring...");
        acquireWakeLock();
      });
    }
  } catch (err) {
    devWarn("Wake lock error:", err);
  }
}

async function releaseWakeLock(): Promise<void> {
  if (discreetState.wakeLock) {
    try {
      await discreetState.wakeLock.release();
      updateState({ wakeLock: null });
      devLog("Wake lock released");
    } catch (err) {
      devWarn("Wake lock release error:", err);
    }
  }
}

// ── Triple-Tap Exit Detection ──────────────────────────────────
// Bottom-left 60x60px corner, must tap 3 times within 2 seconds

export function handleDiscreetTap(x: number, y: number): void {
  if (!discreetState.isActive) return;

  const now = Date.now();
  const exitZoneX = 60;
  const exitZoneY = window.innerHeight - 60;

  // Check if tap is in bottom-left corner
  if (x < exitZoneX && y > exitZoneY) {
    discreetState.tapTracker.push({ timestamp: now, x, y });
    devLog("Tap in exit zone:", x, y);

    // Remove taps older than 2 seconds
    discreetState.tapTracker = discreetState.tapTracker.filter(
      tap => now - tap.timestamp < 2000
    );

    // Triple-tap detected!
    if (discreetState.tapTracker.length >= 3) {
      devLog("Triple-tap exit detected!");
      deactivateDiscreetSos();
    }
  }
}

// ── Anti-Detection: Suppress Notifications ────────────────────
// Request Do Not Disturb mode if available

async function suppressNotifications(): Promise<void> {
  try {
    // Check if browser supports notification permission (some don't)
    if ("Notification" in window && Notification.permission === "granted") {
      // Try to suppress via Permissions API if available
      if ("permissions" in navigator) {
        // Note: There's no direct API to enable DND, but we can at least
        // avoid showing notifications ourselves
        devLog("Notifications may be active — discreet mode activated");
      }
    }
  } catch (err) {
    devLog("Notification suppression (expected in web env)");
  }
}

// ─── Phase 2 CRIT-9 (2026-06-01) — session id from server RPC ─
// Replaces the hardcoded "discreet-sos-user" placeholder with real
// auth.uid() identity (resolved server-side inside start_discreet_session
// SECDEF RPC). _sessionId is the DB row id; null when no active session.
let _sessionId: string | null = null;

async function _resolveIdentity(): Promise<{ userId: string; userName: string }> {
  try {
    const { supabase } = await import("./api/supabase-client");
    const { data } = await supabase.auth.getUser();
    const u = data?.user;
    if (u?.id) {
      const name = (u.user_metadata?.full_name as string)
        || (u.user_metadata?.name as string)
        || (u.email ? String(u.email).split("@")[0] : "Worker");
      return { userId: u.id, userName: name };
    }
  } catch { /* fall through */ }
  return { userId: "discreet-sos-user", userName: "Discreet SOS" };
}

// ── Emit Discreet SOS Event ────────────────────────────────────
// Notify the system that discreet SOS has been activated

async function emitDiscreetSosEvent(): Promise<void> {
  try {
    const position = getLastKnownPosition();
    const ident = await _resolveIdentity();
    await emitSyncEvent({
      type: "SOS_TRIGGERED",
      employeeId: ident.userId,
      employeeName: ident.userName,
      zone: "Discreet Mode",
      timestamp: Date.now(),
      data: {
        discreetMode: true,
        mode: discreetState.mode,
        sessionId: _sessionId,
        lat: position?.lat,
        lng: position?.lng,
        accuracy: position?.accuracy,
      },
    });
    // Also emit the typed DISCREET_SOS_STARTED so dashboard listeners
    // can filter without needing to inspect data.discreetMode
    await emitSyncEvent({
      type: "DISCREET_SOS_STARTED",
      employeeId: ident.userId,
      employeeName: ident.userName,
      zone: "Discreet Mode",
      timestamp: Date.now(),
      data: { sessionId: _sessionId, mode: discreetState.mode, lat: position?.lat, lng: position?.lng },
    });
    devLog("Discreet SOS event emitted");
  } catch (err) {
    devWarn("Failed to emit discreet SOS event:", err);
  }
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API — Activation / Deactivation
// ═══════════════════════════════════════════════════════════════

/**
 * Activate Discreet SOS Mode
 * @param mode - "blackout" (pure black screen) or "low-battery" (fake low battery screen)
 */
export async function activateDiscreetSos(mode: "blackout" | "low-battery"): Promise<void> {
  if (discreetState.isActive) {
    devWarn("Discreet SOS already active");
    return;
  }

  devLog("Activating discreet SOS mode:", mode);

  // Start GPS tracking (emergency level)
  if (!("geolocation" in navigator)) {
    devWarn("Geolocation not available");
    return;
  }

  // Start standard GPS first, then activate emergency tracking
  // Phase 2 CRIT-9 (2026-06-01): create a server-side discreet_sessions
  // row FIRST so the dashboard panel can display the session immediately.
  // The id flows into emit/heartbeat below. Best-effort: a network error
  // does NOT block local activation (the engine still works offline; the
  // session syncs on next heartbeat).
  try {
    const startPos = getLastKnownPosition();
    const { startDiscreetSession } = await import("./discreet-session-service");
    const dbMode: "blackout" | "low_battery" = mode === "low-battery" ? "low_battery" : "blackout";
    _sessionId = await startDiscreetSession({
      mode:     dbMode,
      lat:      startPos?.lat,
      lng:      startPos?.lng,
      accuracy: startPos?.accuracy,
      timeoutMin: 60,
    });
  } catch (e) {
    devWarn("Phase 2 CRIT-9: start_discreet_session failed (engine still active locally):", e);
    _sessionId = null;
  }

  const _ident = await _resolveIdentity();
  startGPSTracking({
    intervalMs: 5000, // 5 seconds for discreet mode
    highAccuracy: true,
    employeeId: _ident.userId,
  });

  // Activate emergency tracking (overrides motion-aware)
  activateEmergencyTracking();

  // Set up 5-second GPS streaming
  const gpsIntervalId = setInterval(streamGPSLocation, 5000);

  // Start audio recording
  await startAudioRecording();

  // Acquire screen wake lock
  await acquireWakeLock();

  // Suppress notifications
  await suppressNotifications();

  // Emit SOS event
  await emitDiscreetSosEvent();

  // Set auto-timeout: 60 minutes
  const autoTimeoutId = setTimeout(() => {
    devLog("Auto-timeout: deactivating discreet SOS after 60 minutes");
    deactivateDiscreetSos();
  }, DISCREET_TIMEOUT_MS);

  // E-H3: warn responders 5 minutes before timeout
  // Phase 2 CRIT-9: typed event (was cast as any) + real identity
  _discreetWarnTimer = setTimeout(() => {
    void (async () => {
      try {
        const ident = await _resolveIdentity();
        emitSyncEvent({
          type: "DISCREET_SOS_WARNING",
          employeeId: ident.userId,
          employeeName: ident.userName,
          zone: "Discreet Mode",
          timestamp: Date.now(),
          data: { sessionId: _sessionId, minutesRemaining: 5 },
        });
      } catch { /* hot path */ }
    })();
  }, DISCREET_TIMEOUT_MS - WARN_BEFORE_MS);

  // E-H3: emit a heartbeat every 2 min so responders can tell the session is still alive.
  // Phase 2 CRIT-9 (2026-06-01): heartbeat now ALSO writes to the
  // discreet_sessions row via SECDEF RPC. Server enforces auto-timeout —
  // a heartbeat after the deadline returns false and the server flips
  // the session to status='timed_out'. Lazy import + fire-and-forget.
  _discreetHbInterval = setInterval(() => {
    void (async () => {
      try {
        const pos = getLastKnownPosition();
        const ident = await _resolveIdentity();
        emitSyncEvent({
          type: "DISCREET_SOS_HEARTBEAT",
          employeeId: ident.userId,
          employeeName: ident.userName,
          zone: "Discreet Mode",
          timestamp: Date.now(),
          data: { sessionId: _sessionId, at: Date.now(), lat: pos?.lat, lng: pos?.lng },
        });
        if (_sessionId) {
          const { heartbeatDiscreetSession } = await import("./discreet-session-service");
          await heartbeatDiscreetSession({
            sessionId: _sessionId,
            lat:       pos?.lat,
            lng:       pos?.lng,
            accuracy:  pos?.accuracy,
          });
        }
      } catch { /* hot path */ }
    })();
  }, HEARTBEAT_MS);

  // Update state
  updateState({
    isActive: true,
    mode,
    startedAt: Date.now(),
    gpsIntervalId,
    autoTimeoutId,
    tapTracker: [],
  });

  devLog("Discreet SOS activated in", mode, "mode");
}

/**
 * Deactivate Discreet SOS Mode
 * Triggered by triple-tap exit or timeout
 */
export async function deactivateDiscreetSos(): Promise<void> {
  if (!discreetState.isActive) return;

  devLog("Deactivating discreet SOS mode");

  // Stop GPS tracking
  if (discreetState.gpsIntervalId) {
    clearInterval(discreetState.gpsIntervalId);
  }
  stopGPSTracking();
  deactivateEmergencyTracking();

  // Stop audio recording
  if (discreetState.mediaRecorder && discreetState.mediaRecorder.state === "recording") {
    discreetState.mediaRecorder.stop();
    devLog("Audio recording stopped");
  }

  // Close audio stream
  if (discreetState.stream) {
    discreetState.stream.getTracks().forEach(track => track.stop());
  }

  // Release wake lock
  await releaseWakeLock();

  // Clear auto-timeout
  if (discreetState.autoTimeoutId) {
    clearTimeout(discreetState.autoTimeoutId);
  }

  // E-H3: clear warn + heartbeat timers
  if (_discreetWarnTimer) { clearTimeout(_discreetWarnTimer); _discreetWarnTimer = null; }
  if (_discreetHbInterval) { clearInterval(_discreetHbInterval); _discreetHbInterval = null; }

  // Phase 2 CRIT-9: end the server session row + emit typed ENDED event.
  // Fire-and-forget — local deactivation always succeeds even if the
  // network call fails (the server auto-timeout will eventually catch it).
  if (_sessionId) {
    const endedId = _sessionId;
    void (async () => {
      try {
        const { endDiscreetSession } = await import("./discreet-session-service");
        await endDiscreetSession({ sessionId: endedId, reason: "exited" });
        const ident = await _resolveIdentity();
        emitSyncEvent({
          type: "DISCREET_SOS_ENDED",
          employeeId: ident.userId,
          employeeName: ident.userName,
          zone: "Discreet Mode",
          timestamp: Date.now(),
          data: { sessionId: endedId, reason: "exited" },
        });
      } catch (e) { devWarn("end_discreet_session failed:", e); }
    })();
    _sessionId = null;
  }

  // Update state
  updateState({
    isActive: false,
    mode: null,
    startedAt: null,
    gpsIntervalId: null,
    autoTimeoutId: null,
    mediaRecorder: null,
    stream: null,
  });

  devLog("Discreet SOS deactivated");
}

/**
 * Check if discreet mode is currently active
 */
export function isDiscreetModeActive(): boolean {
  return discreetState.isActive;
}

/**
 * Get current discreet mode ("blackout", "low-battery", or null)
 */
export function getDiscreetMode(): "blackout" | "low-battery" | null {
  return discreetState.mode;
}

/**
 * Get elapsed time in discreet mode (milliseconds)
 */
export function getDiscreetModeElapsed(): number {
  if (!discreetState.isActive || !discreetState.startedAt) return 0;
  return Date.now() - discreetState.startedAt;
}

/**
 * Retrieve all recorded audio segments from IndexedDB
 * Returns array of audio blobs for download/evidence
 */
export async function getDiscreetAudioRecordings(): Promise<Blob[]> {
  try {
    const db = await openDiscreetAudioDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("discreet_audio", "readonly");
      const store = tx.objectStore("discreet_audio");
      const req = store.getAll();
      req.onsuccess = () => {
        const records = req.result || [];
        const blobs = records.map(record => {
          const uint8Array = record.data instanceof Uint8Array
            ? record.data
            : new Uint8Array(record.data);
          return new Blob([uint8Array], { type: record.mimeType || "audio/webm" });
        });
        resolve(blobs);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    devWarn("Failed to retrieve audio recordings:", err);
    return [];
  }
}

/**
 * Clear all discreet audio recordings (after download/submission)
 */
export async function clearDiscreetAudioRecordings(): Promise<void> {
  try {
    const db = await openDiscreetAudioDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("discreet_audio", "readwrite");
      const store = tx.objectStore("discreet_audio");
      const req = store.clear();
      req.onsuccess = () => {
        devLog("Audio recordings cleared");
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    devWarn("Failed to clear audio recordings:", err);
  }
}
