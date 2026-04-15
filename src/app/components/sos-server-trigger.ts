// ═══════════════════════════════════════════════════════════════
// SOSphere — SOS Server Trigger (Path B) — HARDENED v2
// Handles all server-side communication during SOS:
//   1. triggerServerSOS()  — fires on SOS activation (parallel to local call)
//   2. sendHeartbeat()     — pings every 30s with GPS + battery (in-flight guarded)
//   3. endServerSOS()      — notifies server when SOS ends
//   4. Progressive watchdog with REAL server escalation at 5s / 15s
//   5. Fire-and-forget prewarm via sendBeacon + native fallback
//
// Hardening over v1:
//   • sendBeacon prewarm with action=prewarm (URL param, not body)
//   • Native prewarm fallback through SOSphereNative.nativePrewarm()
//   • Heartbeat: AbortController + in-flight guard (no stacking on network flap)
//   • Heartbeat starts IMMEDIATELY (before main fetch awaits)
//   • Watchdog: progressive, actually escalates to server at t=5s and t=15s
//   • JWT token attached on every server request for tier enforcement
// ═══════════════════════════════════════════════════════════════

import { getSubscription, type SubscriptionTier } from "./subscription-service";
import { getLastKnownPosition, getBatteryLevel } from "./offline-gps-tracker";
import { supabase } from "./api/supabase-client";
import { publishNeighborAlert, canBroadcast as canBroadcastNeighbors } from "./neighbor-alert-service";
import { buildAiScriptPayload } from "./ai-voice-call-service";
import {
  queueSOS,
  getUnsyncedSOS,
  markSOSSynced,
  incrementSOSRetry,
  type SOSRecord,
} from "./offline-database";

// ── Config ───────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const SOS_ALERT_URL = `${SUPABASE_URL}/functions/v1/sos-alert`;

// ── Offline queue config ─────────────────────────────────────
// SOS events queue to IndexedDB before any network call so nothing
// is lost on a dead connection. Replay obeys these limits:
//
//   REPLAY_TTL_MS    — events older than this are NOT re-fired to
//                      Twilio (we don't want to ring contacts about
//                      an emergency that ended hours ago). They stay
//                      marked unsynced as a forensic audit record.
//   REPLAY_MAX_TRIES — after this many attempts we stop replaying
//                      a given record. It remains in the DB for
//                      manual inspection / sync later.
const REPLAY_TTL_MS = 15 * 60 * 1000; // 15 minutes
const REPLAY_MAX_TRIES = 5;
let replayInFlight = false;
let replayListenerAttached = false;

// ── State ────────────────────────────────────────────────────
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let heartbeatInFlight = false;
let heartbeatMissed = 0;
let activeEmergencyId: string | null = null;
let serverTriggerResult: ServerTriggerResult | null = null;

// ── Dedup guard (double-tap / re-render protection) ─────────
// Two layers:
//   1. `sosInFlight` — hard lock while a trigger is mid-flight.
//      A concurrent call returns immediately with the cached result.
//   2. `lastFireAt` — soft window. Even after in-flight clears, a
//      second call within DEDUP_WINDOW_MS is treated as a duplicate
//      (panicked users frequently double-tap the button).
//
// Both are released by endServerSOS() so the user can legitimately
// re-trigger after ending a previous emergency.
let sosInFlight = false;
let lastFireAt = 0;
const DEDUP_WINDOW_MS = 3000;

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
  localCallActive: boolean;
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

