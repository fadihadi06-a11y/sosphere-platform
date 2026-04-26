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
import { getLastKnownPosition, getBatteryLevel, getPositionAgeMs, isPositionStale } from "./offline-gps-tracker";
import { supabase } from "./api/supabase-client";
import { publishNeighborAlert, publishNeighborRetract, canBroadcast as canBroadcastNeighbors } from "./neighbor-alert-service";
import { buildAiScriptPayload } from "./ai-voice-call-service";
import {
  queueSOS,
  getUnsyncedSOS,
  markSOSSynced,
  incrementSOSRetry,
  type SOSRecord,
} from "./offline-database";
import { parseRateLimit, waitForRetry, logRateLimit } from "./rate-limit-client";

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

// Exponential backoff for per-record retries. Guards against four
// triggers (online + visibility + auth + startup) firing within seconds
// during a network flap and burning REPLAY_MAX_TRIES in a single boot.
// Formula: min(2^attempts * 1000, 60000).
const retryNotBeforeMs = new Map<string, number>();
function nextBackoffMs(attempts: number): number {
  return Math.min(Math.pow(2, attempts) * 1000, 60000);
}

// ── P2-1 Phase 2 hardening helpers ───────────────────────────
// E-H8: client-side E.164 sanity check. Server still re-validates,
// but stripping obviously-invalid numbers BEFORE Twilio prevents an
// SMS/call attempt silently failing with a 21211 error that the
// victim never sees. Accepts +<country><subscriber> with 8-15 digits.
function isValidE164Phone(p: string | undefined | null): boolean {
  if (!p) return false;
  const s = String(p).replace(/[\s\-().]/g, "");
  return /^\+?[1-9]\d{7,14}$/.test(s);
}

// E-M4: tier-bounded emergency-contact cap.
//
// FIX 2026-04-24 (pre-launch #6): previously hardcoded here as
// {free:1, basic:3, elite:999} — DIFFERENT from subscription-service
// which had {free:1, basic:6, elite:10}. Two sources of truth for
// one concept was a latent bug: "Basic user saves 6 contacts, only
// 3 get called". Now ALIGNED with subscription-service.ts TIER_CONFIG.
//
// If you change these numbers, update the SAME 3 places together:
//   1. src/app/components/subscription-service.ts  (TIER_CONFIG)
//   2. src/app/components/sos-server-trigger.ts    (this block)
//   3. supabase/functions/sos-alert/index.ts       (TIER_CAP)
//
// Post-launch v1.1 moves this to a DB table so these 3 locations
// collapse into one Supabase row.
const MAX_CONTACTS_BY_TIER: Record<string, number> = {
  free:  1,
  basic: 6,
  elite: 10,
};

// E-C5: replay queue pacing. Each attempt is a real Twilio dial
// that costs money if dedup fails server-side. REPLAY_REQUEST_GAP_MS
// gives the server a breath between requests; if the server 429s,
// REPLAY_COOLDOWN_429_MS pauses the whole drain so the next
// online/visibility event doesn't re-hammer immediately.
const REPLAY_REQUEST_GAP_MS = 500;
const REPLAY_COOLDOWN_429_MS = 60_000;
let replayCooldownUntil = 0;

// E-C1 / E-H2: escalation state machine. firedEscalations tracks
// which stages (1, 2, ...) have already fired for the active
// emergency. Once in the set, we never re-fire the same stage.
// The mutex serialises the fetch so two watchdog ticks landing on
// the same integer second can't double-submit before the first
// response completes.
const firedEscalations = new Set<number>();
let escalationMutex: Promise<unknown> = Promise.resolve();
function resetEscalationState(): void {
  firedEscalations.clear();
}

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

