// ═══════════════════════════════════════════════════════════════
// SOSphere — SOS Voice Recording Upload Pipeline
// ─────────────────────────────────────────────────────────────
// Problem this solves:
//   Before this module, audio captured during an SOS was held only
//   in memory (audioDataUrlRef). It was uploaded to Supabase Storage
//   *lazily* — inside storeEvidence(), which only runs when the user
//   completes the post-emergency debrief. If the user closed the app,
//   the battery died, or the browser crashed between SOS-end and
//   debrief-submit, the recording was lost forever.
//
// Design:
//   • uploadSOSAudio(emergencyId, blob)
//       The moment recorder.onstop fires, we kick off a direct
//       upload of the Blob (no base64 round-trip, no dataUrl hop).
//       Returns the public URL on success.
//
//   • Failure paths ALL route through queuePendingAudio(), which
//     persists the Blob natively to IndexedDB. The app is now free
//     to crash — the recording survives.
//
//   • replayPendingAudio() drains the queue on reconnect or startup.
//     Idempotent, debounced, retry-capped.
//
//   • getAudioPublicUrl(emergencyId) lets the debrief screen / evidence
//     store prefer a pre-uploaded URL over the in-memory dataUrl when
//     building the EvidenceEntry.
// ═══════════════════════════════════════════════════════════════

import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";
import {
  queuePendingAudio,
  getUnsyncedAudio,
  markAudioSynced,
  incrementAudioRetry,
  deletePendingAudio,
  type PendingAudioRecord,
} from "./offline-database";

const STORAGE_BUCKET = "evidence";
const REPLAY_MAX_TRIES = 5;
const REPLAY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — audio is evidence, not ephemeral

// In-memory map of emergencyId -> uploaded public URL.
// Lets the debrief/evidence flow reuse the live-upload result
// instead of uploading the same dataUrl again.
const uploadedUrls = new Map<string, string>();

let replayInFlight = false;
let replayListenerAttached = false;

// ── Public API ─────────────────────────────────────────────────

/**
 * Called from recorder.onstop the moment the SOS recording finishes.
 * Attempts a direct Blob upload; on any failure persists the Blob to
 * IndexedDB so replay can retry later.
 *
 * Returns the public URL on success, or null on failure. Never throws —
 * caller can treat null as "keep the in-memory dataUrl for now".
 */