// Get JWT access token for server-side auth
async function getAuthToken(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function fetchSOS(
  action: string | null,
  body: Record<string, unknown>,
  opts: { timeoutMs?: number } = {}
): Promise<Response> {
  const url = action ? `${SOS_ALERT_URL}?action=${action}` : SOS_ALERT_URL;
  const token = await getAuthToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeoutId = opts.timeoutMs
    ? setTimeout(() => controller.abort(), opts.timeoutMs)
    : null;

  try {
    return await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      keepalive: true,
      signal: controller.signal,
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// ═══════════════════════════════════════════════════════════════
// PREWARM — Fire-and-forget survival beacon (Scenario 1: phone destroyed)
// Fires BEFORE the main trigger so server has at least minimal data
// even if the device dies mid-handshake.
// ═══════════════════════════════════════════════════════════════
function firePrewarm(opts: {
  emergencyId: string;
  userId: string;
  userName: string;
  tier: "free" | "basic" | "elite";
  location: { lat: number; lng: number; accuracy: number } | null;
}): void {
  const payload = JSON.stringify({
    emergencyId: opts.emergencyId,
    userId: opts.userId,
    userName: opts.userName,
    tier: opts.tier,
    location: opts.location,
    ts: Date.now(),
  });

  // Path 1: sendBeacon (browser-guaranteed delivery during unload/crash)
  let beaconOk = false;
  try {
    beaconOk = navigator.sendBeacon(`${SOS_ALERT_URL}?action=prewarm`, payload);
  } catch {}

  // Path 2: Native Android fallback (survives Capacitor WebView death)
  try {
    (window as any).SOSphereNative?.nativePrewarm?.(
      opts.emergencyId,
      opts.userId,
      opts.userName,
      opts.tier,
      opts.location?.lat ?? 0,
      opts.location?.lng ?? 0
    );
  } catch {}

  // Path 3: If sendBeacon failed, fallback to fetch keepalive
  if (!beaconOk) {
    fetch(`${SOS_ALERT_URL}?action=prewarm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }
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
  const now = Date.now();

  // ── DEDUP GUARD ─────────────────────────────────────────────
  // Layer 1: reject concurrent fires (double-tap within same tick)
  if (sosInFlight) {
    console.warn("[SOS-Server] ⚠ DEDUP: trigger called while in-flight — ignored");
    return serverTriggerResult ?? {
      success: false,
      emergencyId: activeEmergencyId ?? opts.emergencyId,
      tier,
      error: "duplicate_call_in_flight",
    };
  }
  // Layer 2: reject rapid re-fires within the dedup window
  if (activeEmergencyId && (now - lastFireAt) < DEDUP_WINDOW_MS) {
    console.warn(`[SOS-Server] ⚠ DEDUP: re-fire ${now - lastFireAt}ms after last trigger — ignored`);
    return serverTriggerResult ?? {
      success: false,
      emergencyId: activeEmergencyId,
      tier,
      error: "duplicate_call_within_window",
    };
  }
  sosInFlight = true;
  lastFireAt = now;

  const gps = getLastKnownPosition();
  const battery = getBatteryLevel();

  console.log(`[SOS-Server] ═══ Path B FIRED ═══ tier=${tier} contacts=${opts.contacts.length} silent=${!!opts.silent}`);

  activeEmergencyId = opts.emergencyId;

  // ── OFFLINE-FIRST QUEUE ─────────────────────────────────────
  // Persist the event to IndexedDB BEFORE any network call. If the
  // fetch below fails (dead zone, captive portal, Supabase outage)
  // this record survives in the queue and replayPendingSOS() will
  // retry on reconnect. Fire-and-forget — we never block SOS on DB I/O.
  const queuedRecordId = await enqueueSOS(opts, tier, gps, battery).catch(err => {
    console.warn("[SOS-Server] enqueueSOS failed (non-fatal):", err);
    return null;
  });

  // STEP 1 — Fire prewarm FIRST (survival beacon)
  firePrewarm({
    emergencyId: opts.emergencyId,
    userId: opts.userId,
    userName: opts.userName,
    tier,
    location: gps,
  });

  // STEP 1b — Fire neighbor alert (Elite + opt-in only).
  // Fire-and-forget: never awaited, never thrown — primary SOS path
  // must not be slowed down by this secondary broadcast.
  if (canBroadcastNeighbors() && gps) {
    publishNeighborAlert({
      requestId: opts.emergencyId,
      displayName: opts.userName?.split(/\s+/)[0],
      severity: "high",
      location: { lat: gps.lat, lng: gps.lng },
    }).catch(() => { /* silent */ });
  }

  // STEP 2 — Start heartbeat IMMEDIATELY (don't wait for main fetch)
  // If main fetch fails, heartbeats still keep server informed
  startHeartbeat(opts.emergencyId, opts.userId);

  try {
    // Build AI voice script payload (Elite only — returns null otherwise,
    // in which case the server's default TwiML <Say> script is used).
    const aiScript = buildAiScriptPayload({
      name: opts.userName,
      location: gps
        ? `${gps.address || "GPS"} (${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)})`
        : undefined,
      time: new Date(),
    });

    const res = await fetchSOS(null, {
      emergencyId: opts.emergencyId,
      userId: opts.userId,
      userName: opts.userName,
      userPhone: opts.userPhone,
      // tier is NOT trusted server-side — will be overridden by DB lookup
      contacts: opts.contacts,
      location: gps || { lat: 0, lng: 0, accuracy: 9999 },
      bloodType: opts.bloodType,
      zone: opts.zone,
      silent: opts.silent,
      ...(aiScript ? { aiScript } : {}),
    }, { timeoutMs: 20000 });

    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      console.error("[SOS-Server] Server trigger failed:", res.status, errText);
      // Record stays unsynced in the queue — replay will retry it on
      // reconnect. Bump the attempt counter for backoff accounting.
      if (queuedRecordId) {
        incrementSOSRetry(queuedRecordId, `HTTP ${res.status}`).catch(() => {});
      }
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
      tier: data.tier || tier, // Server may have overridden
      trackUrl: data.trackUrl,
      dashUrl: data.dashUrl,
      results: data.results,
    };

    // Mark the queued record synced — the server confirmed receipt.
    // We don't await this and swallow errors: the DB write is a
    // forensic breadcrumb, not part of the success contract.
    if (queuedRecordId) {
      markSOSSynced(queuedRecordId).catch(() => { /* forensic best-effort */ });
    }

    console.log(`[SOS-Server] Path B SUCCESS: tier=${data.tier} contacts=${data.results?.length}`);
    return serverTriggerResult;
  } catch (err) {
    console.error("[SOS-Server] Path B FAILED (network):", err);
    // Network-level failure is the exact case the offline queue exists
    // for. Leave the record unsynced and bump retries so replay will
    // pick it up when connectivity returns.
    if (queuedRecordId) {
      incrementSOSRetry(
        queuedRecordId,
        err instanceof Error ? err.message : "network_error"
      ).catch(() => {});
    }
    serverTriggerResult = {
      success: false,
      emergencyId: opts.emergencyId,
      tier,
      error: err instanceof Error ? err.message : "Network error",
    };
    return serverTriggerResult;
  } finally {
    // Release the hard in-flight lock. `lastFireAt` intentionally
    // stays set — the soft window keeps guarding against a panicked
    // double-press until endServerSOS() clears it.
    sosInFlight = false;
  }
}

// ═══════════════════════════════════════════════════════════════
// 2. HEARTBEAT — every 30s while SOS is active
// HARDENED: in-flight guard + AbortController (network flap safe)
// ═══════════════════════════════════════════════════════════════
let heartbeatCount = 0;
const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT_MS = 10000;  // 10 seconds per request

function startHeartbeat(emergencyId: string, userId: string) {
  stopHeartbeat(); // Clear any existing
  heartbeatCount = 0;
  heartbeatInFlight = false;
  heartbeatMissed = 0;

  heartbeatInterval = setInterval(async () => {
    // In-flight guard: don't stack requests on a flapping network
    if (heartbeatInFlight) {
      heartbeatMissed++;
      console.warn(`[SOS-Server] Heartbeat skipped — still in-flight (missed=${heartbeatMissed})`);
      return;
    }

    heartbeatCount++;
    heartbeatInFlight = true;

    const gps = getLastKnownPosition();
    const battery = getBatteryLevel(); // synchronous — returns number | null

    try {
      await fetchSOS("heartbeat", {
        emergencyId,
        userId,
        location: gps || undefined,
        batteryLevel: battery ?? undefined,
        elapsedSec: heartbeatCount * 30,
        missedBefore: heartbeatMissed,
      }, { timeoutMs: HEARTBEAT_TIMEOUT_MS });
      heartbeatMissed = 0; // Reset on successful send
      console.log(`[SOS-Server] Heartbeat #${heartbeatCount} sent (battery=${battery ? Math.round(battery * 100) + "%" : "?"})`);
    } catch (err) {
      console.warn("[SOS-Server] Heartbeat failed:", err);
      // Don't stop — keep trying. Server will notice gaps via pg_cron.
    } finally {
      heartbeatInFlight = false;
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  heartbeatCount = 0;
  heartbeatInFlight = false;
  heartbeatMissed = 0;
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
  // Release dedup guards so a new emergency can be triggered immediately.
  sosInFlight = false;
  lastFireAt = 0;

  try {
    const res = await fetchSOS("end", {
      emergencyId: opts.emergencyId,
      reason: opts.reason || "user_ended",
      recordingSec: opts.recordingSec || 0,
      photos: opts.photos?.length ?? 0,
      comment: opts.comment || "",
    }, { timeoutMs: 10000 });

    console.log(`[SOS-Server] SOS ended on server: ${res.ok ? "OK" : "FAILED"}`);
    return res.ok;
  } catch (err) {
    console.warn("[SOS-Server] End SOS failed:", err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. PROGRESSIVE WATCHDOG — REAL server escalation
// t=5s: Stage 1 → server fires SMS burst if local dialer didn't open
// t=15s: Stage 2 → server force-initiates recorded bridge call
// ═══════════════════════════════════════════════════════════════
let watchdogInterval: ReturnType<typeof setInterval> | null = null;
let watchdogStep = 0;
let watchdogState: WatchdogState = {
  localDialerOpened: false,
  localDialerRinging: false,
  localCallActive: false,
  serverTriggered: false,
  serverResults: null,
  elapsedMs: 0,
};

export function startWatchdog(
  onEscalate: (reason: string, stage: number) => void
): void {
  stopWatchdog();
  watchdogStep = 0;
  watchdogState = {
    localDialerOpened: false,
    localDialerRinging: false,
    localCallActive: false,
    serverTriggered: false,
    serverResults: null,
    elapsedMs: 0,
  };

  const startTime = Date.now();

  watchdogInterval = setInterval(() => {
    watchdogStep++;
    watchdogState.elapsedMs = Date.now() - startTime;

    // Stage 1: t=5s — local dialer should have opened by now
    if (watchdogStep === 5 && !watchdogState.localDialerOpened) {
      console.warn("[SOS-Watchdog] ⚠ Stage 1: local dialer NOT opened after 5s — escalating");
      fireEscalation(1, "local_dialer_timeout");
      onEscalate("local_dialer_timeout", 1);
    }

    // Stage 2: t=15s — call should be ringing or active
    if (watchdogStep === 15 && !watchdogState.localCallActive) {
      console.error("[SOS-Watchdog] ⚠ Stage 2: local call NOT active after 15s — forcing server bridge");
      fireEscalation(2, "local_call_timeout");
      onEscalate("local_call_timeout", 2);
    }

    // Stop after 30s — the watchdog's job is done
    if (watchdogStep >= 30) {
      stopWatchdog();
    }
  }, 1000);
}

function fireEscalation(stage: number, reason: string): void {
  if (!activeEmergencyId) return;
  fetchSOS("escalate", {
    emergencyId: activeEmergencyId,
    stage,
    reason,
    forceBridge: stage >= 2,
  }, { timeoutMs: 8000 }).catch(err => {
    console.warn("[SOS-Watchdog] Escalation request failed:", err);
  });
}

export function reportWatchdogEvent(
  event: "dialer_opened" | "dialer_ringing" | "call_active" | "call_ended"
) {
  if (event === "dialer_opened") watchdogState.localDialerOpened = true;
  if (event === "dialer_ringing") watchdogState.localDialerRinging = true;
  if (event === "call_active") watchdogState.localCallActive = true;
  if (event === "call_ended") {
    // Call ended normally — watchdog's job is done
    stopWatchdog();
  }
  console.log(`[SOS-Watchdog] Event: ${event}`);
}

export function stopWatchdog() {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
  watchdogStep = 0;
}

// ═══════════════════════════════════════════════════════════════
// 5. STATUS GETTERS
// ═══════════════════════════════════════════════════════════════
export function getServerTriggerResult(): ServerTriggerResult | null {
  return serverTriggerResult;
}

export function getWatchdogState(): WatchdogState {
  return { ...watchdogState };
}

export function getActiveEmergencyId(): string | null {
  return activeEmergencyId;
}

// ═══════════════════════════════════════════════════════════════
// 6. OFFLINE QUEUE + REPLAY
// ─────────────────────────────────────────────────────────────
// Guarantees no SOS event is lost to a dead connection.
// Flow:
//   • triggerServerSOS() calls enqueueSOS() BEFORE any network I/O.
//   • On fetch success → markSOSSynced(id).
//   • On fetch fail   → incrementSOSRetry(id) (record stays unsynced).
//   • On reconnect    → replayPendingSOS() re-fires fetchSOS for
//     every record younger than REPLAY_TTL_MS, up to REPLAY_MAX_TRIES.
//
// TTL exists for a reason: we don't want to re-ring a user's contacts
// about an emergency that ended hours ago. Stale records stay in the
// DB unsynced as a forensic trail but are not retried.
// ═══════════════════════════════════════════════════════════════

/** Persist a pending SOS event to IndexedDB. Returns the record id or null if DB is unavailable. */
async function enqueueSOS(
  opts: Parameters<typeof triggerServerSOS>[0],
  tier: "free" | "basic" | "elite",
  gps: ReturnType<typeof getLastKnownPosition>,
  battery: number | null,
): Promise<string | null> {
  try {
    // The entire opts payload is stashed in `metadata` so replay can
    // re-construct the exact fetchSOS call. tier is a snapshot — the
    // server will re-validate from DB anyway.
    return await queueSOS({
      employeeId: opts.userId,
      employeeName: opts.userName,
      zone: opts.zone || "",
      lat: gps?.lat ?? 0,
      lng: gps?.lng ?? 0,
      accuracy: gps?.accuracy ?? 9999,
      triggerMethod: "manual",
      severity: "high",
      timestamp: Date.now(),
      networkStatusAtTrigger: navigator.onLine ? "online" : "offline",
      batteryLevel: battery,
      metadata: {
        emergencyId: opts.emergencyId,
        userPhone: opts.userPhone,
        contacts: opts.contacts,
        bloodType: opts.bloodType,
        silent: opts.silent,
        tier,
      },
    });
  } catch (err) {
    console.warn("[SOS-Server] queueSOS failed:", err);
    return null;
  }
}

/**
 * Re-fire every unsynced SOS record that is still within the TTL
 * window. Called on `online` event and at app startup via
 * startSOSReplayWatcher().
 *
 * Safe to call concurrently — guarded by `replayInFlight`. Returns
 * a summary for callers that want to show UI feedback.
 */
export async function replayPendingSOS(): Promise<{
  replayed: number;
  succeeded: number;
  failed: number;
  skippedStale: number;
  skippedExhausted: number;
}> {
  const summary = { replayed: 0, succeeded: 0, failed: 0, skippedStale: 0, skippedExhausted: 0 };

  if (replayInFlight) {
    console.log("[SOS-Replay] already running, skipping");
    return summary;
  }
  if (!navigator.onLine) {
    console.log("[SOS-Replay] offline, skipping");
    return summary;
  }

  replayInFlight = true;
  try {
    const pending = await getUnsyncedSOS();
    if (pending.length === 0) return summary;

    console.log(`[SOS-Replay] found ${pending.length} unsynced record(s)`);
    const now = Date.now();

    for (const rec of pending) {
      // Skip stale records — we don't re-page contacts about old events.
      if (now - rec.timestamp > REPLAY_TTL_MS) {
        summary.skippedStale++;
        continue;
      }
      // Give up after too many attempts to avoid infinite loops.
      if (rec.syncAttempts >= REPLAY_MAX_TRIES) {
        summary.skippedExhausted++;
        continue;
      }

      summary.replayed++;
      const ok = await replayOneSOS(rec).catch(() => false);
      if (ok) {
        summary.succeeded++;
        await markSOSSynced(rec.id).catch(() => {});
      } else {
        summary.failed++;
        await incrementSOSRetry(rec.id, "replay_failed").catch(() => {});
      }
    }

    console.log("[SOS-Replay] done:", summary);
    return summary;
  } finally {
    replayInFlight = false;
  }
}

/** Single-record replay. Re-issues fetchSOS with the original payload. */
async function replayOneSOS(rec: SOSRecord): Promise<boolean> {
  const md = rec.metadata || {};
  // Minimal sanity — if emergencyId is missing the record is corrupt.
  if (!md.emergencyId || !Array.isArray(md.contacts)) {
    console.warn(`[SOS-Replay] record ${rec.id} missing required metadata — skipping`);
    return false;
  }

  try {
    const res = await fetchSOS(null, {
      emergencyId: md.emergencyId,
      userId: rec.employeeId,
      userName: rec.employeeName,
      userPhone: md.userPhone,
      contacts: md.contacts,
      location: { lat: rec.lat, lng: rec.lng, accuracy: rec.accuracy },
      bloodType: md.bloodType,
      zone: rec.zone,
      silent: md.silent,
      replay: true, // hint to server: this is a retry, dedup by emergencyId
    }, { timeoutMs: 20000 });
    return res.ok;
  } catch (err) {
    console.warn(`[SOS-Replay] record ${rec.id} fetch failed:`, err);
    return false;
  }
}

/**
 * Install the replay watcher. Idempotent — safe to call from multiple
 * mount sites. Hooks `window.online` and fires an initial replay on
 * startup (in case the app was launched after a period offline with
 * queued events).
 */
export function startSOSReplayWatcher(): void {
  if (replayListenerAttached) return;
  replayListenerAttached = true;

  const fire = () => {
    // small debounce — network flaps fire online/offline rapidly
    setTimeout(() => {
      if (navigator.onLine) {
        replayPendingSOS().catch(err => console.warn("[SOS-Replay] error:", err));
      }
    }, 1500);
  };

  window.addEventListener("online", fire);

  // Also replay once on startup in case we were launched with a
  // pending queue (phone rebooted mid-emergency, etc.).
  if (navigator.onLine) {
    fire();
  }

  console.log("[SOS-Replay] watcher installed");
}
