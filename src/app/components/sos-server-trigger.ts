// ═══════════════════════════════════════════════════════════════
// SOSphere — SOS Server Trigger (Path B)
// Handles all server-side communication during SOS:
//   1. triggerServerSOS() — fires on SOS activation (parallel to local call)
//   2. sendHeartbeat()    — pings every 30s with GPS + battery
//   3. endServerSOS()     — notifies server when SOS ends
//
// This runs INDEPENDENTLY from the local dialer (Path A).
// Both paths fire simultaneously — "No-Wait Protocol".
// ═══════════════════════════════════════════════════════════════

import { getSubscription, type SubscriptionTier } from "./subscription-service";
import { getLastKnownPosition, getBatteryLevel } from "./offline-gps-tracker";

// ── Config ───────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const SOS_ALERT_URL = `${SUPABASE_URL}/functions/v1/sos-alert`;

// ── State ────────────────────────────────────────────────────
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let activeEmergencyId: string | null = null;
let serverTriggerResult: ServerTriggerResult | null = null;

export interface ServerTriggerResult {
  success: boolean;
  emergencyId: string;
  tier: string;
  trackUrl?: string;
  dashUrl?: string;
  results?: {
    contactName: string;
    phone: string;
    callSid?: string | null;
    smsSid?: string | null;
    method: string;
  }[];
  error?: string;
}

export interface WatchdogState {
  localDialerOpened: boolean;
  localDialerRinging: boolean;
  serverTriggered: boolean;
  serverResults: ServerTriggerResult | null;
  elapsedMs: number;
}

// ── Helpers ──────────────────────────────────────────────────
function getTierString(): "free" | "basic" | "elite" {
  const sub = getSubscription();
  const t = sub.tier.toLowerCase();
  if (t === "elite" || t === "premium") return "elite";
  if (t === "basic" || t === "standard") return "basic";
  return "free";
}

async function fetchSOS(
  action: string | null,
  body: Record<string, unknown>
): Promise<Response> {
  const url = action ? `${SOS_ALERT_URL}?action=${action}` : SOS_ALERT_URL;
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
    // Emergency requests — no timeout, send immediately
    keepalive: true,
  });
}