export async function uploadSOSAudio(
  emergencyId: string,
  blob: Blob,
  durationSec: number,
): Promise<string | null> {
  if (!emergencyId || !blob || blob.size === 0) {
    return null;
  }

  const mimeType = blob.type || "audio/webm";
  const ext = mimeType.includes("mp4") ? "mp4" : "webm";
  const path = `sos/${emergencyId}/recording.${ext}`;

  // If Supabase isn't configured at all, queue and bail — replay on
  // first successful init.
  if (!SUPABASE_CONFIG.isConfigured) {
    await queueOnFail(emergencyId, blob, mimeType, durationSec, "supabase_not_configured");
    return null;
  }

  // If we're offline, skip the network attempt and queue directly.
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    await queueOnFail(emergencyId, blob, mimeType, durationSec, "offline_at_capture");
    return null;
  }

  try {
    const url = await doUpload(path, blob, mimeType);
    if (url) {
      uploadedUrls.set(emergencyId, url);
      console.log(`[SOS-Audio] uploaded emergency=${emergencyId} size=${blob.size}B`);
      return url;
    }
    await queueOnFail(emergencyId, blob, mimeType, durationSec, "upload_returned_null");
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[SOS-Audio] upload failed emergency=${emergencyId}: ${msg}`);
    await queueOnFail(emergencyId, blob, mimeType, durationSec, msg);
    return null;
  }
}

/** Returns a pre-uploaded public URL for this emergency if available. */
export function getAudioPublicUrl(emergencyId: string): string | null {
  return uploadedUrls.get(emergencyId) ?? null;
}

/**
 * Drain the pending_audio queue. Called on `online` events and once
 * at app startup via startAudioReplayWatcher().
 *
 * Gated on an authenticated Supabase session: Storage uploads require
 * a valid JWT, and firing before the session has hydrated would 401
 * every record until its retry budget was exhausted — effectively
 * losing evidence. If no session is available we silently skip; the
 * auth-state-change listener in startAudioReplayWatcher will re-fire
 * the replay the moment a session exists.
 */
export async function replayPendingAudio(): Promise<{
  uploaded: number;
  failed: number;
  purged: number;
}> {
  const summary = { uploaded: 0, failed: 0, purged: 0 };

  if (replayInFlight) return summary;
  if (typeof navigator !== "undefined" && !navigator.onLine) return summary;
  if (!SUPABASE_CONFIG.isConfigured) return summary;

  // Auth gate — don't burn the retry budget before the session exists.
  try {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) {
      console.log("[SOS-Audio] replay skipped — no auth session yet");
      return summary;
    }
  } catch {
    // If getSession throws (network, misconfigured client), behave as
    // if no session — skip replay, let the auth-change listener retry.
    return summary;
  }

  replayInFlight = true;
  try {
    const pending = await getUnsyncedAudio();
    if (pending.length === 0) return summary;

    console.log(`[SOS-Audio] replaying ${pending.length} pending upload(s)`);
    const now = Date.now();

    for (const rec of pending) {
      // Purge audio older than the retention window — the incident
      // is long over and the Blob is just taking up storage.
      if (now - rec.createdAt > REPLAY_TTL_MS) {
        await deletePendingAudio(rec.id).catch(() => {});
        summary.purged++;
        continue;
      }
      if (rec.syncAttempts >= REPLAY_MAX_TRIES) {
        continue;
      }

      const ok = await retryOne(rec);
      if (ok) summary.uploaded++;
      else summary.failed++;
    }

    console.log("[SOS-Audio] replay done:", summary);
    return summary;
  } finally {
    replayInFlight = false;
  }
}

/**
 * Install network listener + trigger an initial replay.
 * Idempotent. Safe to mount once for the app's lifetime.
 *
 * Wires THREE triggers (any one is enough to drain the queue):
 *   1. `online`         — browser-reported network restore.
 *   2. `visibilitychange` → visible — user brings the app back from
 *      background. Crucial on Android: if the user toggles airplane mode
 *      OFF while the app is backgrounded, the `online` event often
 *      fires before the WebView is repainted and may be missed. The
 *      visibility event is the reliable "app is alive again" signal.
 *   3. Startup          — immediate replay if already online.
 *
 * Without (2), a common SOS-recovery flow breaks:
 *   SOS → airplane mode → force close → restart → disable airplane
 *   (while app in background) → open app. The `online` event already
 *   fired before the app repainted, so nothing ever triggered replay.
 */
export function startAudioReplayWatcher(): void {
  if (replayListenerAttached) return;
  replayListenerAttached = true;

  const fire = (source: string) => {
    setTimeout(() => {
      if (navigator.onLine) {
        console.log(`[SOS-Audio] replay trigger: ${source}`);
        replayPendingAudio().catch(err => console.warn("[SOS-Audio] replay err:", err));
      }
    }, 2000); // slightly longer debounce than SOS replay — audio is lower priority
  };

  // Trigger 1: online event
  window.addEventListener("online", () => fire("online"));

  // Trigger 2: visibility restore (covers Android app resume — the
  // WebView's "online" event may have fired while backgrounded and
  // been lost, so this is the belt-and-braces path).
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") fire("visibility");
    });
  }

  // Trigger 3: auth session available — replay is auth-gated, so when
  // the session first hydrates (INITIAL_SESSION) or refreshes
  // (TOKEN_REFRESHED) we get a fresh chance to drain the queue. This
  // closes the race where the watcher was already armed and the queue
  // had records, but Storage uploads would 401 because the JWT wasn't
  // loaded yet.
  try {
    supabase.auth.onAuthStateChange((event, session) => {
      if (session) fire(`auth:${event.toLowerCase()}`);
    });
  } catch {
    // Auth listener is best-effort; never fatal.
  }

  // Trigger 4: immediate replay if already online at mount
  if (typeof navigator !== "undefined" && navigator.onLine) fire("startup");

  console.log("[SOS-Audio] replay watcher installed (online + visibility + auth + startup)");
}

// ── Internals ──────────────────────────────────────────────────

async function doUpload(path: string, blob: Blob, mimeType: string): Promise<string | null> {
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, blob, { upsert: true, contentType: mimeType });
  if (error) throw error;
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
}

async function queueOnFail(
  emergencyId: string,
  blob: Blob,
  mimeType: string,
  durationSec: number,
  _reason: string,
): Promise<void> {
  try {
    await queuePendingAudio({ emergencyId, blob, mimeType, durationSec });
  } catch (err) {
    console.warn("[SOS-Audio] queue-on-fail failed (data lost):", err);
  }
}

async function retryOne(rec: PendingAudioRecord): Promise<boolean> {
  const ext = rec.mimeType.includes("mp4") ? "mp4" : "webm";
  const path = `sos/${rec.emergencyId}/recording.${ext}`;
  try {
    const url = await doUpload(path, rec.blob, rec.mimeType);
    if (!url) {
      await incrementAudioRetry(rec.id, "replay_returned_null").catch(() => {});
      return false;
    }
    await markAudioSynced(rec.id, url).catch(() => {});
    uploadedUrls.set(rec.emergencyId, url);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await incrementAudioRetry(rec.id, msg).catch(() => {});
    return false;
  }
}
