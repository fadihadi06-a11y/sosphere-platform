// ═══════════════════════════════════════════════════════════════
// SOSphere — Push Notification Engine for IRE
// ─────────────────────────────────────────────────────────────
// Uses the Web Notification API to alert admins even when
// the browser tab is in background. Falls back gracefully.
// ═══════════════════════════════════════════════════════════════

let permissionGranted = false;

/**
 * Request notification permission on first user interaction
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") {
    permissionGranted = true;
    return true;
  }
  if (Notification.permission === "denied") return false;
  try {
    const result = await Notification.requestPermission();
    permissionGranted = result === "granted";
    return permissionGranted;
  } catch {
    return false;
  }
}

/**
 * Check current permission status
 */
export function getNotificationStatus(): "granted" | "denied" | "default" | "unsupported" {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/**
 * Send IRE Auto-Guide push notification
 * Called when the 10s inactivity timer triggers
 */
export function sendAutoGuideNotification(employeeName: string, zone: string, sosType: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  try {
    const notification = new Notification("SOSphere IRE -- Action Required", {
      body: `${employeeName} needs help in ${zone}. No admin action for 10s.\nTap to activate AI-guided response.`,
      icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%2305070E'/%3E%3Ccircle cx='32' cy='32' r='18' fill='none' stroke='%2300C8E0' stroke-width='3'/%3E%3Ccircle cx='32' cy='32' r='8' fill='%23FF2D55'/%3E%3C/svg%3E",
      badge: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='10' fill='%23FF2D55'/%3E%3C/svg%3E",
      tag: "sosphere-ire-guide",
      requireInteraction: true,
      silent: false,
    });

    // Auto-close after 15 seconds
    setTimeout(() => notification.close(), 15000);

    // Focus window on click
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Silently fail
  }
}

/**
 * Send emergency SOS notification for new incidents
 */
export function sendSOSNotification(employeeName: string, zone: string, severity: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  try {
    const urgencyMap: Record<string, string> = {
      critical: "CRITICAL",
      high: "HIGH PRIORITY",
      medium: "MODERATE",
      low: "LOW",
    };

    const notification = new Notification(`SOS ALERT -- ${urgencyMap[severity] || "EMERGENCY"}`, {
      body: `${employeeName} triggered SOS in ${zone}.\nImmediate response required.`,
      icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23FF2D55'/%3E%3Ctext x='32' y='42' text-anchor='middle' fill='white' font-size='28' font-weight='900'%3ESOS%3C/text%3E%3C/svg%3E",
      tag: "sosphere-sos-alert",
      requireInteraction: true,
      silent: false,
    });

    setTimeout(() => notification.close(), 30000);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Silently fail
  }
}

/**
 * Send IRE phase completion notification (if tab is in background)
 */
export function sendPhaseNotification(phaseName: string, nextPhase: string, score: number) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (document.hasFocus()) return; // Only when tab is in background

  try {
    const notification = new Notification(`IRE: ${phaseName} Complete`, {
      body: `Moving to ${nextPhase}. Current score: ${Math.round(score)}/100`,
      tag: "sosphere-ire-phase",
      silent: true,
    });
    setTimeout(() => notification.close(), 5000);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Silently fail
  }
}
