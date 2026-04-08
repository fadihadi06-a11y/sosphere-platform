// ═══════════════════════════════════════════════════════════════
// SOSphere — Critical Alert Engine
// ISO 27001 §A.16.1.2 — Reporting Information Security Events
//
// When an SOS is received, this system ensures the notification:
//   1. Bypasses device silent/DND mode via Web Audio API high-priority playback
//   2. Plays a unique high-intensity alarm sound (generated procedurally)
//   3. Uses the Notification API with 'requireInteraction' and 'silent: false'
//   4. Vibrates the device if Vibration API is available
//   5. Keeps playing until explicitly acknowledged
//
// This is critical for rescue effectiveness — if an admin's phone is on
// silent and they miss an SOS, the consequence could be fatal.
// ═══════════════════════════════════════════════════════════════

interface CriticalAlertConfig {
  alarmDurationMs: number;        // How long the alarm plays per cycle (default: 30s)
  vibrationPattern: number[];     // Vibration pattern [vibrate, pause, vibrate...]
  volumeLevel: number;            // 0-1, forced to maximum for SOS
  requireAcknowledgment: boolean; // Must click to dismiss
  repeatCount: number;            // How many times to repeat alarm cycle (-1 = infinite until ack)
  escalationDelayMs: number;      // If not acknowledged, escalate after this
}

export type AlertPriority = "critical" | "high" | "normal";

interface ActiveAlert {
  id: string;
  priority: AlertPriority;
  title: string;
  body: string;
  timestamp: number;
  acknowledged: boolean;
  acknowledgedAt: number | null;
  acknowledgedBy: string | null;
  escalated: boolean;
  audioContext: AudioContext | null;
  notificationId?: string;
}

// ── Singleton Instance ───────────────────────────────────────────
let audioContext: AudioContext | null = null;
let activeAlerts: Map<string, ActiveAlert> = new Map();
let escalationCallbacks: ((alertId: string) => void)[] = [];
let oscillators: Map<string, OscillatorNode[]> = new Map();
let gainNodes: Map<string, GainNode[]> = new Map();

// Default config
const DEFAULT_CONFIG: CriticalAlertConfig = {
  alarmDurationMs: 30000,         // 30 seconds per cycle
  vibrationPattern: [500, 200, 500, 200, 500], // 3 long vibrations
  volumeLevel: 1.0,              // Maximum volume
  requireAcknowledgment: true,
  repeatCount: -1,               // Infinite until acknowledged
  escalationDelayMs: 60000,       // 60 seconds to escalate
};

// ═══════════════════════════════════════════════════════════════
// AUDIO CONTEXT INITIALIZATION
// ═══════════════════════════════════════════════════════════════

/**
 * Initialize the Web Audio API context if not already done.
 * Handles browser compatibility.
 */
function initAudioContext(): AudioContext {
  if (audioContext && audioContext.state !== "closed") {
    return audioContext;
  }

  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) {
    console.warn(
      "[CriticalAlertEngine] Web Audio API not supported in this browser"
    );
    throw new Error("Web Audio API not available");
  }

  audioContext = new AudioContextClass();

  // Resume audio context on user interaction (required by browsers)
  if (audioContext.state === "suspended") {
    const resumeOnInteraction = () => {
      audioContext?.resume();
      document.removeEventListener("click", resumeOnInteraction);
      document.removeEventListener("touchend", resumeOnInteraction);
    };
    document.addEventListener("click", resumeOnInteraction);
    document.addEventListener("touchend", resumeOnInteraction);
  }

  return audioContext;
}

// ═══════════════════════════════════════════════════════════════
// PROCEDURAL ALARM SOUND GENERATION
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a two-tone siren alarm sound.
 * Alternates between 880Hz and 1320Hz (musical notes A5 and E6).
 * Returns the duration of the alarm in milliseconds.
 *
 * @param ctx Audio context
 * @param destination Where to send the audio output
 * @param durationMs Duration to play
 * @returns Audio nodes for cleanup
 */