// ═══════════════════════════════════════════════════════════════
// 1. TRIGGER SERVER SOS (Path B — fires in parallel with Path A)
// ═══════════════════════════════════════════════════════════════
export async function triggerServerSOS(opts: {
  emergencyId: string;
  userId: string;
  userName: string;
  userPhone: string;
  contacts: { name: string; phone: string; relation: string }[];
  bloodType?: string;
  zone?: string;
  silent?: boolean;
}): Promise<ServerTriggerResult> {
  const tier = getTierString();
  const gps = getLastKnownPosition();

  console.log(`[SOS-Server] ═══ Path B FIRED ═══ tier=${tier} contacts=${opts.contacts.length} silent=${!!opts.silent}`);

  activeEmergencyId = opts.emergencyId;

  try {
    const res = await fetchSOS(null, {
      emergencyId: opts.emergencyId,
      userId: opts.userId,
      userName: opts.userName,
      userPhone: opts.userPhone,
      tier,
      contacts: opts.contacts,
      location: gps || { lat: 0, lng: 0, accuracy: 9999 },
      bloodType: opts.bloodType,
      zone: opts.zone,
      silent: opts.silent,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      console.error("[SOS-Server] Server trigger failed:", res.status, errText);
      serverTriggerResult = {
        success: false,
        emergencyId: opts.emergencyId,
        tier,
        error: `HTTP ${res.status}: ${errText}`,
      };
      return serverTriggerResult;
    }

    const data = await res.json();
    serverTriggerResult = {
      success: true,
      emergencyId: opts.emergencyId,
      tier,
      trackUrl: data.trackUrl,
      dashUrl: data.dashUrl,
      results: data.results,
    };

    console.log(`[SOS-Server] Path B SUCCESS:`, data.results?.length, "contacts processed");

    // Start heartbeat after successful trigger
    startHeartbeat(opts.emergencyId, opts.userId);

    return serverTriggerResult;
  } catch (err) {
    console.error("[SOS-Server] Path B FAILED (network):", err);
    serverTriggerResult = {
      success: false,
      emergencyId: opts.emergencyId,
      tier,
      error: err instanceof Error ? err.message : "Network error",
    };
    return serverTriggerResult;
  }
}

// ═══════════════════════════════════════════════════════════════
// 2. HEARTBEAT — every 30s while SOS is active
// If heartbeat stops → server knows device died
// ═══════════════════════════════════════════════════════════════
let heartbeatCount = 0;
const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds

function startHeartbeat(emergencyId: string, userId: string) {
  stopHeartbeat(); // Clear any existing
  heartbeatCount = 0;

  heartbeatInterval = setInterval(async () => {
    heartbeatCount++;
    const gps = getLastKnownPosition();
    const battery = getBatteryLevel(); // synchronous — returns number | null

    try {
      await fetchSOS("heartbeat", {
        emergencyId,
        userId,
        location: gps || undefined,
        batteryLevel: battery ?? undefined,
        elapsedSec: heartbeatCount * 30,
      });
      console.log(`[SOS-Server] Heartbeat #${heartbeatCount} sent (battery=${battery ? Math.round(battery * 100) + "%" : "?"})`);
    } catch (err) {
      console.warn("[SOS-Server] Heartbeat failed:", err);
      // Don't stop — keep trying. Server will notice gaps.
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  heartbeatCount = 0;
}

// ═══════════════════════════════════════════════════════════════
// 3. END SERVER SOS — called when user ends the emergency
// ═══════════════════════════════════════════════════════════════
export async function endServerSOS(opts: {
  emergencyId: string;
  reason?: string;
  recordingSec?: number;
  photos?: string[];
  comment?: string;
}): Promise<boolean> {
  stopHeartbeat();
  activeEmergencyId = null;
  serverTriggerResult = null;

  try {
    const res = await fetchSOS("end", {
      emergencyId: opts.emergencyId,
      reason: opts.reason || "user_ended",
      recordingSec: opts.recordingSec || 0,
      photos: opts.photos?.length ?? 0,
      comment: opts.comment || "",
    });

    console.log(`[SOS-Server] SOS ended on server: ${res.ok ? "OK" : "FAILED"}`);
    return res.ok;
  } catch (err) {
    console.warn("[SOS-Server] End SOS failed:", err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. SMART WATCHDOG — monitors local dialer state
// If local dialer doesn't open within 5s, escalate server triggers
// ═══════════════════════════════════════════════════════════════
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogState: WatchdogState = {
  localDialerOpened: false,
  localDialerRinging: false,
  serverTriggered: false,
  serverResults: null,
  elapsedMs: 0,
};

const WATCHDOG_TIMEOUT_MS = 5000; // 5 seconds

export function startWatchdog(
  onEscalate: (reason: string) => void
): void {
  watchdogState = {
    localDialerOpened: false,
    localDialerRinging: false,
    serverTriggered: false,
    serverResults: null,
    elapsedMs: 0,
  };

  const startTime = Date.now();

  watchdogTimer = setTimeout(() => {
    watchdogState.elapsedMs = Date.now() - startTime;

    // Check if local dialer opened successfully
    if (!watchdogState.localDialerOpened) {
      console.warn(`[SOS-Watchdog] ⚠ Local dialer NOT opened after ${WATCHDOG_TIMEOUT_MS}ms — ESCALATING`);
      onEscalate("local_dialer_timeout");
    } else if (!watchdogState.localDialerRinging) {
      console.warn(`[SOS-Watchdog] ⚠ Dialer opened but not ringing after ${WATCHDOG_TIMEOUT_MS}ms`);
      // Not critical — the call might still work. Just log it.
    }
  }, WATCHDOG_TIMEOUT_MS);
}

export function reportWatchdogEvent(event: "dialer_opened" | "dialer_ringing" | "call_active" | "call_ended") {
  if (event === "dialer_opened") watchdogState.localDialerOpened = true;
  if (event === "dialer_ringing") watchdogState.localDialerRinging = true;
  console.log(`[SOS-Watchdog] Event: ${event}`);
}

export function stopWatchdog() {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 5. STATUS GETTERS
// ═══════════════════════════════════════════════════════════════
export function getServerTriggerResult(): ServerTriggerResult | null {
  return serverTriggerResult;
}

export function isServerActive(): boolean {
  return activeEmergencyId !== null;
}

export function getActiveEmergencyId(): string | null {
  return activeEmergencyId;
}
