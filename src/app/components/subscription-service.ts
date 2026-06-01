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
    forensicPdf: boolean;          // R-47: per-incident PDF report. Basic+Elite.
    monthlySummaryPdf: boolean;    // R-47: auto monthly summary email. Elite only (generator deferred to v1.1).
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
      monthlySummaryPdf: false,
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
      forensicPdf: true,          // R-47: Basic now gets per-incident PDF reports.
      monthlySummaryPdf: false,   // Monthly summary is Elite-only.
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
      monthlySummaryPdf: true,    // R-47: Elite-exclusive auto monthly digest (generator: v1.1).
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

// ═══════════════════════════════════════════════════════════════
// 2026-05-31 CRIT-2 WORLD-CLASS REFACTOR — Server-state architecture
// ─────────────────────────────────────────────────────────────
// CONTRACT (read this before editing):
//
//   The AUTHORITATIVE source of truth for the user's tier is the
//   server (`subscriptions` table, fetched via get_my_subscription_tier
//   RPC). The client mirrors that into _serverTier (in-memory) on
//   every successful server fetch. localStorage is a BOOTSTRAP CACHE
//   ONLY — it gives the next session instant-paint while the server
//   refresh races to confirm.
//
//   Priority order in getSubscription():
//     1. Active trial → trial tier (overrides everything)
//     2. _serverTier in memory → that
//     3. localStorage bootstrap cache → that
//     4. "free" (fail-secure default)
//
//   Anti-pattern this replaces (pre-2026-05-31):
//     getSubscription() read localStorage as truth. Webhook updated DB.
//     Listener fired but localStorage was never updated (CRIT-2). User
//     paid, server knew, client showed free forever.
//
//   The previous CRIT-2 fix (2026-05-31 first pass) patched the
//   symptom by adding setSubscription() inside refreshTier. This
//   refactor makes the architecture itself correct: the in-memory
//   state IS the source of truth during a session; localStorage is
//   now explicitly named as a cache.
// ═══════════════════════════════════════════════════════════════

/**
 * In-memory authoritative tier. Set by setServerTier() whenever
 * mobile-app's refreshTier() completes a successful server fetch.
 * NULL means "we have not yet fetched from server in this session"
 * → getSubscription() will fall back to localStorage bootstrap cache.
 */
let _serverTier: SubscriptionTier | null = null;

/**
 * Called by refreshTier() in mobile-app.tsx on every successful
 * server fetch (realtime, post-checkout, capacitor-resume, focus,
 * periodic-5min, explicit-event). Becomes the in-memory truth and
 * also writes to localStorage for next-session bootstrap.
 *
 * Idempotent — repeated calls with the same tier are no-ops at the
 * observable level; localStorage timestamp does update each call,
 * which is fine (cheap, no readers care about the timestamp).
 */
export function setServerTier(tier: SubscriptionTier): void {
  _serverTier = tier;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tier,
      updatedAt: Date.now(),
    }));
  } catch { /* localStorage may be unavailable in SSR / private browsing */ }
}

/**
 * Called on logout. Clears the in-memory tier so the NEXT user's
 * session does not inherit the previous user's bootstrap cache.
 * Also clears the localStorage bootstrap so a stale tier doesn't
 * leak between accounts on a shared device.
 */
export function clearServerTier(): void {
  _serverTier = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

/**
 * Read the tier from the localStorage BOOTSTRAP CACHE.
 *
 * Distinct from getSubscription() — this skips the in-memory server
 * state and goes straight to disk. Used by:
 *   (a) getSubscription() as fallback when _serverTier not yet set
 *   (b) the UI to display "what tier does the user revert to after
 *       trial ends" — i.e. the persisted/paid baseline.
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
 * Get current EFFECTIVE subscription tier with the priority order
 * documented at the top of this section: trial > in-memory server
 * tier > localStorage bootstrap > free.
 */
export function getSubscription(): SubscriptionInfo {
  // (1) Trial check — overrides everything if active. Inline lookup
  // of the trial state key avoids importing trial-service (keeps this
  // module dependency-free for legacy callers).
  try {
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

  // (2) Server state, if set this session
  if (_serverTier) return TIER_CONFIG[_serverTier];

  // (3) Bootstrap cache from previous session (4) fails to "free"
  return TIER_CONFIG[getStoredTier()];
}

/** Get just the tier string */
export function getTier(): SubscriptionTier {
  return getSubscription().tier;
}

/**
 * @deprecated Use setServerTier() instead — clearer contract.
 *
 * Old callers (pre-2026-05-31 refactor) wrote directly to localStorage
 * via setSubscription(). The new architecture makes the in-memory
 * server tier authoritative; setSubscription is now a thin alias that
 * also updates _serverTier so legacy callers don't accidentally bypass
 * the in-memory state.
 */
export function setSubscription(tier: SubscriptionTier): void {
  setServerTier(tier);
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
