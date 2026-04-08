// ═══════════════════════════════════════════════════════════════
// Emergency Warp — Rescue Mode State Machine
// Manages high-contrast rescue UI activation on SOS events
// ═══════════════════════════════════════════════════════════════

import { onSyncEvent } from "./shared-store";

// ── Types ──────────────────────────────────────────────────────

export type RescueModeState = "NORMAL" | "WARP_TRANSITIONING" | "RESCUE_ACTIVE" | "COOLDOWN";

export interface RescueEvent {
  id: string;
  employeeId: string;
  employeeName: string;
  zone: string;
  timestamp: number;
  bloodType?: string;
  allergies?: string;
  emergencyContacts?: Array<{ name: string; phone: string }>;
  medicalConditions?: string[];
  lastGPS?: { lat: number; lng: number; address?: string };
  accuracy?: number;
  batteryLevel?: number;
  signalStrength?: string;
}

export interface RescueModeStore {
  state: RescueModeState;
  activeEvent: RescueEvent | null;
  activatedAt: number | null;
  elapsedSeconds: number;
}

// ── Singleton Store ────────────────────────────────────────────

const RESCUE_MODE_STORE_KEY = "sosphere_rescue_mode";
const COOLDOWN_DURATION_MS = 5000; // 5s cooldown after exiting rescue mode

let _store: RescueModeStore = {
  state: "NORMAL",
  activeEvent: null,
  activatedAt: null,
  elapsedSeconds: 0,
};

let _callbacks: Array<(state: RescueModeState, event: RescueEvent | null) => void> = [];
let _elapsedInterval: NodeJS.Timeout | null = null;

// ── Initialization ─────────────────────────────────────────────

/**
 * Initialize rescue mode controller.
 * Call once on dashboard mount to listen for SOS events.
 */
export function initRescueModeController() {
  // Restore state from sessionStorage (survives page refresh)
  const persisted = sessionStorage.getItem(RESCUE_MODE_STORE_KEY);
  if (persisted) {
    try {
      const parsed = JSON.parse(persisted);
      _store = { ...parsed };

      // Resume elapsed timer if rescue mode is active
      if (_store.state === "RESCUE_ACTIVE" && _store.activatedAt) {
        startElapsedTimer();
      }

      if (import.meta.env.DEV) {
        console.log("[RescueMode] Restored state from sessionStorage:", _store.state);
      }
    } catch {
      if (import.meta.env.DEV) console.warn("[RescueMode] Failed to restore state from sessionStorage");
    }
  }

  // Listen for SOS_TRIGGERED events from realtime
  const unsub = onSyncEvent((event) => {
    if (event.type === "SOS_TRIGGERED") {
      const rescueEvent: RescueEvent = {
        id: event.data?.emergencyId || `emg-${Date.now()}`,
        employeeId: event.employeeId,
        employeeName: event.employeeName,
        zone: event.zone || "Unknown Zone",
        timestamp: event.timestamp,
        bloodType: event.data?.bloodType,
        allergies: event.data?.allergies,
        emergencyContacts: event.data?.emergencyContacts,
        medicalConditions: event.data?.medicalConditions,
        lastGPS: event.data?.lastGPS,
        accuracy: event.data?.accuracy,
        batteryLevel: event.data?.batteryLevel,
        signalStrength: event.data?.signalStrength,
      };
      activateRescueMode(rescueEvent);
    } else if (event.type === "SOS_CANCELLED") {
      deactivateRescueMode();
    }
  });

  return unsub;
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Activate rescue mode with a SOS event.
 */
export function activateRescueMode(event: RescueEvent) {
  if (_store.state === "COOLDOWN") {
    if (import.meta.env.DEV) console.log("[RescueMode] Still in cooldown, ignoring activation");
    return;
  }

  _store.state = "WARP_TRANSITIONING";
  _store.activeEvent = event;
  _store.activatedAt = Date.now();
  _store.elapsedSeconds = 0;

  // Transition to RESCUE_ACTIVE after brief animation delay
  setTimeout(() => {
    _store.state = "RESCUE_ACTIVE";
    persistState();
    notifyListeners();
    startElapsedTimer();

    if (import.meta.env.DEV) {
      console.log("[RescueMode] Activated for:", event.employeeName, "in", event.zone);
    }
  }, 100);

  persistState();
  notifyListeners();
}

/**
 * Deactivate rescue mode and enter cooldown.
 */
export function deactivateRescueMode() {
  if (_store.state === "NORMAL") return;

  stopElapsedTimer();
  _store.state = "COOLDOWN";
  _store.activeEvent = null;
  _store.activatedAt = null;

  persistState();
  notifyListeners();

  if (import.meta.env.DEV) console.log("[RescueMode] Deactivated, entering cooldown");

  // Return to NORMAL after cooldown
  setTimeout(() => {
    _store.state = "NORMAL";
    persistState();
    notifyListeners();
  }, COOLDOWN_DURATION_MS);
}

/**
 * Get current rescue mode state.
 */
export function getRescueModeState(): RescueModeState {
  return _store.state;
}

/**
 * Check if rescue mode is active.
 */
export function isRescueModeActive(): boolean {
  return _store.state === "RESCUE_ACTIVE" || _store.state === "WARP_TRANSITIONING";
}

/**
 * Get active rescue event data.
 */
export function getRescueEvent(): RescueEvent | null {
  return _store.activeEvent;
}

/**
 * Get elapsed time in seconds since activation.
 */
export function getElapsedSeconds(): number {
  return _store.elapsedSeconds;
}

/**
 * Subscribe to rescue mode state changes.
 * Returns unsubscribe function.
 */
export function onRescueModeChange(
  callback: (state: RescueModeState, event: RescueEvent | null) => void
): () => void {
  _callbacks.push(callback);
  return () => {
    _callbacks = _callbacks.filter(cb => cb !== callback);
  };
}

// ── Private Helpers ────────────────────────────────────────────

function notifyListeners() {
  _callbacks.forEach(cb => cb(_store.state, _store.activeEvent));
}

function persistState() {
  try {
    sessionStorage.setItem(RESCUE_MODE_STORE_KEY, JSON.stringify(_store));
  } catch {
    if (import.meta.env.DEV) console.warn("[RescueMode] Failed to persist state to sessionStorage");
  }
}

function startElapsedTimer() {
  if (_elapsedInterval) return;

  _elapsedInterval = setInterval(() => {
    if (_store.state === "RESCUE_ACTIVE" && _store.activatedAt) {
      _store.elapsedSeconds = Math.floor((Date.now() - _store.activatedAt) / 1000);
      notifyListeners();
    }
  }, 100); // Update every 100ms for smooth display
}

function stopElapsedTimer() {
  if (_elapsedInterval) {
    clearInterval(_elapsedInterval);
    _elapsedInterval = null;
  }
}

// ── Cleanup ────────────────────────────────────────────────────

/**
 * Cleanup on unmount.
 */
export function cleanupRescueMode() {
  stopElapsedTimer();
  _callbacks = [];
}
