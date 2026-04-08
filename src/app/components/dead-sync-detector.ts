// ═══════════════════════════════════════════════════════════════
// SOSphere — Dead-Sync Detector
// Monitors the heartbeat of Supabase Realtime connection.
// If connection is lost for more than X minutes while in High-Risk Mode,
// triggers a local notification to the user to check their safety.
//
// "High-Risk Mode" is active when:
//   - User is in a critical/high risk zone
//   - Active SOS is in progress
//   - Dead Man's Switch timer is running
//   - User is on a Safe Walk session
//
// Detection method:
//   1. Send periodic "heartbeat" pings via Supabase REST API
//   2. Expect a 200 response within 5 seconds
//   3. If 3 consecutive heartbeats fail → connection is DEAD
//   4. If in High-Risk Mode + dead for > thresholdMs → ALERT
//   5. Show local notification + in-app banner
//   6. Optionally attempt to reconnect channels
// ═══════════════════════════════════════════════════════════════

import { SUPABASE_CONFIG } from "./api/supabase-client";
import { reportError } from "./error-boundary";

export type SyncHealth = "healthy" | "degraded" | "dead" | "recovering";
export type RiskLevel = "critical" | "high" | "standard" | "low" | "off";

export interface DeadSyncConfig {
  heartbeatIntervalMs: number;     // 30s default
  heartbeatTimeoutMs: number;      // 5s per ping
  maxConsecutiveFailures: number;  // 3 failures = dead
  highRiskAlertMs: number;         // 2 minutes for high-risk mode
  standardAlertMs: number;         // 5 minutes for standard mode
  autoReconnect: boolean;          // Try to reconnect channels on dead
  maxReconnectAttempts: number;    // Max reconnect tries before giving up
  showNotification: boolean;        // Use browser Notification API
  showInAppBanner: boolean;        // Show in-app warning banner
}

export interface DeadSyncState {
  health: SyncHealth;
  riskLevel: RiskLevel;
  lastHeartbeatAt: number | null;
  lastAckAt: number | null;
  consecutiveFailures: number;
  deadSinceMs: number | null;      // null if not dead, timestamp if dead
  reconnectAttempts: number;
  alertShown: boolean;
  alertDismissedAt: number | null;
}

// ── Default Configuration ──────────────────────────────────────

const DEFAULT_CONFIG: DeadSyncConfig = {
  heartbeatIntervalMs: 30000,    // 30 seconds
  heartbeatTimeoutMs: 5000,      // 5 seconds
  maxConsecutiveFailures: 3,     // 3 failures = dead
  highRiskAlertMs: 120000,       // 2 minutes
  standardAlertMs: 300000,       // 5 minutes
  autoReconnect: true,
  maxReconnectAttempts: 5,
  showNotification: true,
  showInAppBanner: true,
};

// ── Singleton State ─────────────────────────────────────────────

let config = { ...DEFAULT_CONFIG };

let state: DeadSyncState = {
  health: "healthy",
  riskLevel: "off",
  lastHeartbeatAt: null,
  lastAckAt: null,
  consecutiveFailures: 0,
  deadSinceMs: null,
  reconnectAttempts: 0,
  alertShown: false,
  alertDismissedAt: null,
};

let _isInitialized = false;
let _heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
let _alertCheckIntervalId: ReturnType<typeof setInterval> | null = null;
let _reconnectBackoffMs = 5000; // Start at 5s, exponential backoff
let _stateListeners: ((state: DeadSyncState) => void)[] = [];

// ── Notification Permission ─────────────────────────────────────

async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }
  if (Notification.permission === "granted") {
    return true;
  }
  if (Notification.permission === "denied") {
    return false;
  }
  try {
    const permission = await Notification.requestPermission();
    return permission === "granted";
  } catch {
    return false;
  }
}

// ── State Management ────────────────────────────────────────────

function updateState(partial: Partial<DeadSyncState>) {
  state = { ...state, ...partial };
  notifyStateListeners();
}

function notifyStateListeners() {
  for (const cb of _stateListeners) {
    try { cb({ ...state }); } catch { /* ignore listener errors */ }
  }
}

// ── Heartbeat Mechanism ─────────────────────────────────────────

/**
 * Send a heartbeat ping to Supabase REST API.
 * Returns true if successful, false otherwise.
 */
