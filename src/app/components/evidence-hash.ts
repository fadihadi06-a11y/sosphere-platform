/**
 * Evidence Hash — Chain-of-Custody Integrity
 * ════════════════════════════════════════════
 * Computes SHA-256 digests for captured photos, voice-memo audio, and
 * the worker's comment, plus a single aggregate manifest hash. This
 * gives field evidence a tamper-evident fingerprint the dashboard can
 * later re-verify: even one flipped byte changes the manifest.
 *
 * Isolation guarantees
 *   • Pure module — depends only on the Web Crypto API and browser
 *     built-ins (TextEncoder, atob).
 *   • Never throws; all failure paths return null so callers can
 *     continue their flow even when SubtleCrypto is unavailable
 *     (older WebViews, insecure contexts, mocked environments).
 *   • No side effects, no storage — a caller separately persists the
 *     returned manifest alongside the evidence entry.
 *
 * Why this lives outside evidence-store.ts
 *   The store is the synchronous, display-facing vault and must stay
 *   quick. Hashing is async and best-effort; keeping it in its own
 *   module means the vault never takes a crypto dependency and older
 *   code paths keep working even if this file is removed.
 */

/* ──────────────────────────────────────────────────────────────── */
/*  Types                                                           */
/* ──────────────────────────────────────────────────────────────── */

export interface EvidencePhotoHash {
  id: string;
  hash: string; // SHA-256 hex, 64 chars; empty string on per-item failure
}

export interface EvidenceManifest {
  algorithm: "SHA-256";
  computedAt: number;           // ms since epoch
  photoHashes: EvidencePhotoHash[];
  audioHash?: string;
  commentHash?: string;
  /**
   * Hash of the concatenated per-item hashes. Acts as a single
   * integrity pointer — verify this one value and you verify the
   * whole bundle (since any child change bubbles up).
   */
  manifestHash: string;
}

/* ──────────────────────────────────────────────────────────────── */
/*  Capability detection                                            */
/* ──────────────────────────────────────────────────────────────── */

/** Web Crypto is unavailable in insecure contexts and some old WebViews. */
export function isHashingAvailable(): boolean {
  try {
    return (
      typeof crypto !== "undefined" &&
      typeof (crypto as Crypto).subtle !== "undefined" &&
      typeof (crypto as Crypto).subtle.digest === "function"
    );
  } catch {
    return false;
  }
}

/* ──────────────────────────────────────────────────────────────── */
/*  Internals                                                       */
/* ──────────────────────────────────────────────────────────────── */

function bufToHex(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/* ──────────────────────────────────────────────────────────────── */
/*  Primitives                                                      */
/* ──────────────────────────────────────────────────────────────── */

/** Hash arbitrary UTF-8 text. Returns null if Web Crypto is unavailable. */
export async function hashString(str: string): Promise<string | null> {
  if (!isHashingAvailable()) return null;
  try {
    const bytes = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return bufToHex(digest);
  } catch {
    return null;
  }
}

/**
 * Hash a data-URL by digesting its decoded bytes (the raw media —
 * this is what we want to fingerprint, NOT the base64 wrapping).
 * For non-data URLs (e.g. already-uploaded Supabase URLs), we fall
 * back to hashing the URL string itself — still produces a stable
 * pointer that later sync steps can verify against.
 */
export async function hashDataUrl(dataUrl: string): Promise<string | null> {
  if (!isHashingAvailable()) return null;
  if (!dataUrl) return null;
  try {
    if (!dataUrl.startsWith("data:")) {
      return await hashString(dataUrl);
    }
    const commaIdx = dataUrl.indexOf(",");
    if (commaIdx < 0) return null;
    const base64 = dataUrl.slice(commaIdx + 1);
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // Pass a fresh ArrayBuffer slice — some engines reject SharedArrayBuffer views.
    const digest = await crypto.subtle.digest("SHA-256", bytes.buffer.slice(0));
    return bufToHex(digest);
  } catch {
    return null;
  }
}

/* ──────────────────────────────────────────────────────────────── */
/*  Aggregate manifest                                              */
/* ──────────────────────────────────────────────────────────────── */

export interface EvidenceHashInput {
  photos: Array<{ id: string; dataUrl: string }>;
  audio?: { dataUrl: string } | null;
  comment?: string | null;
}

/**
 * Compute the full evidence manifest in parallel.
 * Returns null if hashing is unavailable or an unexpected error
 * occurs — callers MUST handle null and continue normally.
 */
export async function computeEvidenceManifest(
  input: EvidenceHashInput
): Promise<EvidenceManifest | null> {
  if (!isHashingAvailable()) return null;
  try {
    const photoHashes: EvidencePhotoHash[] = await Promise.all(
      (input.photos || []).map(async (p) => ({
        id: p.id,
        hash: (await hashDataUrl(p.dataUrl)) || "",
      }))
    );

    const audioHash =
      input.audio && input.audio.dataUrl
        ? (await hashDataUrl(input.audio.dataUrl)) || undefined
        : undefined;

    const commentHash =
      input.comment && input.comment.trim().length > 0
        ? (await hashString(input.comment)) || undefined
        : undefined;

    // Deterministic concat: id-prefixed so reorderings cannot mask edits.
    const aggregateParts: string[] = [];
    for (const p of photoHashes) aggregateParts.push(`photo:${p.id}:${p.hash}`);
    if (audioHash) aggregateParts.push(`audio:${audioHash}`);
    if (commentHash) aggregateParts.push(`comment:${commentHash}`);

    const aggregate = aggregateParts.join("|");
    const manifestHash = (await hashString(aggregate)) || "";

    return {
      algorithm: "SHA-256",
      computedAt: Date.now(),
      photoHashes,
      audioHash,
      commentHash,
      manifestHash,
    };
  } catch {
    return null;
  }
}

/* ──────────────────────────────────────────────────────────────── */
/*  Verification helper (for future dashboard use)                  */
/* ──────────────────────────────────────────────────────────────── */

/**
 * Re-hash a bundle and compare against a previously-stored manifest.
 * Returns true only when every component hash matches AND the
 * aggregate manifestHash matches. Useful for the dashboard's
 * "Verify integrity" button and export-time audit.
 */
export async function verifyEvidenceManifest(
  input: EvidenceHashInput,
  expected: EvidenceManifest
): Promise<boolean> {
  const recomputed = await computeEvidenceManifest(input);
  if (!recomputed) return false;
  if (recomputed.manifestHash !== expected.manifestHash) return false;
  if ((recomputed.audioHash || "") !== (expected.audioHash || "")) return false;
  if ((recomputed.commentHash || "") !== (expected.commentHash || "")) return false;
  if (recomputed.photoHashes.length !== expected.photoHashes.length) return false;
  for (let i = 0; i < recomputed.photoHashes.length; i++) {
    const a = recomputed.photoHashes[i];
    const b = expected.photoHashes[i];
    if (!b || a.id !== b.id || a.hash !== b.hash) return false;
  }
  return true;
}
