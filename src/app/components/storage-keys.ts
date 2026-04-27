// ═══════════════════════════════════════════════════════════════════════════
// storage-keys — central registry of all localStorage / sessionStorage keys
// ─────────────────────────────────────────────────────────────────────────
// TIER 3 cleanup (2026-04-27): the codebase had ~25 distinct localStorage
// keys with inconsistent naming. Some used the `sosphere_` prefix
// convention, others didn't. This module:
//
//   1. Enumerates EVERY key the app uses (one source of truth)
//   2. Normalizes naming to `sosphere_<feature>_<detail>` (snake_case)
//   3. Provides `getStorageKey(name)` helper that prepends the prefix if
//      a caller forgot it (defense-in-depth)
//   4. Provides `migrateLegacyKey(oldKey, newKey)` so we can rename a key
//      without losing user data — reads from old key, writes to new key,
//      removes old key
//
// All consumers SHOULD import from here. New keys MUST be added here.
// ═══════════════════════════════════════════════════════════════════════════

export const STORAGE_PREFIX = "sosphere_";

export const STORAGE_KEYS = {
  // ── Auth / Identity ──
  authTosConsent:        "sosphere_tos_consent",
  authGpsConsent:        "sosphere_gps_consent",
  authBiometricEnabled:  "sosphere_biometric_enabled",
  authPinHash:           "sosphere_app_unlock_pin_hash",
  authPinSalt:           "sosphere_pin_salt",
  authBiometricCredential: "sosphere_biometric_credential",
  authBiometricUserId:   "sosphere_biometric_user_id",
  authAdminPhone:        "sosphere_admin_phone",
  authAdminProfile:      "sosphere_admin_profile",

  // ── User profile / settings ──
  emergencyContacts:     "sosphere_emergency_contacts",
  medicalProfile:        "sosphere_medical_profile",
  emergencyPacket:       "sosphere_emergency_packet",
  language:              "sosphere_language",
  countryCode:           "sosphere_country_code",
  neighborAlertSettings: "sosphere_neighbor_alert_settings",

  // ── Evidence / SOS state ──
  evidenceVault:         "sosphere_evidence_vault",
  incidentPhotos:        "sosphere_incident_photos",
  callTranscripts:       "sosphere_call_transcripts",
  gpsTrail:              "sosphere_gps_trail",
  sosLastSession:        "sosphere_sos_last_session",
  sosRetryQueue:         "sosphere_sos_retry_queue",

  // ── Audit / compliance ──
  auditLog:              "sosphere_audit_log",
  auditEventLog:         "sosphere_audit_event_log",
  auditRetryQueue:       "sosphere_audit_retry_queue",

  // ── Subscription / billing ──
  subscriptionTier:      "sosphere_subscription_tier",
  subscriptionState:     "sosphere_subscription_state",

  // ── AI Co-Admin ephemeral state ──
  // emergencyId-suffixed; constructed via aiCoAdminContext(emergencyId)
} as const;

export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];

/**
 * Build the AI Co-Admin context key for a given emergency. Replaces the
 * legacy non-prefixed `ai_coadmin_${emergencyId}` keys.
 */
export function aiCoAdminContext(emergencyId: string): string {
  return `${STORAGE_PREFIX}ai_coadmin_${emergencyId}`;
}

/**
 * Defense-in-depth: if a caller passes a key without the prefix, prepend
 * it. Idempotent — already-prefixed keys pass through unchanged. Useful
 * during the migration period when some call sites haven't been updated.
 */
export function getStorageKey(name: string): string {
  if (typeof name !== "string" || name.length === 0) return STORAGE_PREFIX;
  if (name.startsWith(STORAGE_PREFIX)) return name;
  return STORAGE_PREFIX + name;
}

/**
 * One-shot migration: read value from oldKey, write to newKey, remove
 * oldKey. Safe to call repeatedly — if oldKey is absent or newKey already
 * has data, returns false without touching anything.
 *
 * Returns true if a migration actually occurred, false otherwise.
 */
export function migrateLegacyKey(oldKey: string, newKey: string): boolean {
  if (typeof localStorage === "undefined") return false;
  if (oldKey === newKey) return false;
  try {
    const newVal = localStorage.getItem(newKey);
    if (newVal !== null) {
      // New key already populated — nothing to migrate. Clean up old key
      // if it still exists (best-effort — not critical).
      const oldVal = localStorage.getItem(oldKey);
      if (oldVal !== null) {
        try { localStorage.removeItem(oldKey); } catch {}
      }
      return false;
    }
    const oldVal = localStorage.getItem(oldKey);
    if (oldVal === null) return false;
    localStorage.setItem(newKey, oldVal);
    localStorage.removeItem(oldKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run all known legacy-key migrations on app startup. Call once from the
 * top-level bootstrap (e.g., main.tsx). Idempotent — safe to call on
 * every cold start; subsequent calls are no-ops once migration is done.
 */
export function runLegacyMigrations(): { migrated: string[] } {
  const migrated: string[] = [];
  // Mappings: oldKey → newKey (each represents a TIER 3 cleanup batch)
  const PAIRS: Array<[string, string]> = [
    ["CREDENTIAL_KEY", STORAGE_KEYS.authBiometricCredential],
    ["USER_ID_KEY", STORAGE_KEYS.authBiometricUserId],
    ["AUDIT_KEY", STORAGE_KEYS.auditLog],
    ["AUDIT_EVENT_KEY", STORAGE_KEYS.auditEventLog],
    ["RETRY_QUEUE_KEY", STORAGE_KEYS.auditRetryQueue],
  ];
  for (const [oldKey, newKey] of PAIRS) {
    if (migrateLegacyKey(oldKey, newKey)) migrated.push(`${oldKey} → ${newKey}`);
  }
  return { migrated };
}

/**
 * Return all known canonical keys (for introspection / testing).
 */
export function getAllKnownKeys(): string[] {
  return Object.values(STORAGE_KEYS);
}