async function sendHeartbeat(): Promise<boolean> {
  if (!SUPABASE_CONFIG.isConfigured) {
    // Offline mode — consider as "alive"
    return true;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      config.heartbeatTimeoutMs
    );

    const response = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/`, {
      method: "HEAD",
      signal: controller.signal,
      headers: {
        apikey: SUPABASE_CONFIG.anonKey,
      },
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Process heartbeat response and update health state.
 */
async function checkHeartbeat(): Promise<void> {
  const now = Date.now();
  const isAlive = await sendHeartbeat();

  if (isAlive) {
    // Reset failure counter
    updateState({
      lastHeartbeatAt: now,
      lastAckAt: now,
      consecutiveFailures: 0,
      reconnectAttempts: 0,
      _reconnectBackoffMs: 5000, // Reset backoff
    });

    // Transition from dead/degraded to healthy
    if (state.health === "dead" || state.health === "degraded") {
      updateState({
        health: "recovering",
        deadSinceMs: null,
      });

      // Wait a moment then declare fully healthy
      setTimeout(() => {
        if (state.health === "recovering") {
          updateState({ health: "healthy" });
        }
      }, 3000);
    } else if (state.health === "recovering") {
      // Still recovering
    } else {
      updateState({ health: "healthy" });
    }
  } else {
    // Heartbeat failed
    const failures = state.consecutiveFailures + 1;
    updateState({ consecutiveFailures: failures });

    if (failures >= config.maxConsecutiveFailures) {
      // Mark as dead
      if (state.health !== "dead") {
        updateState({
          health: "dead",
          deadSinceMs: state.deadSinceMs || now,
        });

        reportError(
          "Dead-Sync Detector: Connection lost after multiple failed heartbeats",
          {
            consecutiveFailures: failures,
            riskLevel: state.riskLevel,
            component: "DeadSyncDetector",
          },
          "warning"
        );

        // Attempt auto-reconnect if enabled
        if (config.autoReconnect) {
          attemptReconnect();
        }
      }
    } else if (failures >= 1) {
      updateState({ health: "degraded" });
    }

    updateState({ lastHeartbeatAt: now });
  }
}

// ── Auto-Reconnect with Exponential Backoff ──────────────────────

async function attemptReconnect(): Promise<void> {
  const attempts = state.reconnectAttempts;

  if (attempts >= config.maxReconnectAttempts) {
    reportError(
      `Dead-Sync Detector: Max reconnect attempts (${config.maxReconnectAttempts}) reached`,
      { component: "DeadSyncDetector" },
      "warning"
    );
    return;
  }

  // Wait with exponential backoff
  const delay = Math.min(_reconnectBackoffMs, 40000); // Cap at 40s
  _reconnectBackoffMs = delay * 2;

  console.log(
    `[DeadSync] Attempting reconnect in ${delay}ms (attempt ${attempts + 1}/${config.maxReconnectAttempts})`
  );

  // In a real scenario, you would call initRealtimeChannels() here
  // from shared-store.ts to reinitialize the channels. For now,
  // we just track the attempt.
  updateState({
    reconnectAttempts: attempts + 1,
    health: "recovering",
  });

  // Schedule the reconnect attempt
  setTimeout(async () => {
    // Try another heartbeat to see if connection is back
    const isAlive = await sendHeartbeat();
    if (isAlive) {
      updateState({
        health: "healthy",
        consecutiveFailures: 0,
        deadSinceMs: null,
        reconnectAttempts: 0,
        _reconnectBackoffMs: 5000,
      });
      console.log("[DeadSync] Reconnection successful");
    } else {
      // Still dead, try again (unless max attempts exceeded)
      if (state.reconnectAttempts < config.maxReconnectAttempts) {
        attemptReconnect();
      }
    }
  }, delay);
}

// ── Alert Logic ─────────────────────────────────────────────────

/**
 * Calculate alert threshold based on risk level.
 */
function getAlertThresholdMs(riskLevel: RiskLevel): number {
  switch (riskLevel) {
    case "critical":
      return 60000; // 1 minute for active SOS
    case "high":
      return config.highRiskAlertMs; // 2 minutes
    case "standard":
      return config.standardAlertMs; // 5 minutes
    case "low":
      return 600000; // 10 minutes
    case "off":
      return Infinity; // Never alert when off
    default:
      return Infinity;
  }
}

/**
 * Check if an alert should be shown.
 */
function checkAndShowAlert(): void {
  // Don't alert if not dead
  if (state.health !== "dead" || !state.deadSinceMs) {
    return;
  }

  // Don't alert if risk level is off
  if (state.riskLevel === "off") {
    return;
  }

  // Check if dead long enough to warrant alert
  const thresholdMs = getAlertThresholdMs(state.riskLevel);
  const deadDurationMs = Date.now() - state.deadSinceMs;

  if (deadDurationMs > thresholdMs && !state.alertShown) {
    showDeadSyncAlert();
  }
}

/**
 * Display alert to user via notification and in-app banner.
 */
function showDeadSyncAlert(): void {
  updateState({ alertShown: true });

  const deadMinutes = Math.round(
    (Date.now() - (state.deadSinceMs || Date.now())) / 60000
  );
  const message = `⚠️ SOSphere Connection Lost — You've been offline for ${deadMinutes} minutes. Your safety data is being stored locally. Please check your connection.`;

  // Browser notification
  if (config.showNotification && typeof window !== "undefined" && "Notification" in window) {
    if (Notification.permission === "granted") {
      try {
        new Notification("SOSphere Safety Alert", {
          body: message,
          icon: "/sosphere-icon.svg",
          tag: "dead-sync-alert",
          requireInteraction: true, // Don't auto-dismiss
        });
      } catch (err) {
        reportError(err, { context: "showDeadSyncAlert/notification" }, "warning");
      }
    }
  }

  // Report for in-app banner (consumed by UI components)
  reportError(message, {
    type: "dead_sync_alert",
    component: "DeadSyncDetector",
    riskLevel: state.riskLevel,
    deadSinceMs: state.deadSinceMs,
  }, "error");

  console.warn("[DeadSync] ALERT SHOWN:", message);
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Initialize the Dead-Sync Detector.
 * Should be called once at app startup.
 */
export function initDeadSyncDetector(userConfig?: Partial<DeadSyncConfig>): void {
  if (_isInitialized) {
    console.warn("[DeadSync] Already initialized, skipping");
    return;
  }

  config = { ...DEFAULT_CONFIG, ...userConfig };
  _isInitialized = true;

  console.log("[DeadSync] Initialized with config:", config);

  // Request notification permission
  requestNotificationPermission().catch(() => { /* ignore */ });

  // Start heartbeat loop
  _heartbeatIntervalId = setInterval(checkHeartbeat, config.heartbeatIntervalMs);

  // Start alert check loop (every 10 seconds)
  _alertCheckIntervalId = setInterval(checkAndShowAlert, 10000);

  // Initial heartbeat
  checkHeartbeat();
}

/**
 * Stop the Dead-Sync Detector.
 * Should be called on app shutdown or logout.
 */
export function stopDeadSyncDetector(): void {
  if (!_isInitialized) return;

  if (_heartbeatIntervalId) {
    clearInterval(_heartbeatIntervalId);
    _heartbeatIntervalId = null;
  }
  if (_alertCheckIntervalId) {
    clearInterval(_alertCheckIntervalId);
    _alertCheckIntervalId = null;
  }

  _isInitialized = false;
  updateState({
    health: "healthy",
    riskLevel: "off",
    alertShown: false,
    consecutiveFailures: 0,
    deadSinceMs: null,
  });

  console.log("[DeadSync] Detector stopped");
}

/**
 * Update the current risk level.
 * This determines alert thresholds and urgency.
 */
export function setRiskLevel(level: RiskLevel): void {
  updateState({ riskLevel: level });
  console.log(`[DeadSync] Risk level set to: ${level}`);
}

/**
 * Get the current Dead-Sync state.
 */
export function getDeadSyncState(): DeadSyncState {
  return { ...state };
}

/**
 * Subscribe to Dead-Sync state changes.
 * Returns an unsubscribe function.
 */
export function onSyncHealthChange(cb: (state: DeadSyncState) => void): () => void {
  _stateListeners.push(cb);
  // Immediately emit current state
  cb({ ...state });
  return () => {
    const idx = _stateListeners.indexOf(cb);
    if (idx >= 0) _stateListeners.splice(idx, 1);
  };
}

/**
 * Force an immediate heartbeat check.
 * Returns true if ACK received (healthy), false otherwise.
 */
export async function forceHeartbeat(): Promise<boolean> {
  await checkHeartbeat();
  return state.health === "healthy";
}

/**
 * Dismiss the current alert.
 * User has acknowledged the connection loss warning.
 */
export function dismissAlert(): void {
  updateState({
    alertShown: false,
    alertDismissedAt: Date.now(),
  });
  console.log("[DeadSync] Alert dismissed by user");
}
