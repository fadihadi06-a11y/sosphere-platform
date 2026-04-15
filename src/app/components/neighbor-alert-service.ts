// ═══════════════════════════════════════════════════════════════
// SOSphere — Neighbor Alert Service
// ─────────────────────────────────────────────────────────────
// Broadcasts an SOS signal to opted-in neighbors in the same geographic
// cell and routes incoming alerts into a subscriber callback.
//
// ── Architecture (privacy-first, zero-PII-on-wire) ──
//   • Geocell = geohash(lat,lng, precision=5)  ⇒ ~5km × 5km cells.
//     We listen on our own cell + the 8 immediate neighbors so that a
//     requester near a cell boundary still reaches subscribers across it.
//   • Transport = Supabase Realtime Broadcast. Each cell is a channel:
//       `neighbor:{geohash}`
//     Payload carries only: coarse lat/lng (rounded to 3 decimals ≈ 110m),
//     a request id, a timestamp, and an optional display name. No userId,
//     no phone, no address.
//   • Opt-in is explicit on BOTH sides:
//       – "Receive alerts" (neighborhoodWatch.receive) enables listeners.
//       – "Broadcast SOS to neighbors" (neighborhoodWatch.broadcast)
//         enables publishing on SOS trigger. Broadcast is Elite-only.
//   • Fallback — if Supabase isn't configured we use BroadcastChannel,
//     which makes the flow testable on a single device/browser.
//
// Public API:
//   getNeighborAlertSettings(): Settings
//   setNeighborAlertSettings(patch): void
//   canBroadcast(): boolean           ← Elite + opt-in
//   startNeighborListener(onAlert): stop()
//   publishNeighborAlert(opts): Promise<boolean>
//   respondToAlert(requestId, status): Promise<void>
//
// Storage keys:
//   sosphere_neighbor_alert_settings
//
// No external deps beyond the project's supabase client + GPS tracker.
// ═══════════════════════════════════════════════════════════════

import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";
import { getLastKnownPosition } from "./offline-gps-tracker";
import { hasFeature } from "./subscription-service";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
export interface NeighborAlertSettings {
  /** Listen for nearby SOS alerts (free, opt-in). */
  receive: boolean;
  /** Broadcast own SOS to nearby opted-in neighbors (Elite only). */
  broadcast: boolean;
  /** Cell precision. 5 ≈ 4.9km × 4.9km. 6 ≈ 1.2km × 0.6km. */
  precision: 4 | 5 | 6;
}

export interface NeighborAlertPayload {
  /** Unique id for this alert burst (used by responders to correlate). */
  requestId: string;
  /** ISO timestamp when the SOS fired on the requester's device. */
  ts: string;
  /** Coarse latitude (3 decimals ≈ 110m). */
  lat: number;
  /** Coarse longitude (3 decimals ≈ 110m). */
  lng: number;
  /** First name only, optional — requester can choose to remain anonymous. */
  displayName?: string;
  /** Requester's self-declared distress level, optional. */
  severity?: "low" | "medium" | "high";
}

export interface IncomingNeighborAlert extends NeighborAlertPayload {
  /** The geocell this alert came in on (informational for logs). */
  cell: string;
  /** Distance in km from the listener's last known position (null if unknown). */
  distanceKm: number | null;
}

export type NeighborAlertResponse = "on_the_way" | "calling_police" | "cannot_help";

// ─────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────
const STORAGE_KEY = "sosphere_neighbor_alert_settings";

const DEFAULTS: NeighborAlertSettings = {
  receive: false,
  broadcast: false,
  precision: 5,
};

