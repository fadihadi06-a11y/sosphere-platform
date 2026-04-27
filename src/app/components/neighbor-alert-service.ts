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
//   canBroadcast(): boolean                      ← Elite + opt-in
//   startNeighborListener(onAlert, onRetract?): stop()
//   publishNeighborAlert(opts): Promise<boolean>
//   publishNeighborRetract(opts): Promise<boolean>   ← P1-#5
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

// P1-#5: Retract payload. Sent on the same channel as the SOS broadcast
// when the requester ends their own emergency (safe now, false alarm,
// help arrived). Lets neighbor devices dismiss stale alert cards.
export interface NeighborRetractPayload {
  /** Same requestId that was broadcast originally — used to match. */
  requestId: string;
  /** ISO timestamp when the retract fired. */
  ts: string;
  /** Optional reason surfaced in the responder UI. */
  reason?: "safe" | "resolved" | "false_alarm" | "other";
}

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
  if (merged.broadcast && !hasFeature("aiVoiceCalls")) {
    merged.broadcast = false;
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch {}

  // S-15 (2026-04-27): mirror the `receive` decision to server-side
  // record_consent('neighbor_receive', ...). This satisfies GDPR Art. 7
  // demonstrability: the server now has an authoritative timestamp +
  // decision. Fire-and-forget so the UI toggle stays snappy; failures
  // are logged but the local state still reflects the user's choice.
  // If the receive flag DIDN'T change in this patch, skip the call.
  if (patch.receive !== undefined && patch.receive !== current.receive) {
    void mirrorNeighborReceiveConsent(merged.receive ? "granted" : "declined");
  }
  return merged;
}

/**
 * S-15: server-mirror the neighbor-receive consent. Idempotent —
 * calling repeatedly with the same decision just refreshes the
 * timestamp on the server. Returns true on confirmed mirror, false
 * on any failure (offline, RPC rejection, network).
 *
 * UI toggles call setNeighborAlertSettings which fire-and-forgets
 * this. Pages that need confirmation (e.g., onboarding consent flow)
 * should call this directly and await the result.
 */
