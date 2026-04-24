/**
 * SOSphere Subscription Tier Service
 * ═══════════════════════════════════
 * Three-tier civilian safety model:
 *   FREE ($0)  — Universal right to safety: 1 contact, basic SOS, basic stealth
 *   BASIC ($7) — Up to 10 contacts, Walk Me, SMS fallback, Heartbeat
 *   ELITE ($14) — Full suite: PDF Dossier, AI Voice Calls, Advanced Stealth, Duress Code
 *
 * SUPABASE_MIGRATION_POINT: Replace localStorage with supabase.from('subscriptions')
 */

export type SubscriptionTier = "free" | "basic" | "elite";

export interface SubscriptionInfo {
  tier: SubscriptionTier;
  maxContacts: number;
  /** SOS call duration per contact in seconds */
  callDurationSec: number;
  /** Voice recording max duration in seconds */
  recordingMaxSec: number;
  /** Max photos in incident documentation */
  maxPhotos: number;
  features: {
    walkMe: boolean;
    smsFallback: boolean;
    heartbeat: boolean;
    forensicPdf: boolean;
    aiVoiceCalls: boolean;
    advancedStealth: boolean;
    duressCode: boolean;
    webViewerLink: boolean; // Free: sends SMS with web tracking link
  };
  price: number;
  label: string;
  labelAr: string;
}

// ═══════════════════════════════════════════════════════════════
// FIX 2026-04-24 (pre-launch audit #6): TIER_CONFIG is now the
// AUTHORITATIVE SOURCE for all per-tier limits. Previously
// MAX_CONTACTS_BY_TIER was hardcoded separately in
// sos-server-trigger.ts (free:1, basic:3, elite:999) and in
// sos-alert/index.ts TIER_CAP (free:1, basic:3, elite:999) —
// three different numbers for the same thing.
//
// Post-launch v1.1 moves this whole table to a DB table so prices
// and limits can be changed without a redeploy. Until then,
// sos-alert keeps its own local copy (Deno can't import src/) —
// keep both in sync.
// ═══════════════════════════════════════════════════════════════
const TIER_CONFIG: Record<SubscriptionTier, SubscriptionInfo> = {
  free: {
    tier: "free",
    maxContacts: 1,
    // FIX pre-launch: 30s was cutting off before contacts could answer.
    // Twilio ring + answer detection takes ~10-15s, leaving <15s for
    // the SOS message. 45s gives a usable window while staying cheap.
    callDurationSec: 45,
    recordingMaxSec: 30,
    maxPhotos: 1,
    features: {
      walkMe: false,
      smsFallback: false,
      heartbeat: false,
      forensicPdf: false,
      aiVoiceCalls: false,
      advancedStealth: false,
      duressCode: false,
      webViewerLink: true,
    },
    price: 0,
    label: "Free — Universal Safety",
    labelAr: "مجاني — الأمان للجميع",
  },
  basic: {
    tier: "basic",
    maxContacts: 6,
    callDurationSec: 60,
    recordingMaxSec: 60,
    maxPhotos: 6,
    features: {
      walkMe: true,
      smsFallback: true,
      heartbeat: true,
      forensicPdf: false,
      aiVoiceCalls: false,
      advancedStealth: false,
      duressCode: false,
      webViewerLink: true,
    },
    price: 7,
    label: "Basic Safeguard — $7/mo",
    labelAr: "الحماية الأساسية — $7/شهر",
  },
  elite: {
    tier: "elite",
    maxContacts: 10,
    // FIX pre-launch: 300s (5 min) was overkill. Real emergency
    // responders answer + understand in 30-60s; 5-minute calls just
    // burn ~$0.60 of Twilio billing per contact per SOS with zero
    // UX benefit. 120s is generous and keeps margins healthy.
    callDurationSec: 120,
    recordingMaxSec: 90,
    maxPhotos: 999,
    features: {
      walkMe: true,
      smsFallback: true,
      heartbeat: true,
      forensicPdf: true,
      aiVoiceCalls: true,
      advancedStealth: true,
      duressCode: true,
      webViewerLink: true,
    },
    price: 14,
    label: "Elite Shield — $14/mo",
    labelAr: "الدرع النخبوي — $14/شهر",
  },
};

// ─────────────────────────────────────────────────────────────
// Per-tier SOS trigger rate limits — anti-abuse + cost protection.
// Applied server-side in sos-alert edge function (Fix #6).
// A real emergency in someone's life is rare (2-3/year typical);
// these caps allow genuine emergencies even in very bad days while
// blocking pattern-based abuse (bot hammering the endpoint).
// ─────────────────────────────────────────────────────────────
export const TIER_SOS_RATE_LIMITS: Record<SubscriptionTier, { perHour: number; perDay: number }> = {
  free:  { perHour: 1, perDay: 3  },   // Free also has 3/month via INDIVIDUAL_PLANS
  basic: { perHour: 3, perDay: 15 },
  elite: { perHour: 5, perDay: 30 },
};

const STORAGE_KEY = "sosphere_subscription";

/**
 * Read the tier the user explicitly chose/paid for (never upgraded
 * by a trial). Used by the subscription UI to show what the user is
 * reverting to after a trial ends. Also used internally by
 * getSubscription() as a fallback when no trial is active.
 */