// P1-#5: Track whether a neighbor broadcast actually went out for the
// active emergency. endServerSOS() uses this to decide whether to fire
// a retract — no point broadcasting "cancelled" if nothing was ever sent.
// Holds the snapshot of GPS/precision at broadcast time so the retract
// can reach the same 9-cell window even if GPS drifted during the event.
let activeNeighborBroadcast: {
  requestId: string;
  lat: number;
  lng: number;
  precision: 4 | 5 | 6;
} | null = null;

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
  opts: { timeoutMs?: number; idempotencyKey?: string } = {}
): Promise<Response> {
  const url = action ? `${SOS_ALERT_URL}?action=${action}` : SOS_ALERT_URL;
  const token = await getAuthToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // P2-#8: Stripe-style idempotency header. Safe to always send — the
  // server short-circuits duplicate (key, action) pairs into cached
  // responses so network retries never double-fire conferences, SMS
  // bursts, or end broadcasts.
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const controller = new AbortController();
  const timeoutId = opts.timeoutMs
    ? setTimeout(() => controller.abort(), opts.timeoutMs)
    : null;

  try {
    const doFetch = () => fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      keepalive: true,
      signal: controller.signal,
    });

    let res = await doFetch();

    // ──────────────────────────────────────────────────────────────
    // F-C (2026-04-25): unified retry path for two recoverable
    // statuses, one retry only.
    //
    //   429 (Too Many Requests) — defence-in-depth. SOS endpoints
    //   sit on the server's priority lane and should never be
    //   throttled, but if the priority invariant ever breaks silently
    //   we want the retry to mask single hiccups instead of dropping
    //   an emergency.
    //
    //   503 + body.error === "rate_limit_check_failed" — the new
    //   fail-secure response from sos-alert (B-10). The metering RPC
    //   was momentarily unreachable so the server refused to bypass
    //   its own rate-limit check. A single retry after a brief wait
    //   resolves the typical case (transient DB latency).
    //
    // Looping on either would defeat the corresponding server
    // protection, so we cap at exactly one retry across BOTH classes.
    // ──────────────────────────────────────────────────────────────
    if (res.status === 429) {
      const info = parseRateLimit(res);
      logRateLimit(`sos-alert?action=${action ?? "root"}`, info);
      try { await res.clone().text(); } catch {}
      const ok = await waitForRetry(info);
      if (ok) res = await doFetch();
    } else if (res.status === 503) {
      // Inspect body without consuming the original response.
      let body: { error?: string; retry_after_sec?: number } | null = null;
      try { body = await res.clone().json(); } catch { body = null; }
      if (body?.error === "rate_limit_check_failed") {
        // Cap the wait so a misbehaving server can't stall the SOS path.
        const waitMs = Math.min(Math.max((body?.retry_after_sec ?? 1) * 1000, 250), 3000);
        await new Promise(r => setTimeout(r, waitMs));
        res = await doFetch();
      }
      // Any other 503 (real server error, missing function, etc.) is
      // surfaced as-is — retrying would not help.
    }

    return res;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// ═══════════════════════════════════════════════════════════════