export async function mirrorNeighborReceiveConsent(
  decision: "granted" | "declined",
): Promise<boolean> {
  if (!SUPABASE_CONFIG.isConfigured) return false;
  try {
    const { data, error } = await supabase.rpc("record_consent", {
      p_kind: "neighbor_receive",
      p_decision: decision,
    });
    if (error) {
      console.warn("[S-15] record_consent rpc error:", error.message);
      return false;
    }
    if (data && typeof data === "object" && (data as { ok?: boolean }).ok === false) {
      console.warn("[S-15] record_consent rejected:", (data as { reason?: string }).reason);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[S-15] record_consent threw:", e);
    return false;
  }
}

/**
 * S-15: fetch the server-recorded neighbor-receive decision. Returns
 * null when the user has not yet decided (NULL on the column).
 * Listener / fan-out paths use this as the SOURCE OF TRUTH instead of
 * trusting localStorage.
 */
export async function getServerNeighborReceiveConsent(): Promise<{
  decision: "granted" | "declined" | null;
  recorded_at: string | null;
}> {
  if (!SUPABASE_CONFIG.isConfigured) return { decision: null, recorded_at: null };
  try {
    const { data, error } = await supabase.rpc("get_consent_state");
    if (error || !data || typeof data !== "object") {
      return { decision: null, recorded_at: null };
    }
    const d = (data as Record<string, unknown>).neighbor_receive_decision;
    const at = (data as Record<string, unknown>).neighbor_receive_at;
    return {
      decision: d === "granted" || d === "declined" ? d : null,
      recorded_at: typeof at === "string" ? at : null,
    };
  } catch {
    return { decision: null, recorded_at: null };
  }
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

// ─────────────────────────────────────────────────────────────
// P2-#7: GPS drift re-subscription
// ─────────────────────────────────────────────────────────────
// Before: cells were snapshotted once at mount and frozen for the
// lifetime of the listener. A user walking or driving would quickly
// exit their initial 9-cell window and go silent — no nearby SOS
// alerts would reach them even while they remained a plausible
// responder. The stationary assumption is wrong for a field app.
//
// Now: a lightweight poll checks GPS every RECHECK_INTERVAL_MS. If
// the 9-cell set has changed, we diff: tear down channels we no
// longer need, subscribe to channels we didn't have before. Channels
// still in the overlap are left alone — no reconnect churn.
//
// Why polling, not GPS event subscription: the tracker doesn't
// currently expose a pub/sub hook, and adding one is a cross-cutting
// change. 30s polling is cheap (one getLastKnownPosition read) and
// sufficient — you can't change a 5km cell faster than about 9
// minutes at walking pace, so 30s is ~20× safety margin.
const RECHECK_INTERVAL_MS = 30_000;

/**
 * Subscribe to neighbor alerts for the current GPS cell and its neighbors.
 * Returns a handle; call `stop()` to unsubscribe. Safe to call multiple
 * times — each call returns an independent handle.
 *
 * If the user hasn't opted in (`receive === false`) this is a no-op and
 * returns a handle whose stop() is a no-op.
 *
 * P1-#5: Optional `onRetract` callback fires when the requester cancels
 * their SOS. Responders should dismiss any alert card matching the
 * requestId — stops stale "someone needs help" sheets from hanging
 * around after the situation is resolved.
 *
 * P2-#7: The listener auto-resubscribes when the user moves into a
 * new geohash cell window. The returned handle's `cells` property
 * reflects the INITIAL snapshot only; use the network for ground truth.
 */
export function startNeighborListener(
  onAlert: (alert: IncomingNeighborAlert) => void,
  onRetract?: (retract: NeighborRetractPayload) => void,
): NeighborListenerHandle {
  const settings = getNeighborAlertSettings();
  if (!settings.receive) {
    return { stop: () => {}, cells: [] };
  }

  const pos = getLastKnownPosition();
  // If we have no location we still listen on a broad fallback so that
  // BroadcastChannel-based tests work even without GPS.
  const initialCells = pos
    ? neighborhoodCells(pos.lat, pos.lng, settings.precision)
    : [];

  // ── Supabase Realtime path ──
  if (SUPABASE_CONFIG.isConfigured && initialCells.length > 0) {
    // P2-#7: Map of cell→channel so we can diff-subscribe on GPS drift
    // without reconnecting channels that stay in the window.
    const cellChannels = new Map<string, ReturnType<typeof supabase.channel>>();

    const subscribeCell = (cell: string) => {
      if (cellChannels.has(cell)) return;
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
      // P1-#5: Retract handler. We intentionally do NOT gate this through
      // markSeen — retracts aren't dedupable like alerts (multiple cells
      // may receive the same retract, but the overlay's matching-by-id
      // logic handles that). Also we don't want to miss a retract because
      // the original alert came in on a sibling cell.
      if (onRetract) {
        ch.on("broadcast", { event: "sos_retract" }, (msg) => {
          const payload = msg.payload as NeighborRetractPayload | undefined;
          if (!payload || !payload.requestId) return;
          onRetract(payload);
        });
      }
      ch.subscribe();
      cellChannels.set(cell, ch);
    };

    const unsubscribeCell = (cell: string) => {
      const ch = cellChannels.get(cell);
      if (!ch) return;
      try { supabase.removeChannel(ch); } catch {}
      cellChannels.delete(cell);
    };

    // Initial subscription
    for (const cell of initialCells) subscribeCell(cell);

    // P2-#7: Re-check GPS periodically and diff the cell set. We read
    // the user's latest precision setting each tick so a mid-session
    // settings change takes effect without restart. Errors are swallowed
    // — a drift check must never throw into the app.
    const recheckTimer = setInterval(() => {
      try {
        const s = getNeighborAlertSettings();
        if (!s.receive) return; // user toggled off — next stop() call handles teardown
        const p = getLastKnownPosition();
        if (!p) return;
        const desired = new Set(neighborhoodCells(p.lat, p.lng, s.precision));
        const current = new Set(cellChannels.keys());
        // Early exit if nothing changed
        if (desired.size === current.size && [...desired].every((c) => current.has(c))) return;
        // Subscribe to new cells
        for (const c of desired) if (!current.has(c)) subscribeCell(c);
        // Drop cells we no longer overlap
        for (const c of current) if (!desired.has(c)) unsubscribeCell(c);
      } catch (err) {
        console.warn("[NeighborAlert] GPS recheck failed:", err);
      }
    }, RECHECK_INTERVAL_MS);

    return {
      stop: () => {
        clearInterval(recheckTimer);
        for (const [cell] of cellChannels) unsubscribeCell(cell);
      },
      cells: initialCells,
    };
  }

  // ── BroadcastChannel fallback (single-device/dev) ──
  try {
    const bc = new BroadcastChannel(LOCAL_FALLBACK_CHANNEL);
    const handler = (ev: MessageEvent) => {
      const raw = ev.data as (NeighborAlertPayload & { __kind?: string }) | (NeighborRetractPayload & { __kind?: string }) | undefined;
      if (!raw) return;
      // P1-#5: Multiplex alert vs retract on the same local channel via
      // a discriminator so the dev/test path matches Supabase semantics.
      if (raw.__kind === "retract") {
        if (onRetract) onRetract(raw as NeighborRetractPayload);
        return;
      }
      const payload = raw as NeighborAlertPayload;
      if (!markSeen(payload.requestId)) return;
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
      // P1-#5: Tag with a discriminator so the listener can tell
      // alerts apart from retracts on the same local channel.
      bc.postMessage({ ...payload, __kind: "alert" });
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
// P1-#5: Retract publisher
// ─────────────────────────────────────────────────────────────
/**
 * Broadcast a retract on the same 9-cell window the original alert went
 * out on. We don't require `canBroadcast()` here — once the alert has
 * been sent, users should ALWAYS be able to cancel it even if they flip
 * the broadcast setting off mid-incident, or if their Elite expired.
 *
 * Silent on failure — retract is best-effort. The worst case is responder
 * cards auto-dismiss after 2 minutes via their existing timer.
 */
export async function publishNeighborRetract(opts: {
  requestId: string;
  reason?: NeighborRetractPayload["reason"];
  precision?: 4 | 5 | 6;
  location?: { lat: number; lng: number } | null;
}): Promise<boolean> {
  try {
    if (!opts.requestId) return false;

    const settings = getNeighborAlertSettings();
    const precision = opts.precision ?? settings.precision;
    const pos = opts.location ?? getLastKnownPosition();

    const payload: NeighborRetractPayload = {
      requestId: opts.requestId,
      ts: new Date().toISOString(),
      reason: opts.reason ?? "resolved",
    };

    if (SUPABASE_CONFIG.isConfigured && pos) {
      // Fan out the retract to the same 9-cell window an alert would
      // have covered — the requester may have drifted one cell over
      // between alert and retract, and some of the original cells may
      // have neighbors with the card still up.
      const cells = neighborhoodCells(pos.lat, pos.lng, precision);
      await Promise.all(cells.map(async (cell) => {
        const ch = supabase.channel(channelName(cell), {
          config: { broadcast: { self: false, ack: true } },
        });
        await new Promise<void>((resolve) => {
          ch.subscribe((status) => {
            if (status === "SUBSCRIBED") resolve();
            if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") resolve();
          });
          // Retract is secondary — keep the timeout tight.
          setTimeout(resolve, 2000);
        });
        try {
          await ch.send({ type: "broadcast", event: "sos_retract", payload });
        } finally {
          try { supabase.removeChannel(ch); } catch {}
        }
      }));
      return true;
    }

    // BroadcastChannel dev / offline fallback
    try {
      const bc = new BroadcastChannel(LOCAL_FALLBACK_CHANNEL);
      bc.postMessage({ ...payload, __kind: "retract" });
      bc.close();
      return true;
    } catch {
      return false;
    }
  } catch (err) {
    console.warn("[NeighborAlert] retract publish failed:", err);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Respond (best-effort — records an ack; never blocks the caller)
// ─────────────────────────────────────────────────────────────
// P1-#6: Channel naming for per-emergency response stream. The requester
// subscribes to this channel for the lifetime of the SOS; responders
// publish to it via respondToAlert. Separate from the geocell alert
// channel so the requester doesn't have to listen on 9 cells just to
// count responses, and responders don't leak their identity on a
// broad channel.
const responseChannelName = (requestId: string) => `neighbor:response:${requestId}`;

/** P1-#6: The inbound response shape the requester-side callback receives. */
export interface IncomingNeighborResponse {
  requestId: string;
  status: NeighborAlertResponse;
  note?: string;
  ts: string;
}

/**
 * Acknowledge an incoming alert. Two writes happen in parallel:
 *   1. Durable row in `neighbor_responses` (audit trail, dashboard ETL)
 *   2. P1-#6: Realtime broadcast on `neighbor:response:{requestId}` so
 *      the requester's device can show a live count of responders on
 *      the active-SOS screen.
 * Both are best-effort. Never throws.
 */
export async function respondToAlert(
  requestId: string,
  status: NeighborAlertResponse,
  note?: string
): Promise<void> {
  try {
    if (SUPABASE_CONFIG.isConfigured) {
      // Fire both the durable write and the realtime broadcast. We
      // don't await the insert because a slow DB shouldn't delay the
      // responder UI's "response recorded" toast.
      void supabase.from("neighbor_responses").insert({
        request_id: requestId,
        status,
        note: note?.slice(0, 280) ?? null,
        responded_at: new Date().toISOString(),
      }).then(({ error }) => {
        if (error) console.warn("[NeighborAlert] respond DB write failed:", error.message);
      });

      // P1-#6: Live broadcast to the requester. Best-effort with a
      // tight timeout — even if this fails the DB write is the
      // authoritative record.
      try {
        const ch = supabase.channel(responseChannelName(requestId), {
          config: { broadcast: { self: false, ack: true } },
        });
        await new Promise<void>((resolve) => {
          ch.subscribe((s) => {
            if (s === "SUBSCRIBED") resolve();
            if (s === "CLOSED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT") resolve();
          });
          setTimeout(resolve, 2000);
        });
        try {
          await ch.send({
            type: "broadcast",
            event: "sos_response",
            payload: {
              requestId,
              status,
              note: note?.slice(0, 280),
              ts: new Date().toISOString(),
            } satisfies IncomingNeighborResponse,
          });
        } finally {
          try { supabase.removeChannel(ch); } catch {}
        }
      } catch (err) {
        console.warn("[NeighborAlert] respond broadcast failed:", err);
      }
      return;
    }
    const bc = new BroadcastChannel(LOCAL_FALLBACK_CHANNEL + ":responses");
    bc.postMessage({ requestId, status, note, ts: Date.now() });
    bc.close();
  } catch (err) {
    console.warn("[NeighborAlert] respond failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────
// P1-#6: Requester-side response subscription
// ─────────────────────────────────────────────────────────────
export interface NeighborResponseSubscriptionHandle {
  stop: () => void;
}

/**
 * Subscribe to live responses for a given emergency. Call once when SOS
 * becomes active; call stop() when the emergency ends. Returns an
 * immediately-usable handle — there is no "subscribed" promise — because
 * the requester UI shouldn't block on realtime handshake during an SOS.
 *
 * Fallback: when Supabase isn't configured, listens to the dev
 * BroadcastChannel so the response flow is exercisable on a single box.
 */
export function subscribeToNeighborResponses(
  requestId: string,
  onResponse: (r: IncomingNeighborResponse) => void,
): NeighborResponseSubscriptionHandle {
  if (!requestId) return { stop: () => {} };

  if (SUPABASE_CONFIG.isConfigured) {
    const ch = supabase.channel(responseChannelName(requestId), {
      config: { broadcast: { self: false } },
    });
    ch.on("broadcast", { event: "sos_response" }, (msg) => {
      const payload = msg.payload as IncomingNeighborResponse | undefined;
      if (!payload || payload.requestId !== requestId) return;
      onResponse(payload);
    });
    ch.subscribe();
    return {
      stop: () => { try { supabase.removeChannel(ch); } catch {} },
    };
  }

  // Dev fallback
  try {
    const bc = new BroadcastChannel(LOCAL_FALLBACK_CHANNEL + ":responses");
    const handler = (ev: MessageEvent) => {
      const raw = ev.data as { requestId?: string; status?: NeighborAlertResponse; note?: string; ts?: number } | undefined;
      if (!raw || raw.requestId !== requestId || !raw.status) return;
      onResponse({
        requestId: raw.requestId,
        status: raw.status,
        note: raw.note,
        ts: new Date(raw.ts ?? Date.now()).toISOString(),
      });
    };
    bc.addEventListener("message", handler);
    return {
      stop: () => { bc.removeEventListener("message", handler); bc.close(); },
    };
  } catch {
    return { stop: () => {} };
  }
}