export function getStoredTier(): SubscriptionTier {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.tier && TIER_CONFIG[parsed.tier as SubscriptionTier]) {
        return parsed.tier as SubscriptionTier;
      }
    }
  } catch {}
  return "free";
}

/**
 * Get current EFFECTIVE subscription tier. If an Elite trial is
 * active, returns Elite regardless of the stored tier. When the
 * trial expires, this automatically reverts — no mutation of the
 * stored tier ever occurs. (Phase 10.)
 */
export function getSubscription(): SubscriptionInfo {
  // Circular-import-safe: resolve lazily via require-style dynamic eval.
  // trial-service has no dependency on this module, so this is a one-way
  // read and cannot loop.
  try {
    // Inline lookup of the trial state key to avoid importing
    // trial-service (keeps this module dependency-free for legacy callers).
    const raw = localStorage.getItem("sosphere_trial_state");
    if (raw) {
      const t = JSON.parse(raw);
      if (
        t?.status === "active" &&
        typeof t.startedAt === "number" &&
        typeof t.durationMs === "number" &&
        Date.now() - t.startedAt < t.durationMs &&
        t?.tier && TIER_CONFIG[t.tier as SubscriptionTier]
      ) {
        return TIER_CONFIG[t.tier as SubscriptionTier];
      }
    }
  } catch {}
  return TIER_CONFIG[getStoredTier()];
}

/** Get just the tier string */
export function getTier(): SubscriptionTier {
  return getSubscription().tier;
}

/** Set subscription tier */
export function setSubscription(tier: SubscriptionTier): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tier,
      updatedAt: Date.now(),
    }));
  } catch {}
}

/** Check if a specific feature is available */
export function hasFeature(feature: keyof SubscriptionInfo["features"]): boolean {
  return getSubscription().features[feature];
}

/** Get max allowed contacts for current tier */
export function getMaxContacts(): number {
  return getSubscription().maxContacts;
}

/** Check if user can add more contacts */
export function canAddContact(currentCount: number): boolean {
  return currentCount < getSubscription().maxContacts;
}

/** Get tier config for display */
export function getTierConfig(tier: SubscriptionTier): SubscriptionInfo {
  return TIER_CONFIG[tier];
}

/** Get all tiers for comparison display */
export function getAllTiers(): SubscriptionInfo[] {
  return [TIER_CONFIG.free, TIER_CONFIG.basic, TIER_CONFIG.elite];
}

/** Check if upgrade is needed for a feature */
export function getRequiredTierForFeature(feature: keyof SubscriptionInfo["features"]): SubscriptionTier {
  if (TIER_CONFIG.free.features[feature]) return "free";
  if (TIER_CONFIG.basic.features[feature]) return "basic";
  return "elite";
}

/** Get SOS call duration per contact (seconds) for current tier */
export function getCallDurationSec(): number {
  return getSubscription().callDurationSec;
}

/** Get max voice recording duration (seconds) for current tier */
export function getRecordingMaxSec(): number {
  return getSubscription().recordingMaxSec;
}

/** Get max photos allowed for current tier */
export function getMaxPhotos(): number {
  return getSubscription().maxPhotos;
}

/** Map old "free"/"pro"/"employee" to new tier system */
export function mapLegacyPlan(plan: "free" | "pro" | "employee"): SubscriptionTier {
  if (plan === "pro") return "basic";
  if (plan === "employee") return "basic"; // Employees get basic features
  return "free";
}

// ═══════════════════════════════════════════════════════════════
// Recording Timing Preference
// ═══════════════════════════════════════════════════════════════
// User-selectable when the SOS microphone recording should run.
//   "after"  — (default) record only AFTER a contact answers and the
//              call hangs up. Current production behavior. No conflict
//              with live call audio. Good for the user's post-event
//              statement.
//   "during" — record ambient audio CONTINUOUSLY from SOS activation
//              onward, through every dialing / pausing / answered phase.
//              Captures the incident itself, not just the aftermath.
//   "both"   — Elite only. "during" behavior PLUS an extra dedicated
//              post-call statement clip.
//
// NOTE: On Android 10+ the OS blocks true mid-call audio capture of
// the call PCM stream. "during" mode captures ambient audio from the
// mic (which the dialer may contend for). Real call-audio recording
// requires Twilio Voice SDK (Phase 8).

export type RecordingMode = "after" | "during" | "both";

const RECORDING_MODE_KEY = "sosphere_recording_mode";

/** Read the user's preferred recording timing. Defaults to "after". */
export function getRecordingMode(): RecordingMode {
  try {
    const v = localStorage.getItem(RECORDING_MODE_KEY);
    if (v === "during" || v === "both" || v === "after") {
      // "both" is Elite-only — silently downgrade non-Elite users to "during".
      if (v === "both" && getTier() !== "elite") return "during";
      return v;
    }
  } catch {}
  return "after";
}

/** Persist the user's preferred recording timing. */
export function setRecordingMode(mode: RecordingMode): void {
  try {
    localStorage.setItem(RECORDING_MODE_KEY, mode);
  } catch {}
}

/** Which modes are available for the current tier. */
export function availableRecordingModes(): RecordingMode[] {
  return getTier() === "elite"
    ? ["after", "during", "both"]
    : ["after", "during"];
}
