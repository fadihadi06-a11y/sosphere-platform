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

const TIER_CONFIG: Record<SubscriptionTier, SubscriptionInfo> = {
  free: {
    tier: "free",
    maxContacts: 1,
    callDurationSec: 30,    // 30 seconds per contact
    recordingMaxSec: 30,    // 30 seconds recording
    maxPhotos: 1,           // 1 photo
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
    callDurationSec: 60,    // 1 minute per contact
    recordingMaxSec: 60,    // 1 minute recording
    maxPhotos: 6,           // 6 photos
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
    callDurationSec: 300,   // 5 minutes per contact
    recordingMaxSec: 90,    // 1.5 minutes recording
    maxPhotos: 999,         // Unlimited photos
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

const STORAGE_KEY = "sosphere_subscription";

/** Get current subscription tier */
export function getSubscription(): SubscriptionInfo {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.tier && TIER_CONFIG[parsed.tier as SubscriptionTier]) {
        return TIER_CONFIG[parsed.tier as SubscriptionTier];
      }
    }
  } catch {}
  return TIER_CONFIG.free; // Default to free
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