export function getNeighborAlertSettings(): NeighborAlertSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<NeighborAlertSettings>;
    return {
      receive: !!parsed.receive,
      broadcast: !!parsed.broadcast,
      precision: (parsed.precision === 4 || parsed.precision === 6) ? parsed.precision : 5,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setNeighborAlertSettings(patch: Partial<NeighborAlertSettings>): NeighborAlertSettings {
  const current = getNeighborAlertSettings();
  const merged: NeighborAlertSettings = {
    receive: patch.receive ?? current.receive,
    broadcast: patch.broadcast ?? current.broadcast,
    precision: (patch.precision ?? current.precision) as 4 | 5 | 6,
  };
  // Elite gate — silently clamp broadcast off if user isn't Elite.
  if (merged.broadcast && !hasFeature("aiVoiceCalls")) {
    merged.broadcast = false;
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch {}
  return merged;
}

/** Elite check + opt-in — the publisher must satisfy both. */
export function canBroadcast(): boolean {
  return hasFeature("aiVoiceCalls") && getNeighborAlertSettings().broadcast;
}

// ─────────────────────────────────────────────────────────────
// Geohash (precision 1–6, Niemeyer's base32 alphabet)
// ─────────────────────────────────────────────────────────────
const GEOHASH_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";

export function encodeGeohash(lat: number, lng: number, precision = 5): string {
  let minLat = -90, maxLat = 90, minLng = -180, maxLng = 180;
  let bits = 0, bit = 0, evenBit = true;
  let hash = "";
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) { bits = (bits << 1) | 1; minLng = mid; }
      else            { bits = (bits << 1);     maxLng = mid; }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) { bits = (bits << 1) | 1; minLat = mid; }
      else            { bits = (bits << 1);     maxLat = mid; }
    }
    evenBit = !evenBit;
    if (++bit === 5) {
      hash += GEOHASH_ALPHABET[bits];
      bits = 0;
      bit = 0;
    }
  }
  return hash;
}

/**
 * Returns the 9-cell window (self + 8 neighbors) for a given hash, using
 * the cell centre and a small offset. Simple and good enough for the 5-char
 * precision we default to; we don't need the full Chen neighbour algorithm.
 */
export function neighborhoodCells(lat: number, lng: number, precision: 4 | 5 | 6 = 5): string[] {
  // Rough cell dimensions in degrees for each precision.
  const step: Record<number, number> = {
    4: 0.70,  // ≈ 78km
    5: 0.045, // ≈ 5km
    6: 0.006, // ≈ 0.6km
  };
  const d = step[precision];
  const cells = new Set<string>();
  for (const dLat of [-d, 0, d]) {
    for (const dLng of [-d, 0, d]) {
      cells.add(encodeGeohash(lat + dLat, lng + dLng, precision));
    }
  }
  return Array.from(cells);
}

// ─────────────────────────────────────────────────────────────
// Distance (Haversine, km)
// ─────────────────────────────────────────────────────────────
const EARTH_R_KM = 6371;

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ─────────────────────────────────────────────────────────────
// Coarse coordinate rounding (privacy)
// ─────────────────────────────────────────────────────────────
function coarse(n: number): number {
  return Math.round(n * 1000) / 1000; // 3 decimals ≈ 110m precision
}

// ─────────────────────────────────────────────────────────────
// Channel naming + a de-dupe cache for incoming alerts
// ─────────────────────────────────────────────────────────────
const channelName = (cell: string) => `neighbor:${cell}`;
const LOCAL_FALLBACK_CHANNEL = "sosphere_neighbor_alert_local";

const seenRequests = new Map<string, number>(); // requestId → expiry
const SEEN_TTL_MS = 10 * 60 * 1000;

function markSeen(id: string): boolean {
  const now = Date.now();
  // Sweep expired
  for (const [k, exp] of seenRequests) if (exp < now) seenRequests.delete(k);
  if (seenRequests.has(id)) return false;
  seenRequests.set(id, now + SEEN_TTL_MS);
  return true;
}

// ─────────────────────────────────────────────────────────────
// Listener
// ─────────────────────────────────────────────────────────────
export interface NeighborListenerHandle {
  stop: () => void;
  cells: string[];
}

/**
 * Subscribe to neighbor alerts for the current GPS cell and its neighbors.
 * Returns a handle; call `stop()` to unsubscribe. Safe to call multiple
 * times — each call returns an independent handle.
 *
 * If the user hasn't opted in (`receive === false`) this is a no-op and
 * returns a handle whose stop() is a no-op.
 */