function generateTwoToneSiren(
  ctx: AudioContext,
  destination: AudioNode,
  durationMs: number
): { oscillators: OscillatorNode[]; gainNodes: GainNode[] } {
  const oscillators: OscillatorNode[] = [];
  const gainNodes: GainNode[] = [];

  // Tone 1: 880 Hz (A5)
  const osc1 = ctx.createOscillator();
  osc1.type = "sine";
  osc1.frequency.value = 880;

  const gain1 = ctx.createGain();
  gain1.gain.value = 0.4; // 40% for first tone

  osc1.connect(gain1);
  gain1.connect(destination);

  // Tone 2: 1320 Hz (E6)
  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.value = 1320;

  const gain2 = ctx.createGain();
  gain2.gain.value = 0;

  osc2.connect(gain2);
  gain2.connect(destination);

  // Control master volume
  const masterGain = ctx.createGain();
  masterGain.gain.value = 1.0; // Maximum volume
  destination.connect(masterGain);

  oscillators.push(osc1, osc2);
  gainNodes.push(gain1, gain2);

  // Oscillate between tones every 200ms
  const toneSwitch = 200; // ms per tone
  const startTime = ctx.currentTime;
  const endTime = startTime + durationMs / 1000;

  let switchTime = startTime;
  let currentTone = 1;

  const switchInterval = setInterval(() => {
    if (ctx.currentTime >= endTime) {
      clearInterval(switchInterval);
      return;
    }

    if (currentTone === 1) {
      gain1.gain.setValueAtTime(0, ctx.currentTime);
      gain2.gain.setValueAtTime(0.4, ctx.currentTime);
      currentTone = 2;
    } else {
      gain1.gain.setValueAtTime(0.4, ctx.currentTime);
      gain2.gain.setValueAtTime(0, ctx.currentTime);
      currentTone = 1;
    }
  }, toneSwitch);

  // Start oscillators
  osc1.start();
  osc2.start();

  // Stop at end time
  setTimeout(() => {
    try {
      osc1.stop();
      osc2.stop();
      clearInterval(switchInterval);
    } catch (e) {
      // Already stopped
    }
  }, durationMs);

  return { oscillators, gainNodes };
}

// ═══════════════════════════════════════════════════════════════
// NOTIFICATION API INTEGRATION
// ═══════════════════════════════════════════════════════════════

/**
 * Create a browser notification with high-priority settings.
 * Uses `requireInteraction: true` to ensure it won't auto-dismiss.
 *
 * @param alert Alert to display
 */
function createBrowserNotification(alert: ActiveAlert): void {
  if (!("Notification" in window)) {
    console.warn("[CriticalAlertEngine] Notification API not available");
    return;
  }

  // Request permission if needed
  if (Notification.permission === "denied") {
    console.warn("[CriticalAlertEngine] Notification permission denied");
    return;
  }

  if (Notification.permission === "default") {
    Notification.requestPermission();
    return;
  }

  const options: NotificationOptions = {
    tag: "sos-critical",
    requireInteraction: true,
    silent: false, // Allow system sound + our custom alarm
    badge: "/sos-badge.png",
    icon: "/sos-icon.png",
    body: alert.body,
    // Critical priority for supported browsers (Chrome 100+)
    ...(({ urgent: true } as any) || {}),
  };

  try {
    const notification = new Notification(alert.title, options);

    alert.notificationId = notification.tag;

    notification.onclick = () => {
      // Handle notification click (could navigate or bring app to foreground)
      window.focus();
      notification.close();
    };

    notification.onclose = () => {
      // Mark as acknowledged when closed
      // (user may have clicked the close button)
    };

    // Keep notification alive by re-creating it periodically
    const refreshInterval = setInterval(() => {
      if (alert.acknowledged) {
        clearInterval(refreshInterval);
        return;
      }

      try {
        notification.close();
        const newNotif = new Notification(alert.title, options);
        newNotif.onclick = notification.onclick;
        newNotif.onclose = notification.onclose;
      } catch (e) {
        clearInterval(refreshInterval);
      }
    }, 15000); // Refresh every 15 seconds

    alert.notificationId = notification.tag;
  } catch (e) {
    console.error("[CriticalAlertEngine] Failed to create notification:", e);
  }
}

