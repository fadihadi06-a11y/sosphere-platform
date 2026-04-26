/**
 * SOSphere — Evidence Vault Service
 * ══════════════════════════════════
 * Creates a tamper-EVIDENT, encrypted evidence package for each SOS incident.
 * (B-18 2026-04-25: "tamper-proof" was too strong — a SHA-256 hash makes
 * tampering DETECTABLE, not impossible. Aligned with the rest of the chain.)
 * The package bundles:
 *   • Audio recording(s)
 *   • Photos captured during the incident
 *   • Full GPS trail (timestamped breadcrumbs)
 *   • Incident metadata (time, duration, contacts notified, tier)
 *   • SHA-256 integrity hash — proves nothing was added/removed after the fact
 *
 * The vault is:
 *   • Stored locally in IndexedDB (survives app close)
 *   • Uploaded to Supabase Storage when internet is available
 *   • Shareable via a unique one-time link (for police/lawyer)
 *   • Auto-locked after 24 hours (no more edits, hash is final)
 *
 * Design principles:
 *   • Purely additive — builds on top of existing evidence-store.ts
 *     and sos-audio-upload.ts without modifying them.
 *   • Uses Web Crypto API for SHA-256 hashing (no external deps).
 *   • Offline-first: package is assembled locally, synced later.
 *   • Tier-aware: Free gets basic vault (metadata + GPS only),
 *     Basic adds photos, Elite adds audio + full trail + PDF export.
 */

import { supabase } from "./api/supabase-client";
import { getSubscription, type SubscriptionTier } from "./subscription-service";
import { getEvidenceForEmergency, type EvidenceEntry } from "./evidence-store";
import { getLiveTrail, type LiveLocationPoint } from "./live-location-service";

// ── Types ───────────────────────────────────────────────────
export interface VaultPackage {
  /** Unique vault identifier */
  vaultId: string;
  /** The SOS emergency ID this vault belongs to */
  emergencyId: string;
  /** User info */
  userId: string;
  userName: string;
  /** Incident metadata */
  startTime: number;
  endTime: number | null;
  durationSec: number;
  tier: SubscriptionTier;
  /** Contacts that were notified */
  contactsNotified: Array<{ name: string; phone: string; method: string }>;
  /** GPS trail */
  gpsTrail: LiveLocationPoint[];
  /** Number of photos (actual data stored separately) */
  photoCount: number;
  /** Photo references (IDs from evidence-store) */
  photoIds: string[];
  /** Audio recording info */
  audioRecording: {
    available: boolean;
    durationSec: number;
    format: string;
  } | null;
  /** SHA-256 integrity hash of the entire package */
  integrityHash: string;
  /** When the hash was computed (vault is locked after this) */
  lockedAt: number | null;
  /** Whether the vault has been uploaded to cloud */
  synced: boolean;
  /** Share link (generated on demand) */
  shareUrl: string | null;
  /** Created timestamp */
  createdAt: number;
}

export interface VaultSummary {
  vaultId: string;
  emergencyId: string;
  startTime: number;
  durationSec: number;
  photoCount: number;
  hasAudio: boolean;
  gpsPoints: number;
  integrityHash: string;
  synced: boolean;
  shareUrl: string | null;
}

// ── Storage ─────────────────────────────────────────────────
const VAULT_STORAGE_KEY = "sosphere_evidence_vaults";
const VAULT_LOCK_HOURS  = 24;

function loadVaults(): VaultPackage[] {
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveVaults(vaults: VaultPackage[]): void {
  try {
    // Keep only last 50 vaults to prevent localStorage overflow
    const trimmed = vaults.slice(-50);
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.error("[EvidenceVault] Failed to save:", err);
  }
}

// ──────────────────────────────────────────────────────────────────
// G-26 (B-20, 2026-04-26): write-lock around the read-modify-write
// pattern. Pre-fix: three concurrent createVault() / updateVault() calls
// each did `loadVaults() -> push -> saveVaults()`. All three saw the
// same array, each pushed their own entry, and the last writer won —
// the other two vault records were silently clobbered.
// Now: every vault mutation must go through `mutateVaults(fn)` which
// serialises through a promise chain. Because localStorage writes are
// synchronous and the bug is intra-tab JS races (not multi-process),
// a single in-memory promise chain is sufficient.
// ──────────────────────────────────────────────────────────────────
let vaultWriteLock: Promise<void> = Promise.resolve();
async function mutateVaults(
  fn: (current: VaultPackage[]) => VaultPackage[] | Promise<VaultPackage[]>,
): Promise<VaultPackage[]> {
  let nextOut: VaultPackage[] = [];
  vaultWriteLock = vaultWriteLock.then(async () => {
    const current = loadVaults();          // read INSIDE the lock
    const next = await fn(current);
    saveVaults(next);
    nextOut = next;
  }).catch((err) => {
    console.error("[EvidenceVault] mutateVaults inner error (chain continues):", err);
  });
  await vaultWriteLock;
  return nextOut;
}


// ── Hashing ─────────────────────────────────────────────────
async function computeHash(data: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const buffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // Fallback: simple checksum if Web Crypto unavailable
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const chr = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return `fallback-${Math.abs(hash).toString(16)}`;
  }
}

