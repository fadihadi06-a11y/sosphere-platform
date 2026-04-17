/**
 * SOSphere — Call Priority Configuration
 * ═══════════════════════════════════════
 * Controls the execution order of SOS call paths:
 *
 *   "local_first"  — Path A (local cellular call) fires FIRST, Path B (Twilio)
 *                     fires in parallel as backup. Best for TESTING because the
 *                     local call is free and visible in logcat.
 *
 *   "twilio_first" — Path B (Twilio server call) fires FIRST and is the PRIMARY
 *                     delivery mechanism. Path A (local) only fires as FALLBACK
 *                     if Twilio fails within TWILIO_TIMEOUT_MS. Best for PRODUCTION
 *                     because it's fully silent on the victim's device.
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  TO SWITCH TO PRODUCTION:                               │
 * │  Change CALL_PRIORITY from "local_first" to             │
 * │  "twilio_first" and rebuild.                            │
 * │                                                         │
 * │  OR: set localStorage key "sosphere_call_priority"      │
 * │  to "twilio_first" for runtime override (no rebuild).   │
 * └─────────────────────────────────────────────────────────┘
 */

export type CallPriority = "local_first" | "twilio_first";

// ═══════════════════════════════════════════════════════════
// DEFAULT: Change this single line when ready for production
// ═══════════════════════════════════════════════════════════
const DEFAULT_PRIORITY: CallPriority = "local_first";

// How long to wait for Twilio response before falling back to local
// (only used when twilio_first is active)
export const TWILIO_TIMEOUT_MS = 10_000; // 10 seconds

const STORAGE_KEY = "sosphere_call_priority";

/**
 * Get the current call priority.
 * Runtime override via localStorage takes precedence over the compiled default.
 */
export function getCallPriority(): CallPriority {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "local_first" || stored === "twilio_first") {
      return stored;
    }
  } catch {}
  return DEFAULT_PRIORITY;
}

/**
 * Set the call priority at runtime (persists across restarts).
 * Useful for toggling without rebuilding the app.
 */
export function setCallPriority(priority: CallPriority): void {
  try {
    localStorage.setItem(STORAGE_KEY, priority);
    console.info(`[CallPriority] Set to: ${priority}`);
  } catch {}
}

/**
 * Check if Twilio should be the primary call path.
 */
export function isTwilioFirst(): boolean {
  return getCallPriority() === "twilio_first";
}

/**
 * Check if local cellular should be the primary call path.
 */
export function isLocalFirst(): boolean {
  return getCallPriority() === "local_first";
}