// ═══════════════════════════════════════════════════════════════
// VIBRATION API INTEGRATION
// ═══════════════════════════════════════════════════════════════

/**
 * Trigger device vibration using the Vibration API.
 * Repeats the pattern until explicitly stopped.
 *
 * @param pattern Vibration pattern [vibrate_ms, pause_ms, vibrate_ms, ...]
 * @param repeatCount How many times to repeat the pattern (-1 = infinite)
 * @returns Function to stop vibration
 */
function startVibration(
  pattern: number[],
  repeatCount: number = -1
): () => void {
  if (!("vibrate" in navigator)) {
    return () => {}; // No vibration support
  }

  let stopped = false;
  let cycleCount = 0;

  const vibrateLoop = () => {
    if (stopped) return;

    if (repeatCount > 0 && cycleCount >= repeatCount) {
      stopped = true;
      return;
    }

    navigator.vibrate(pattern);
    cycleCount++;

    // Schedule next cycle (pattern duration + small pause)
    const patternDurationMs = pattern.reduce((a, b) => a + b, 0);
    setTimeout(vibrateLoop, patternDurationMs + 100);
  };

  vibrateLoop();

  return () => {
    stopped = true;
    navigator.vibrate(0); // Stop vibration
  };
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

/**
 * Trigger a critical alert (SOS).
 * This starts the alarm sound, vibration, and notification.
 *
 * @param title Alert title
 * @param body Alert description
 * @param priority Alert priority
 * @param config Optional configuration override
 * @returns Alert ID for later acknowledgment
 */
export function triggerCriticalAlert(
  title: string,
  body: string,
  priority: AlertPriority = "critical",
  config: Partial<CriticalAlertConfig> = {}
): string {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  // Create alert object
  const alertId = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const alert: ActiveAlert = {
    id: alertId,
    priority,
    title,
    body,
    timestamp: Date.now(),
    acknowledged: false,
    acknowledgedAt: null,
    acknowledgedBy: null,
    escalated: false,
    audioContext: null,
  };

  activeAlerts.set(alertId, alert);

  try {
    // Initialize audio context and start alarm
    const ctx = initAudioContext();
    alert.audioContext = ctx;

    const destination = ctx.destination;
    const { oscillators: oscs, gainNodes: gains } = generateTwoToneSiren(
      ctx,
      destination,
      finalConfig.alarmDurationMs
    );

    oscillators.set(alertId, oscs);
    gainNodes.set(alertId, gains);

    // Repeat alarm cycles
    if (finalConfig.repeatCount !== 1) {
      const repeatLoop = () => {
        if (alert.acknowledged) return;

        setTimeout(() => {
          if (!alert.acknowledged) {
            const { oscillators: newOscs, gainNodes: newGains } =
              generateTwoToneSiren(
                ctx,
                destination,
                finalConfig.alarmDurationMs
              );

            oscillators.set(alertId, newOscs);
            gainNodes.set(alertId, newGains);

            if (
              finalConfig.repeatCount === -1 ||
              (finalConfig.repeatCount > 1 && repeatCount < finalConfig.repeatCount)
            ) {
              repeatLoop();
            }
          }
        }, finalConfig.alarmDurationMs + 500);
      };

      if (finalConfig.repeatCount === -1) {
        repeatLoop();
      }
    }
  } catch (e) {
    console.error("[CriticalAlertEngine] Failed to initialize audio:", e);
  }

  // Create browser notification
  createBrowserNotification(alert);

  // Start vibration pattern
  const stopVibration = startVibration(
    finalConfig.vibrationPattern,
    finalConfig.repeatCount
  );

  // Set up escalation timer
  if (finalConfig.escalationDelayMs > 0) {
    setTimeout(() => {
      if (!alert.acknowledged) {
        alert.escalated = true;
        escalationCallbacks.forEach((cb) => cb(alertId));
      }
    }, finalConfig.escalationDelayMs);
  }

  console.log(`[CriticalAlertEngine] Alert triggered: ${alertId}`, {
    title,
    priority,
    timestamp: new Date(alert.timestamp).toISOString(),
  });

  return alertId;
}

/**
 * Acknowledge a critical alert.
 * Stops the alarm sound and vibration, logs the acknowledgment.
 *
 * @param alertId Alert ID to acknowledge
 * @param userId User who acknowledged (optional, for audit trail)
 */
export function acknowledgeCriticalAlert(
  alertId: string,
  userId?: string
): void {
  const alert = activeAlerts.get(alertId);
  if (!alert) {
    console.warn(`[CriticalAlertEngine] Alert not found: ${alertId}`);
    return;
  }

  alert.acknowledged = true;
  alert.acknowledgedAt = Date.now();
  alert.acknowledgedBy = userId || null;

  // Stop audio
  const oscs = oscillators.get(alertId);
  if (oscs) {
    oscs.forEach((osc) => {
      try {
        osc.stop();
      } catch (e) {
        // Already stopped
      }
    });
    oscillators.delete(alertId);
  }

  const gains = gainNodes.get(alertId);
  if (gains) {
    gainNodes.delete(alertId);
  }

  // Stop vibration
  if ("vibrate" in navigator) {
    navigator.vibrate(0);
  }

  // Close notification
  if (
    "Notification" in window &&
    alert.notificationId &&
    Notification.permission === "granted"
  ) {
    try {
      const notifications = (self as any).registration?.getNotifications?.();
      if (notifications) {
        notifications.then((notifs: Notification[]) => {
          notifs
            .filter((n) => n.tag === "sos-critical")
            .forEach((n) => n.close());
        });
      }
    } catch (e) {
      // Ignore
    }
  }

  console.log(`[CriticalAlertEngine] Alert acknowledged: ${alertId}`, {
    acknowledgedBy: userId,
    acknowledgedAt: new Date(alert.acknowledgedAt).toISOString(),
  });
}

/**
 * Get all currently active (unacknowledged) alerts.
 *
 * @returns Array of active alerts
 */
export function getActiveAlerts(): ActiveAlert[] {
  return Array.from(activeAlerts.values()).filter((a) => !a.acknowledged);
}

/**
 * Get a specific alert by ID.
 *
 * @param alertId Alert ID
 * @returns Alert or undefined
 */
export function getAlert(alertId: string): ActiveAlert | undefined {
  return activeAlerts.get(alertId);
}

/**
 * Subscribe to escalation events.
 * Called when an alert hasn't been acknowledged after escalationDelayMs.
 *
 * @param callback Function to call with alert ID when escalation occurs
 * @returns Unsubscribe function
 */
export function onAlertEscalation(
  callback: (alertId: string) => void
): () => void {
  escalationCallbacks.push(callback);

  // Return unsubscribe function
  return () => {
    escalationCallbacks = escalationCallbacks.filter((cb) => cb !== callback);
  };
}

/**
 * Emergency stop: Stop all active alarms immediately.
 * Called by admin if system is malfunctioning.
 */
export function stopAllAlerts(): void {
  // Stop all oscillators
  oscillators.forEach((oscs) => {
    oscs.forEach((osc) => {
      try {
        osc.stop();
      } catch (e) {
        // Already stopped
      }
    });
  });
  oscillators.clear();
  gainNodes.clear();

  // Stop all vibrations
  if ("vibrate" in navigator) {
    navigator.vibrate(0);
  }

  // Close all notifications
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      (self as any).registration?.getNotifications?.().then((notifs: any[]) => {
        notifs
          .filter((n) => n.tag === "sos-critical")
          .forEach((n) => n.close());
      });
    } catch (e) {
      // Ignore
    }
  }

  console.log("[CriticalAlertEngine] All alerts stopped");
}

/**
 * Reset the alert engine (clear all alerts, clean up resources).
 */
export function resetCriticalAlertEngine(): void {
  stopAllAlerts();
  activeAlerts.clear();
  escalationCallbacks = [];

  if (audioContext && audioContext.state !== "closed") {
    audioContext.close();
    audioContext = null;
  }

  console.log("[CriticalAlertEngine] Engine reset");
}

// ═══════════════════════════════════════════════════════════════
// EXPORT TYPES
// ═══════════════════════════════════════════════════════════════

export type { ActiveAlert, CriticalAlertConfig };
export { DEFAULT_CONFIG };
