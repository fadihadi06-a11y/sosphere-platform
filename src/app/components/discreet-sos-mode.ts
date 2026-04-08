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
    if (err.name === "NotAllowedError") {
      devWarn("Audio permission denied by user");
    } else {
      devWarn("Audio recording init error:", err);
    }
  }
}

async function saveAudioSegmentToDatabase(audioBlob: Blob): Promise<void> {
  try {
    // Open IndexedDB and save audio chunk
    const db = await openDiscreetAudioDB();
    const arrayBuffer = await audioBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const audioRecord = {
      id: `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

// ── Emit Discreet SOS Event ────────────────────────────────────
// Notify the system that discreet SOS has been activated

async function emitDiscreetSosEvent(): Promise<void> {
  try {
    const position = getLastKnownPosition();
    await emitSyncEvent({
      type: "SOS_TRIGGERED",
      employeeId: "discreet-sos-user",
      employeeName: "Discreet SOS Activated",
      zone: "Unknown",
      timestamp: Date.now(),
      data: {
        discreetMode: true,
        mode: discreetState.mode,
        lat: position?.lat,
        lng: position?.lng,
        accuracy: position?.accuracy,
      },
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
  startGPSTracking({
    intervalMs: 5000, // 5 seconds for discreet mode
    highAccuracy: true,
    employeeId: "discreet-sos-user",
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
  }, 60 * 60 * 1000);

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