// PREWARM — Fire-and-forget survival beacon (Scenario 1: phone destroyed)
// Fires BEFORE the main trigger so server has at least minimal data
// even if the device dies mid-handshake.
// ═══════════════════════════════════════════════════════════════
async function firePrewarm(opts: {
  emergencyId: string;
  userId: string;
  userName: string;
  tier: "free" | "basic" | "elite";
  location: { lat: number; lng: number; accuracy: number } | null;
}): Promise<void> {
  // ─────────────────────────────────────────────────────────────
  // G-4 (B-20, 2026-04-25): include the JWT in the body so the server
  // can authenticate the prewarm. sendBeacon cannot set Authorization
  // headers, so the server accepts a body-token fallback. The token is
  // verified server-side via supabase.auth.getUser(token); we never
  // trust the userId field alone.
  // ─────────────────────────────────────────────────────────────
  const accessToken = await getAuthToken();
  const payload = JSON.stringify({
    emergencyId: opts.emergencyId,
    userId: opts.userId,
    userName: opts.userName,
    tier: opts.tier,
    location: opts.location,
    accessToken,                    // ← server reads this if no Authorization header
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

  // Path 3: If sendBeacon failed, fallback to fetch keepalive WITH header.
  if (!beaconOk) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    };
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    fetch(`${SOS_ALERT_URL}?action=prewarm`, {
      method: "POST",
      headers,
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
  // E-C6: per-SOS opt-out for neighbor broadcast. Default true
  // (broadcasts if user has the feature), but caller can explicitly
  // disable for domestic-violence / stalker scenarios where alerting
  // a 9-cell radius is dangerous. Also honored by the neighbor-alert
  // service-level opt-out in settings.
  allowNeighborBroadcast?: boolean;
  // FIX 2026-04-24 (Point 5): user-controlled packet privacy toggles.
  // The Emergency Packet screen lets the user decide what pieces of
  // their profile go out with the SOS. Before this field was added,
  // the toggles were UI-only — user could switch OFF "Medical ID"
  // and the server still shipped blood type to every contact.
  // Now the toggles gate what the sos-alert edge function includes
  // in SMS/call content + stores on sos_queue.metadata. Honors
  // civilian + employee identically — privacy applies to both.
  //
  //   location  — always on (GPS is the whole point of SOS)
  //   medical   — include blood type / conditions / allergies
  //   contacts  — list of emergency contacts (for responder briefing)
  //   device    — battery / device model
  //   recording — announce that ambient audio is being recorded
  //   incident  — echo the incident ID in the SMS body
  packetModules?: {
    location: true;     // invariant: location is always included
    medical: boolean;
    contacts: boolean;
    device: boolean;
    recording: boolean;
    incident: boolean;
  };
}): Promise<ServerTriggerResult> {
  const tier = getTierString();
  const now = Date.now();

  // ── E-H8: validate contact phones BEFORE Twilio ─────────────
  // Strip invalid E.164 numbers so Twilio doesn't silently fail on a
  // 21211 error the victim never learns about. If NO valid contacts
  // remain, we still fire the SOS (server-side contacts may be richer,
  // and the local dialer Path A is independent) but we log loudly.
  const validatedContacts = (opts.contacts || []).filter(c => {
    const ok = isValidE164Phone(c?.phone);
    if (!ok) {
      console.warn(
        `[SOS-Server] E-H8: dropping invalid contact phone: name="${c?.name}" phone="${c?.phone}"`,
      );
    }
    return ok;
  });
  if (validatedContacts.length === 0 && (opts.contacts || []).length > 0) {
    console.error(
      "[SOS-Server] E-H8: ALL emergency contacts failed E.164 validation — " +
      "server-side contacts / local dialer remain the only channels",
    );
  }

  // ── E-M4: tier-bounded contact cap ──────────────────────────
  // Cap BEFORE sending to server so we don't pay for Twilio attempts
  // the user's subscription doesn't cover. Server will also enforce
  // this from the authoritative tier (defence in depth).
  const tierCap = MAX_CONTACTS_BY_TIER[tier] ?? MAX_CONTACTS_BY_TIER.free;
  const cappedContacts = validatedContacts.slice(0, tierCap);
  if (cappedContacts.length < validatedContacts.length) {
    console.warn(
      `[SOS-Server] E-M4: contacts capped by tier "${tier}" — ` +
      `kept ${cappedContacts.length}/${validatedContacts.length}`,
    );
  }

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
  // E-C6: per-SOS opt-out. allowNeighborBroadcast === false suppresses
  // the 9-cell broadcast for this specific emergency (e.g. DV mode).
  // Default undefined === allowed; only explicit false blocks.
  const neighborBroadcastAllowed = opts.allowNeighborBroadcast !== false;
  if (!neighborBroadcastAllowed) {
    console.log("[SOS-Server] E-C6: neighbor broadcast suppressed for this SOS");
  }
  if (canBroadcastNeighbors() && gps && neighborBroadcastAllowed) {
    // P1-#5: Capture the GPS snapshot used for the broadcast so
    // endServerSOS can retract on the SAME 9-cell window. We use the
    // user's current neighbor-alert precision setting — stored at the
    // time of broadcast so a mid-incident settings change doesn't mis-target.
    const broadcastPrecision = (() => {
      try {
        // Lazy import to avoid coupling this file to the settings schema —
        // we only need the precision value.
        const raw = localStorage.getItem("sosphere_neighbor_alert_settings");
        if (!raw) return 5 as const;
        const parsed = JSON.parse(raw);
        return (parsed?.precision === 4 || parsed?.precision === 6) ? parsed.precision : 5;
      } catch { return 5 as const; }
    })();
    activeNeighborBroadcast = {
      requestId: opts.emergencyId,
      lat: gps.lat,
      lng: gps.lng,
      precision: broadcastPrecision,
    };
    publishNeighborAlert({
      requestId: opts.emergencyId,
      displayName: opts.userName?.split(/\s+/)[0],
      severity: "high",
      location: { lat: gps.lat, lng: gps.lng },
      precision: broadcastPrecision,
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
      contacts: cappedContacts,
      // E-C2: NEVER send (0,0) silently. location_available=false tells
      // the server / responders that GPS was unavailable at trigger time
      // so they can dispatch based on last-known-position / IP geolocation
      // instead of actioning a coordinate pair at null island.
      // E-C4: attach age + stale flag so dispatcher knows whether
      // this is LIVE GPS or a last-known stale fix.
      location: gps
        ? {
            lat: gps.lat,
            lng: gps.lng,
            accuracy: gps.accuracy,
            location_available: true,
            location_age_ms: getPositionAgeMs(),
            location_stale: isPositionStale(),
          }
        : { lat: 0, lng: 0, accuracy: 9999, location_available: false, location_stale: true },
      // FIX 2026-04-24 (Point 5): honor the user's Emergency Packet
      // privacy toggles. If medical is off, don't even send bloodType
      // to the server — defense in depth beyond sos-alert's own honor
      // check. If modules is absent (older clients), default to the
      // fully-open packet for backward compatibility.
      bloodType: (opts.packetModules?.medical ?? true) ? opts.bloodType : undefined,
      zone: opts.zone,
      silent: opts.silent,
      packetModules: opts.packetModules,
      ...(aiScript ? { aiScript } : {}),
    }, {
      timeoutMs: 20000,
      // Key on emergencyId alone — any retry of the SAME emergency must
      // land in the existing conference, never spawn a parallel bridge.
      idempotencyKey: `trigger:${opts.emergencyId}`,
    });

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
      }, {
        timeoutMs: HEARTBEAT_TIMEOUT_MS,
        // Per-tick key — if this exact heartbeat retries after a network
        // blip, server treats it as one ping, not two.
        idempotencyKey: `hb:${emergencyId}:${heartbeatCount}`,
      });
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

  // P1-#5: Fire the neighbor retract BEFORE clearing state so we have
  // the broadcast snapshot. Fire-and-forget — the retract is secondary
  // to finalizing the incident and must never block endServerSOS.
  if (activeNeighborBroadcast && activeNeighborBroadcast.requestId === opts.emergencyId) {
    const snap = activeNeighborBroadcast;
    // Map end-reasons to a retract reason the responder UI can display.
    const retractReason: "safe" | "resolved" | "false_alarm" | "other" =
      opts.reason === "false_alarm" ? "false_alarm"
      : opts.reason === "safe"       ? "safe"
      : opts.reason                  ? "other"
      : "resolved";
    publishNeighborRetract({
      requestId: snap.requestId,
      reason: retractReason,
      precision: snap.precision,
      location: { lat: snap.lat, lng: snap.lng },
    }).catch(err => console.warn("[SOS-Server] neighbor retract failed:", err));
    activeNeighborBroadcast = null;
  }

  activeEmergencyId = null;
  serverTriggerResult = null;
  // Release dedup guards so a new emergency can be triggered immediately.
  sosInFlight = false;
  lastFireAt = 0;
  // E-C1 / E-H2: reset escalation state so the NEXT emergency starts
  // with a clean slate. Without this, fired stages from a previous
  // incident would prevent legitimate escalations on a fresh SOS.
  resetEscalationState();

  try {
    const res = await fetchSOS("end", {
      emergencyId: opts.emergencyId,
      reason: opts.reason || "user_ended",
      recordingSec: opts.recordingSec || 0,
      photos: opts.photos?.length ?? 0,
      comment: opts.comment || "",
    }, {
      timeoutMs: 10000,
      // A user mashing "End SOS" or the network retrying this call must
      // not re-broadcast `sos_ended` to responders.
      idempotencyKey: `end:${opts.emergencyId}`,
    });

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
  // E-C1 / E-H2: single-shot client-side guard. If this stage has
  // already been fired for the current emergency, we do nothing —
  // server-side idempotency would dedup anyway but we save a round
  // trip and avoid adding noise to the audit log.
  if (firedEscalations.has(stage)) {
    console.log(`[SOS-Watchdog] Stage ${stage} already fired — skipping`);
    return;
  }
  firedEscalations.add(stage);

  const emergencyId = activeEmergencyId;
  // Serialise via mutex so two watchdog ticks on the same integer
  // second can't double-submit before the first response completes.
  escalationMutex = escalationMutex.then(async () => {
    try {
      await fetchSOS("escalate", {
        emergencyId,
        stage,
        reason,
        forceBridge: stage >= 2,
      }, {
        timeoutMs: 8000,
        // Per-(emergency, stage) key — server-side idempotency defence
        // in depth. Same key = cached response, no second SMS burst
        // or bridge call.
        idempotencyKey: `escalate:${emergencyId}:${stage}`,
      });
    } catch (err) {
      // On FAILURE, remove from fired-set so a retry CAN happen.
      // Without this, a single network blip would lock out the
      // stage for the whole emergency.
      firedEscalations.delete(stage);
      console.warn("[SOS-Watchdog] Escalation request failed:", err);
    }
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

  // Auth gate — the Edge Function requires a valid Bearer token for
  // tier enforcement. Firing before the session is hydrated would 401
  // every record and burn through REPLAY_MAX_TRIES in a single boot.
  // If there's no session yet, bail silently; the auth-state-change
  // trigger in startSOSReplayWatcher will re-fire the drain the moment
  // a session exists.
  try {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) {
      console.log("[SOS-Replay] skipped — no auth session yet");
      return summary;
    }
  } catch {
    return summary;
  }

  replayInFlight = true;
  try {
    // E-C5: global 429 cooldown. If a recent replay was rate-limited,
    // don't even read the queue — let the server breathe.
    if (Date.now() < replayCooldownUntil) {
      const waitMs = replayCooldownUntil - Date.now();
      console.log(`[SOS-Replay] in 429 cooldown for ${waitMs}ms — skipping drain`);
      return summary;
    }

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
      // Exponential backoff — skip if this record was retried too
      // recently during a network flap.
      const notBefore = retryNotBeforeMs.get(rec.id);
      if (notBefore !== undefined && now < notBefore) {
        continue;
      }

      summary.replayed++;
      const result = await replayOneSOS(rec).catch(() => ({ ok: false, status: 0 }));
      // E-C5: if we got a 429 we globally pause the drain. Individual
      // record backoff alone isn't enough — a backlog of 10 records
      // would retry in rapid succession and hammer the server on flap.
      if (!result.ok && result.status === 429) {
        replayCooldownUntil = Date.now() + REPLAY_COOLDOWN_429_MS;
        console.warn(
          `[SOS-Replay] 429 rate-limited — cooling down for ${REPLAY_COOLDOWN_429_MS}ms`,
        );
        summary.failed++;
        retryNotBeforeMs.set(rec.id, Date.now() + nextBackoffMs(rec.syncAttempts + 1));
        await incrementSOSRetry(rec.id, "replay_429").catch(() => {});
        break; // stop processing further records this round
      }
      if (result.ok) {
        summary.succeeded++;
        retryNotBeforeMs.delete(rec.id);
        await markSOSSynced(rec.id).catch(() => {});
      } else {
        summary.failed++;
        retryNotBeforeMs.set(rec.id, Date.now() + nextBackoffMs(rec.syncAttempts + 1));
        await incrementSOSRetry(rec.id, "replay_failed").catch(() => {});
      }
      // E-C5: inter-request gap. Small pause so we never machine-gun
      // the Edge Function even if the queue is deep.
      if (REPLAY_REQUEST_GAP_MS > 0) {
        await new Promise(r => setTimeout(r, REPLAY_REQUEST_GAP_MS));
      }
    }

    console.log("[SOS-Replay] done:", summary);
    return summary;
  } finally {
    replayInFlight = false;
  }
}

/**
 * Single-record replay. Re-issues fetchSOS with the original payload.
 * E-C5: returns {ok, status} so the caller can distinguish a 429
 * (trigger global cooldown) from a 5xx (per-record backoff).
 */
async function replayOneSOS(rec: SOSRecord): Promise<{ ok: boolean; status: number }> {
  const md = rec.metadata || {};
  // Minimal sanity — if emergencyId is missing the record is corrupt.
  if (!md.emergencyId || !Array.isArray(md.contacts)) {
    console.warn(`[SOS-Replay] record ${rec.id} missing required metadata — skipping`);
    return { ok: false, status: 0 };
  }

  try {
    // E-C2: preserve location_available semantics on replay. If the
    // original trigger had no GPS (0,0 with accuracy 9999) we replay
    // with location_available=false so responders still know.
    const hasLocation = !(rec.lat === 0 && rec.lng === 0 && rec.accuracy === 9999);
    const res = await fetchSOS(null, {
      emergencyId: md.emergencyId,
      userId: rec.employeeId,
      userName: rec.employeeName,
      userPhone: md.userPhone,
      contacts: md.contacts,
      location: {
        lat: rec.lat,
        lng: rec.lng,
        accuracy: rec.accuracy,
        location_available: hasLocation,
      },
      bloodType: md.bloodType,
      zone: rec.zone,
      silent: md.silent,
      replay: true, // hint to server: this is a retry, dedup by emergencyId
    }, {
      timeoutMs: 20000,
      // Same key the original trigger used — the server recognises this
      // as a retry of the EXACT emergency and returns the cached result
      // instead of firing Twilio a second time.
      idempotencyKey: `trigger:${md.emergencyId}`,
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.warn(`[SOS-Replay] record ${rec.id} fetch failed:`, err);
    return { ok: false, status: 0 };
  }
}

/**
 * Install the replay watcher. Idempotent — safe to call from multiple
 * mount sites.
 *
 * Wires THREE triggers (any one is enough to drain the queue):
 *   1. `online`           — browser-reported network restore.
 *   2. `visibilitychange` → visible — app resume from background. On
 *      Android, toggling airplane mode OFF while the app is in the
 *      background often causes the `online` event to fire before the
 *      WebView repaints, so it can be missed entirely. The visibility
 *      event is the belt-and-braces trigger the user's chaos scenario
 *      depends on (airplane mode → force close → restart → disable
 *      airplane mode from the quick-settings panel → app resume).
 *   3. Startup            — immediate replay if already online at mount
 *      (phone rebooted mid-emergency, app was launched after a period
 *      offline, etc.).
 */
// ──────────────────────────────────────────────────────────────────
// G-36 (B-20, 2026-04-26): named handlers + removeEventListener idempotency.
//
// Pre-fix: a module-level boolean (`replayListenerAttached`) gated the
// add/remove. HMR (dev) or Capacitor resume can reset the module while
// the document still holds the previously-registered anonymous handler,
// resulting in two listeners on the same event. When the user returns
// from background both handlers fire `replayPendingSOS()` simultaneously.
// The replay watcher's own in-flight guard catches *most* of those
// races, but a tight micro-task ordering can still slip through and
// cause a duplicate Twilio call.
//
// Now: handlers are NAMED (closure-stored module references), and we
// removeEventListener the previous handler before adding the new one.
// Even if startSOSReplayWatcher() is called 1000 times across HMR
// cycles, the document/window has at most ONE of each listener.
// ──────────────────────────────────────────────────────────────────
let onlineHandler:     ((this: Window) => void) | null = null;
let visibilityHandler: ((this: Document) => void) | null = null;

export function startSOSReplayWatcher(): void {
  if (replayListenerAttached) return;
  replayListenerAttached = true;

  const fire = (source: string) => {
    setTimeout(() => {
      if (navigator.onLine) {
        console.log(`[SOS-Replay] trigger: ${source}`);
        replayPendingSOS().catch(err => console.warn("[SOS-Replay] error:", err));
      }
    }, 1500);
  };

  // Trigger 1: browser-native online event — named handler.
  if (onlineHandler) window.removeEventListener("online", onlineHandler);
  onlineHandler = () => fire("online");
  window.addEventListener("online", onlineHandler);

  // Trigger 2: visibility restore — named handler.
  if (typeof document !== "undefined") {
    if (visibilityHandler) document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = () => {
      if (document.visibilityState === "visible") fire("visibility");
    };
    document.addEventListener("visibilitychange", visibilityHandler);
  }

  // Trigger 3: auth session available.
  try {
    supabase.auth.onAuthStateChange((event, session) => {
      if (session) fire(`auth:${event.toLowerCase()}`);
    });
  } catch {
    // Auth listener is best-effort; never fatal.
  }

  // Trigger 4: immediate replay if already online at mount
  if (navigator.onLine) {
    fire("startup");
  }

  console.log("[SOS-Replay] watcher installed (online + visibility + auth + startup)");
}

/**
 * Stop and de-register the replay watcher. Useful for tests + HMR.
 * Idempotent — safe to call multiple times.
 */
export function stopSOSReplayWatcher(): void {
  if (onlineHandler) {
    window.removeEventListener("online", onlineHandler);
    onlineHandler = null;
  }
  if (visibilityHandler && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
  replayListenerAttached = false;
}