export function startNeighborListener(
  onAlert: (alert: IncomingNeighborAlert) => void
): NeighborListenerHandle {
  const settings = getNeighborAlertSettings();
  if (!settings.receive) {
    return { stop: () => {}, cells: [] };
  }

  const pos = getLastKnownPosition();
  // If we have no location we still listen on a broad fallback so that
  // BroadcastChannel-based tests work even without GPS.
  const cells = pos
    ? neighborhoodCells(pos.lat, pos.lng, settings.precision)
    : [];

  // ── Supabase Realtime path ──
  if (SUPABASE_CONFIG.isConfigured && cells.length > 0) {
    const channels = cells.map((cell) => {
      const ch = supabase.channel(channelName(cell), {
        config: { broadcast: { self: false } },
      });
      ch.on("broadcast", { event: "sos" }, (msg) => {
        const payload = msg.payload as NeighborAlertPayload | undefined;
        if (!payload || !markSeen(payload.requestId)) return;
        const listener = getLastKnownPosition();
        const distanceKm = listener
          ? haversineKm(listener.lat, listener.lng, payload.lat, payload.lng)
          : null;
        onAlert({ ...payload, cell, distanceKm });
      });
      ch.subscribe();
      return ch;
    });
    return {
      stop: () => {
        for (const ch of channels) {
          try { supabase.removeChannel(ch); } catch {}
        }
      },
      cells,
    };
  }

  // ── BroadcastChannel fallback (single-device/dev) ──
  try {
    const bc = new BroadcastChannel(LOCAL_FALLBACK_CHANNEL);
    const handler = (ev: MessageEvent) => {
      const payload = ev.data as NeighborAlertPayload | undefined;
      if (!payload || !markSeen(payload.requestId)) return;
      const listener = getLastKnownPosition();
      const distanceKm = listener
        ? haversineKm(listener.lat, listener.lng, payload.lat, payload.lng)
        : null;
      onAlert({ ...payload, cell: "(local)", distanceKm });
    };
    bc.addEventListener("message", handler);
    return {
      stop: () => {
        bc.removeEventListener("message", handler);
        bc.close();
      },
      cells: ["(local)"],
    };
  } catch {
    return { stop: () => {}, cells: [] };
  }
}

// ─────────────────────────────────────────────────────────────
// Publish
// ─────────────────────────────────────────────────────────────
export interface PublishOpts {
  requestId: string;
  displayName?: string;
  severity?: "low" | "medium" | "high";
  /** Override precision for this broadcast (defaults to user's setting). */
  precision?: 4 | 5 | 6;
  /** Override GPS (used by tests); otherwise pulled from tracker. */
  location?: { lat: number; lng: number } | null;
}

/**
 * Broadcast an SOS signal to neighbors. Returns true if the broadcast was
 * actually sent (user is Elite, opted in, and a channel was available).
 * Never throws — neighbor alert must never block the primary SOS path.
 */
export async function publishNeighborAlert(opts: PublishOpts): Promise<boolean> {
  try {
    if (!canBroadcast()) return false;

    const settings = getNeighborAlertSettings();
    const precision = opts.precision ?? settings.precision;
    const pos = opts.location ?? getLastKnownPosition();
    if (!pos) return false;

    const payload: NeighborAlertPayload = {
      requestId: opts.requestId,
      ts: new Date().toISOString(),
      lat: coarse(pos.lat),
      lng: coarse(pos.lng),
      displayName: opts.displayName?.slice(0, 40),
      severity: opts.severity,
    };

    const cell = encodeGeohash(pos.lat, pos.lng, precision);

    if (SUPABASE_CONFIG.isConfigured) {
      const ch = supabase.channel(channelName(cell), {
        config: { broadcast: { self: false, ack: true } },
      });
      await new Promise<void>((resolve) => {
        ch.subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
          // Resolve on any terminal status to avoid hanging the SOS path.
          if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") resolve();
        });
        // Safety timer — SOS must proceed within 3s regardless.
        setTimeout(resolve, 3000);
      });
      try {
        await ch.send({ type: "broadcast", event: "sos", payload });
      } finally {
        try { supabase.removeChannel(ch); } catch {}
      }
      return true;
    }

    // Fallback for dev / offline: BroadcastChannel on this machine.
    try {
      const bc = new BroadcastChannel(LOCAL_FALLBACK_CHANNEL);
      bc.postMessage(payload);
      bc.close();
      return true;
    } catch {
      return false;
    }
  } catch (err) {
    console.warn("[NeighborAlert] publish failed:", err);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Respond (best-effort — records an ack; never blocks the caller)
// ─────────────────────────────────────────────────────────────
/**
 * Acknowledge an incoming alert. If Supabase is configured we write a row
 * to `neighbor_responses`; otherwise we echo to BroadcastChannel so the
 * requester device (in dev) can see it.
 */
export async function respondToAlert(
  requestId: string,
  status: NeighborAlertResponse,
  note?: string
): Promise<void> {
  try {
    if (SUPABASE_CONFIG.isConfigured) {
      await supabase.from("neighbor_responses").insert({
        request_id: requestId,
        status,
        note: note?.slice(0, 280) ?? null,
        responded_at: new Date().toISOString(),
      });
      return;
    }
    const bc = new BroadcastChannel(LOCAL_FALLBACK_CHANNEL + ":responses");
    bc.postMessage({ requestId, status, note, ts: Date.now() });
    bc.close();
  } catch (err) {
    console.warn("[NeighborAlert] respond failed:", err);
  }
}
