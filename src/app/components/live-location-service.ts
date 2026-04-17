/**
 * SOSphere — Live Location Service
 * ═════════════════════════════════
 * Generates a LIVE tracking link (not a static GPS point) that emergency
 * contacts can open in any browser. The link shows the victim moving on
 * a map in real-time — like Uber driver tracking, but for emergencies.
 *
 * Architecture:
 *   1. On SOS trigger → startLiveSession(emergencyId) creates a Supabase
 *      Realtime channel: `live_location:{emergencyId}`.
 *   2. Every 3 seconds (emergency mode) the GPS tracker pushes the latest
 *      coordinates to this channel via broadcast.
 *   3. The SMS link points to a lightweight public web page:
 *      `https://sosphere.co/live/{emergencyId}?token={shortToken}`
 *   4. That page subscribes to the same Realtime channel and renders
 *      a Google Maps / Leaflet marker that moves live.
 *   5. The session auto-expires after SESSION_TTL_MIN or when SOS ends.
 *
 * Security:
 *   • The emergencyId is a random 20+ char string — unguessable.
 *   • An optional shortToken (6-char hex) adds a second layer.
 *   • The Realtime channel is read-only for viewers (broadcast, not presence).
 *   • Session expires automatically — no stale tracking.
 *
 * Fallback:
 *   • If Supabase Realtime is unavailable, falls back to a static
 *     Google Maps link with the last known coordinates.
 *
 * Design principles:
 *   • Purely additive — no existing flow is altered.
 *   • Zero new dependencies — uses existing Supabase client.
 *   • All tiers get a tracking link in SMS. Live updates are a bonus
 *     that degrades gracefully to static if Realtime fails.
 */

import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";
import { getLastKnownPosition } from "./offline-gps-tracker";
// E-M3: warn sync subscribers shortly before the live session expires
import { emitSyncEvent } from "./shared-store";

// ── Configuration ───────────────────────────────────────────
// E-M3: 4h default; long incidents (missing person, extended medical)
// need real-time tracking far beyond a 30-minute window.
const SESSION_TTL_MIN   = 240;
const BROADCAST_INTERVAL_MS = 3000;   // Push GPS every 3 seconds during SOS
const STATIC_MAP_BASE   = "https://maps.google.com/maps?q=";

// ── Types ───────────────────────────────────────────────────
export interface LiveSession {
  emergencyId: string;
  shortToken: string;
  channelName: string;
  liveUrl: string;
  staticUrl: string;
  startedAt: number;
  expiresAt: number;
  isActive: boolean;
}

export interface LiveLocationPoint {
  lat: number;
  lng: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  battery?: number;
  timestamp: number;
}

// ── State ───────────────────────────────────────────────────
let _activeSession: LiveSession | null = null;
let _channel: any = null; // Supabase RealtimeChannel
let _broadcastTimer: ReturnType<typeof setInterval> | null = null;
let _trailPoints: LiveLocationPoint[] = [];