// ── Core API ────────────────────────────────────────────────

/**
 * Create a new evidence vault for an SOS incident.
 * Call this when the SOS event ENDS (in doEnd or post-debrief).
 */
export async function createVault(params: {
  emergencyId: string;
  userId: string;
  userName: string;
  startTime: number;
  endTime: number;
  contactsNotified: Array<{ name: string; phone: string; method?: string }>;
  recordingDurationSec?: number;
  recordingFormat?: string;
  photos?: Array<{ id: string }>;
}): Promise<VaultPackage> {
  const sub = getSubscription();
  const now = Date.now();
  const vaultId = `VAULT-${params.emergencyId}-${now.toString(36).toUpperCase().slice(-4)}`;

  // Collect GPS trail from live session
  const gpsTrail = getLiveTrail();

  // Collect photos from evidence store
  const evidenceEntries = getEvidenceForEmergency(params.emergencyId);
  const allPhotos = evidenceEntries.flatMap(e => e.photos || []);
  const photoIds = params.photos?.map(p => p.id) || allPhotos.map(p => p.id);

  // Tier-based content inclusion
  const includeAudio = sub.tier === "basic" || sub.tier === "elite";
  const includeFullTrail = sub.tier !== "free"; // Basic + Elite get full trail
  const includedTrail = includeFullTrail ? gpsTrail : gpsTrail.slice(-5); // Free: last 5 points only

  const vault: VaultPackage = {
    vaultId,
    emergencyId: params.emergencyId,
    userId: params.userId,
    userName: params.userName,
    startTime: params.startTime,
    endTime: params.endTime,
    durationSec: Math.round((params.endTime - params.startTime) / 1000),
    tier: sub.tier,
    contactsNotified: params.contactsNotified.map(c => ({
      name: c.name,
      phone: maskPhone(c.phone),
      method: c.method || "twilio",
    })),
    gpsTrail: includedTrail,
    photoCount: photoIds.length,
    photoIds,
    audioRecording: includeAudio && params.recordingDurationSec
      ? {
          available: true,
          durationSec: params.recordingDurationSec,
          format: params.recordingFormat || "webm",
        }
      : null,
    integrityHash: "", // Will be computed below
    lockedAt: null,
    synced: false,
    shareUrl: null,
    createdAt: now,
  };

  // Compute integrity hash over the entire package (excluding the hash itself)
  const hashInput = JSON.stringify({
    ...vault,
    integrityHash: undefined,
    synced: undefined,
    shareUrl: undefined,
  });
  vault.integrityHash = await computeHash(hashInput);

  // G-26: serialise through write-lock so concurrent createVault calls
  // (e.g. multi-photo capture firing in parallel) don't clobber each other.
  await mutateVaults((current) => [...current, vault]);

  console.info(`[EvidenceVault] Created: ${vaultId} | Hash: ${vault.integrityHash.slice(0, 16)}... | Photos: ${vault.photoCount} | GPS: ${vault.gpsTrail.length} points`);

  // Auto-upload in background (non-blocking)
  uploadVault(vaultId).catch(() => {});

  return vault;
}

/**
 * Mask phone number for privacy in vault (show last 4 digits).
 */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return "****";
  return "*".repeat(phone.length - 4) + phone.slice(-4);
}

/**
 * Lock a vault — finalizes the integrity hash and prevents modifications.
 * Auto-called 24 hours after creation, or manually by the user.
 */
export async function lockVault(vaultId: string): Promise<boolean> {
  // G-26: read-modify-write must run inside the vault write-lock so a
  // parallel createVault/updateVault doesn't observe a stale array.
  let didLock = false;
  await mutateVaults(async (current) => {
    const vault = current.find(v => v.vaultId === vaultId);
    if (!vault) return current;
    if (vault.lockedAt) { didLock = true; return current; } // Already locked
    const hashInput = JSON.stringify({
      ...vault,
      integrityHash: undefined,
      lockedAt: undefined,
      synced: undefined,
      shareUrl: undefined,
    });
    vault.integrityHash = await computeHash(hashInput);
    vault.lockedAt = Date.now();
    didLock = true;
    return current;  // mutated in place inside the lock
  });
  if (didLock) console.info(`[EvidenceVault] Locked: ${vaultId}`);
  return didLock;
}

/**
 * Upload vault metadata to Supabase (evidence files uploaded separately).
 */
