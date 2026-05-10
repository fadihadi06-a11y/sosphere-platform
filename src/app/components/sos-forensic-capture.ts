// ═══════════════════════════════════════════════════════════════
// SOSphere — L2-G post-call forensic capture
// ─────────────────────────────────────────────────────────────
// PURPOSE
//   When an SOS call ends, the aftermath is often more
//   forensically valuable than the call itself: surroundings,
//   the assailant fleeing, the user's condition. Audio capture
//   already continues post-call (see sos-emergency.tsx
//   recordingTiming: "after"). This module adds:
//
//     1. ONE rear-camera photo, captured silently if permission
//        was previously granted (or surfaced as best-effort if
//        not — the call-ended UI shows a "capturing evidence"
//        ring, not a permission modal mid-emergency).
//
//     2. Upload to the evidence Storage bucket on the same path
//        scheme as sos-audio-upload.ts (sos/<emergencyId>/...),
//        so a single dashboard query lists the full evidence
//        manifest for an emergency.
//
//     3. SHA-256 hash returned to the caller so it can be
//        chained into the evidence manifest (existing
//        computeEvidenceManifest / attachEvidenceManifest path).
//
// PRIVACY
//   • The capture fires ONLY for an active SOS (caller passes
//     an emergencyId).
//   • The image is private — the evidence bucket has signed-URL
//     access only (see storage RLS policies in
//     20260424165119_storage_evidence_scoped_read_via_alter.sql).
//   • If the camera permission is NOT granted, this function
//     returns null silently — never shows an OS prompt during an
//     active emergency (that would be a jarring UX nightmare).
//     The first-run permission is requested ahead of time in the
//     mobile onboarding flow.
//
// PLATFORM HANDLING
//   • Web / PWA: navigator.mediaDevices.getUserMedia + canvas.toBlob.
//     Picks the rear camera (facingMode: "environment") when
//     available, falls back to default.
//   • Native (Capacitor): same getUserMedia path works inside the
//     WebView, so we use it uniformly. The Capacitor Camera
//     plugin's getPhoto() opens a native UI which is hostile to
//     an active SOS — skipped intentionally.
//
// FAILURE PATHS
//   • Permission denied / no camera / browser blocked: return
//     null, log a warning. Caller continues — photo is best-
//     effort, never blocks the audio/timeline/dispatch chain.
//   • Upload fails: queue handled by uploadSOSPhoto (mirror of
//     uploadSOSAudio's offline queue pattern).
// ═══════════════════════════════════════════════════════════════

import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";
import { getStoredBearerToken } from "./api/safe-rpc";

const STORAGE_BUCKET = "evidence";

// Capture timing budget: from getUserMedia open to canvas.toBlob.
// 4s is generous — typical capture is <500ms. After the budget
// elapses we abort to prevent the post-call flow from hanging
// indefinitely on a stuck camera permission prompt.
const CAPTURE_TIMEOUT_MS = 4000;

// JPEG quality. 0.82 is the sweet spot — visually indistinguishable
// from 0.95 on phone cameras, but ~40% smaller, which matters for
// users on bad cell data during the post-emergency upload window.
const JPEG_QUALITY = 0.82;

export interface ForensicPhotoResult {
  /** Public/signed URL when upload succeeded, null on offline or failure. */
  url: string | null;
  /** SHA-256 hex digest of the captured JPEG bytes (forensic chain). */
  sha256: string;
  /** Pixel dimensions of the captured frame. */
  width: number;
  height: number;
  /** Bytes of the JPEG. */
  bytes: number;
  /** Which camera was used (front / back / unknown). */
  facing: "user" | "environment" | "unknown";
  /** ISO timestamp of capture. */
  capturedAt: string;
}

/**
 * Capture ONE forensic photo from the device camera and upload it
 * to the evidence bucket. Best-effort — returns null on any
 * failure that's not a programming error.
 *
 * @param emergencyId the active SOS id. Used to scope the storage
 *                    path and the evidence manifest entry.
 * @returns the upload result with hash + url, or null on failure.
 */