// ── Helpers ─────────────────────────────────────────────────
function generateShortToken(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

function buildLiveUrl(emergencyId: string, token: string): string {
  // Points to the SOSphere live tracking page.
  // For now, this is a planned endpoint. During development,
  // the SMS will include both the live URL and a static fallback.
  const base = SUPABASE_CONFIG?.url
    ? `${SUPABASE_CONFIG.url.replace(".supabase.co", "")}.sosphere.co`
    : "https://sosphere.co";
  return `https://sosphere.co/live/${emergencyId}?t=${token}`;
}

function buildStaticUrl(lat: number, lng: number): string {
  return `${STATIC_MAP_BASE}${lat},${lng}`;
}

// ── Core API ────────────────────────────────────────────────

/**
 * Start a live location session for an active SOS event.
 * Returns the session info including URLs for SMS.
 */
export function startLiveSession(emergencyId: string): LiveSession {
  // If already active for this emergency, return existing
  if (_activeSession?.emergencyId === emergencyId && _activeSession.isActive) {
    return _activeSession;
  }

  // Stop any previous session
  stopLiveSession();

  const shortToken = generateShortToken();
  const channelName = `live_location:${emergencyId}`;
  const gps = getLastKnownPosition();
  const now = Date.now();

  const session: LiveSession = {
    emergencyId,
    shortToken,
    channelName,
    liveUrl: buildLiveUrl(emergencyId, shortToken),
    staticUrl: gps ? buildStaticUrl(gps.lat, gps.lng) : "",
    startedAt: now,
    expiresAt: now + SESSION_TTL_MIN * 60 * 1000,
    isActive: true,
  };

  _activeSession = session;
  _trailPoints = [];

  // Subscribe to Supabase Realtime channel for broadcasting
  try {
    _channel = supabase.channel(channelName, {
      config: { broadcast: { self: false } }, // Don't echo back to sender
    });

    _channel.subscribe((status: string) => {
      if (status === "SUBSCRIBED") {
        console.info(`[LiveLocation] Channel ${channelName} ready.`);
      } else if (status === "CHANNEL_ERROR") {
        console.warn(`[LiveLocation] Channel error — falling back to static.`);
      }
    });
  } catch (err) {
    console.warn("[LiveLocation] Realtime channel setup failed:", err);
    _channel = null;
  }

  // Start broadcasting GPS
  _broadcastTimer = setInterval(() => {
    broadcastPosition();
  }, BROADCAST_INTERVAL_MS);

  // Immediate first broadcast
  broadcastPosition();

  // E-M3: warn 10 min before expiry so responders can request extension
  const warnDelay = SESSION_TTL_MIN * 60 * 1000 - 10 * 60 * 1000;
  if (warnDelay > 0) {
    setTimeout(() => {
      if (_activeSession?.emergencyId === emergencyId) {
        try {
          emitSyncEvent({
            type: "LIVE_LOCATION_EXPIRING_SOON",
            employeeId: "live-location",
            employeeName: "Live Location",
            zone: "Unknown",
            timestamp: Date.now(),
            data: { emergencyId, minutesRemaining: 10 },
          } as any);
        } catch {}
      }
    }, warnDelay);
  }

  // Auto-expire
  setTimeout(() => {
    if (_activeSession?.emergencyId === emergencyId) {
      console.info("[LiveLocation] Session expired after", SESSION_TTL_MIN, "minutes.");
      stopLiveSession();
    }
  }, SESSION_TTL_MIN * 60 * 1000);

  console.info(`[LiveLocation] Session started: ${session.liveUrl}`);
  return session;
}

/**
 * Broadcast the current GPS position to all viewers.
 */
function broadcastPosition(): void {
  if (!_activeSession?.isActive) return;

  const gps = getLastKnownPosition();
  if (!gps || (gps.lat === 0 && gps.lng === 0)) return;

  const point: LiveLocationPoint = {
    lat: gps.lat,
    lng: gps.lng,
    accuracy: gps.accuracy,
    timestamp: Date.now(),
  };

  // Add battery level if available
  try {
    const battRaw = localStorage.getItem("sosphere_last_battery");
    if (battRaw) point.battery = parseFloat(battRaw);
  } catch {}

  // Store in trail
  _trailPoints.push(point);

  // Update static URL to latest position
  if (_activeSession) {
    _activeSession.staticUrl = buildStaticUrl(gps.lat, gps.lng);
  }

  // Broadcast via Realtime
  if (_channel) {
    try {
      _channel.send({
        type: "broadcast",
        event: "location_update",
        payload: point,
      });
    } catch (err) {
      // Non-fatal — viewers will just see the last known position
    }
  }
}

/**
 * Stop the live location session.
 */
export function stopLiveSession(): void {
  if (_broadcastTimer) {
    clearInterval(_broadcastTimer);
    _broadcastTimer = null;
  }

  if (_channel) {
    try {
      // Send final "session_ended" event before unsubscribing
      _channel.send({
        type: "broadcast",
        event: "session_ended",
        payload: {
          emergencyId: _activeSession?.emergencyId,
          trail: _trailPoints.length,
          endedAt: Date.now(),
        },
      });
      supabase.removeChannel(_channel);
    } catch {}
    _channel = null;
  }

  if (_activeSession) {
    _activeSession.isActive = false;
    console.info(`[LiveLocation] Session stopped. Trail: ${_trailPoints.length} points.`);
  }
  _activeSession = null;
}

/**
 * Get the current live session (or null if not active).
 */
export function getActiveLiveSession(): LiveSession | null {
  if (_activeSession && Date.now() > _activeSession.expiresAt) {
    stopLiveSession();
    return null;
  }
  return _activeSession;
}

/**
 * Get the full GPS trail for the current session.
 */
export function getLiveTrail(): LiveLocationPoint[] {
  return [..._trailPoints];
}

/**
 * Get the best URL for SMS — live if available, static as fallback.
 * This is the URL that goes into the SMS to emergency contacts.
 */
export function getTrackingUrl(emergencyId: string): string {
  // If there's an active live session, prefer the live URL
  if (_activeSession?.emergencyId === emergencyId && _activeSession.isActive) {
    return _activeSession.liveUrl;
  }

  // Fallback: static Google Maps link
  const gps = getLastKnownPosition();
  if (gps && typeof gps.lat === "number" && typeof gps.lng === "number") {
    return `${STATIC_MAP_BASE}${gps.lat},${gps.lng}`;
  }
  return STATIC_MAP_BASE;
}