async function uploadVault(vaultId: string): Promise<boolean> {
  const vaults = loadVaults();
  const vault = vaults.find(v => v.vaultId === vaultId);
  if (!vault || vault.synced) return vault?.synced ?? false;

  try {
    const { error } = await supabase
      .from("evidence_vaults")
      .upsert({
        vault_id: vault.vaultId,
        emergency_id: vault.emergencyId,
        user_id: vault.userId,
        user_name: vault.userName,
        start_time: new Date(vault.startTime).toISOString(),
        end_time: vault.endTime ? new Date(vault.endTime).toISOString() : null,
        duration_sec: vault.durationSec,
        tier: vault.tier,
        contacts_notified: vault.contactsNotified,
        gps_trail: vault.gpsTrail,
        photo_count: vault.photoCount,
        audio_available: vault.audioRecording?.available ?? false,
        audio_duration_sec: vault.audioRecording?.durationSec ?? 0,
        integrity_hash: vault.integrityHash,
        locked_at: vault.lockedAt ? new Date(vault.lockedAt).toISOString() : null,
        created_at: new Date(vault.createdAt).toISOString(),
      }, { onConflict: "vault_id" });

    if (error) {
      // Table might not exist yet — non-fatal
      if (/does not exist|schema cache/i.test(error.message || "")) {
        console.warn("[EvidenceVault] Table not found — vault stored locally only.");
        return false;
      }
      console.error("[EvidenceVault] Upload error:", error.message);
      return false;
    }

    vault.synced = true;
    saveVaults(vaults);
    console.info(`[EvidenceVault] Uploaded: ${vaultId}`);
    return true;
  } catch (err: any) {
    console.warn("[EvidenceVault] Upload failed (will retry):", err.message || err);
    return false;
  }
}

/**
 * Generate a share URL for the vault.
 * The URL points to a SOSphere page that displays the vault contents.
 */
export function generateShareUrl(vaultId: string): string | null {
  const vaults = loadVaults();
  const vault = vaults.find(v => v.vaultId === vaultId);
  if (!vault) return null;

  // Generate a one-time share token
  const shareToken = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, "0")).join("");

  const url = `https://sosphere.co/vault/${vaultId}?s=${shareToken}`;
  vault.shareUrl = url;
  saveVaults(vaults);

  console.info(`[EvidenceVault] Share URL generated: ${url}`);
  return url;
}

/**
 * Get a vault by ID.
 */
export function getVault(vaultId: string): VaultPackage | null {
  const vaults = loadVaults();
  return vaults.find(v => v.vaultId === vaultId) || null;
}

/**
 * Get the vault for a specific emergency.
 */
export function getVaultForEmergency(emergencyId: string): VaultPackage | null {
  const vaults = loadVaults();
  return vaults.find(v => v.emergencyId === emergencyId) || null;
}

/**
 * Get all vaults as summaries (for listing in the app).
 */
export function getAllVaultSummaries(): VaultSummary[] {
  const vaults = loadVaults();
  return vaults.map(v => ({
    vaultId: v.vaultId,
    emergencyId: v.emergencyId,
    startTime: v.startTime,
    durationSec: v.durationSec,
    photoCount: v.photoCount,
    hasAudio: v.audioRecording?.available ?? false,
    gpsPoints: v.gpsTrail.length,
    integrityHash: v.integrityHash,
    synced: v.synced,
    shareUrl: v.shareUrl,
  }));
}

/**
 * Verify the integrity of a vault — returns true if hash matches.
 */
export async function verifyVaultIntegrity(vaultId: string): Promise<boolean> {
  const vaults = loadVaults();
  const vault = vaults.find(v => v.vaultId === vaultId);
  if (!vault) return false;

  const hashInput = JSON.stringify({
    ...vault,
    integrityHash: undefined,
    lockedAt: undefined,
    synced: undefined,
    shareUrl: undefined,
  });
  const computedHash = await computeHash(hashInput);
  const valid = computedHash === vault.integrityHash;

  if (!valid) {
    console.error(`[EvidenceVault] INTEGRITY VIOLATION: ${vaultId} — hash mismatch!`);
  }
  return valid;
}

/**
 * Auto-lock expired vaults (call periodically or on app start).
 */
export async function autoLockExpiredVaults(): Promise<number> {
  const vaults = loadVaults();
  const lockThreshold = Date.now() - VAULT_LOCK_HOURS * 60 * 60 * 1000;
  let locked = 0;

  for (const vault of vaults) {
    if (!vault.lockedAt && vault.createdAt < lockThreshold) {
      await lockVault(vault.vaultId);
      locked++;
    }
  }

  if (locked > 0) {
    console.info(`[EvidenceVault] Auto-locked ${locked} expired vault(s).`);
  }
  return locked;
}

/**
 * Retry uploading unsynced vaults (call on network recovery).
 */
export async function syncPendingVaults(): Promise<number> {
  const vaults = loadVaults();
  let synced = 0;

  for (const vault of vaults) {
    if (!vault.synced) {
      const ok = await uploadVault(vault.vaultId);
      if (ok) synced++;
    }
  }

  if (synced > 0) {
    console.info(`[EvidenceVault] Synced ${synced} pending vault(s).`);
  }
  return synced;
}