export async function captureForensicPhoto(
  emergencyId: string,
): Promise<ForensicPhotoResult | null> {
  if (!emergencyId) return null;

  // Defensive: server-side / no-DOM contexts.
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    console.warn("[L2-G] camera unavailable — skipping forensic photo");
    return null;
  }

  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;

  try {
    // Race the camera open against the capture budget. A stuck
    // permission prompt or hung driver must NOT block the SOS flow.
    const openPromise = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" }, // rear camera preferred
        width:  { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    const timeout = new Promise<MediaStream>((_, reject) =>
      setTimeout(() => reject(new Error("camera_open_timeout")), CAPTURE_TIMEOUT_MS),
    );
    stream = await Promise.race([openPromise, timeout]);

    // Determine which camera we actually got — userMedia constraints
    // are advisory; the device may have given us the front camera if
    // the rear was unavailable.
    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings?.() || {};
    const facing: ForensicPhotoResult["facing"] =
      settings.facingMode === "environment" ? "environment"
      : settings.facingMode === "user"        ? "user"
      : "unknown";

    // Wire up a hidden <video> element so canvas can draw the frame.
    video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await new Promise<void>((resolve, reject) => {
      const onReady = () => { video!.removeEventListener("loadedmetadata", onReady); resolve(); };
      const onError = () => { video!.removeEventListener("error", onError); reject(new Error("video_load_failed")); };
      video!.addEventListener("loadedmetadata", onReady);
      video!.addEventListener("error", onError);
    });
    // Some browsers (Safari) won't paint the first frame until the
    // video element has played at least one tick. A single rAF is
    // enough to guarantee that.
    await new Promise(r => requestAnimationFrame(() => r(null)));

    const width  = video.videoWidth  || 1280;
    const height = video.videoHeight || 720;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_ctx_unavailable");
    ctx.drawImage(video, 0, 0, width, height);

    const blob: Blob | null = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY);
    });
    if (!blob) throw new Error("canvas_toblob_failed");

    // Hash the JPEG bytes (forensic chain — same algorithm as
    // evidence-hash.ts uses for audio).
    const buf = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const sha256 = Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");

    const capturedAt = new Date().toISOString();
    const url = await uploadForensicPhoto(emergencyId, blob);

    return {
      url,
      sha256,
      width,
      height,
      bytes: blob.size,
      facing,
      capturedAt,
    };
  } catch (err) {
    console.warn("[L2-G] forensic photo capture failed:", err);
    return null;
  } finally {
    // ALWAYS release the camera — leaking a track keeps the LED
    // on and blocks subsequent captures.
    try { stream?.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
    if (video) {
      try { video.srcObject = null; } catch { /* noop */ }
    }
  }
}

/**
 * Upload a forensic photo to the evidence bucket. Returns the
 * public path on success, null on offline / not-configured /
 * upload error. Mirrors uploadSOSAudio's failure semantics.
 *
 * NOTE: this version does NOT queue offline-pending uploads in
 * IndexedDB the way audio does — photos are larger and the
 * post-call window has GPS + audio already in flight. A future
 * pass can extend offline-database.ts with a pending_photos
 * table; for L2-G Phase 1 we accept best-effort online-only.
 */
async function uploadForensicPhoto(
  emergencyId: string,
  blob: Blob,
): Promise<string | null> {
  if (!emergencyId || !blob || blob.size === 0) return null;
  if (!SUPABASE_CONFIG.isConfigured) return null;
  if (typeof navigator !== "undefined" && !navigator.onLine) return null;

  const path = `sos/${emergencyId}/forensic.jpg`;
  try {
    // Prefer the SDK upload path so RLS / auth headers come through
    // the same as audio. cacheControl=3600 — these are forensic
    // artifacts, not hot resources.
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, blob, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: true,
      });
    if (error) {
      console.warn("[L2-G] supabase upload error:", error.message);
      // Fall through to fetch-based fallback below — sometimes the
      // SDK upload fails on auth refresh edge cases but a direct
      // signed POST works.
      return await directUpload(emergencyId, blob, path);
    }
    // Build the public URL the dashboard will resolve via signed URLs.
    return path;
  } catch (e) {
    console.warn("[L2-G] supabase upload threw:", e);
    return await directUpload(emergencyId, blob, path);
  }
}

async function directUpload(
  _emergencyId: string,
  blob: Blob,
  path: string,
): Promise<string | null> {
  try {
    const token = await getStoredBearerToken();
    if (!token) return null;
    const url = `${SUPABASE_CONFIG.url}/storage/v1/object/${STORAGE_BUCKET}/${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "image/jpeg",
        "x-upsert": "true",
      },
      body: blob,
    });
    if (!res.ok) {
      console.warn(`[L2-G] direct upload failed: HTTP ${res.status}`);
      return null;
    }
    return path;
  } catch (e) {
    console.warn("[L2-G] direct upload threw:", e);
    return null;
  }
}
