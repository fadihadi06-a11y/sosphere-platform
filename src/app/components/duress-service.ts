/**
 * SOSphere Duress PIN Service
 * ═══════════════════════════
 * A "duress code" is a second PIN that LOOKS like a normal deactivation PIN
 * to an attacker/coercer, but secretly:
 *   • Tags the end-of-SOS event with duress=true (server/dashboard see the flag)
 *   • Leaves a distinct trail in the incident timeline
 *   • Still ends the local SOS UI so the coercer is visually deceived
 *
 * Design principles:
 *   • Purely additive — no existing flow is altered unless both PINs are set.
 *   • Storage is isolated from the normal deactivation PIN key.
 *   • Tier-gated: Elite-only feature per subscription-service.features.duressCode.
 *
 * SUPABASE_MIGRATION_POINT: replace localStorage with a server-side hashed
 * record on the user's profile row. For now PINs are stored plaintext to
 * match the existing deactivation-PIN pattern; migrate to SHA-256 in Phase 5.
 */

import { hasFeature } from "./subscription-service";

const DURESS_PIN_KEY          = "sosphere_duress_pin";
const DEACTIVATION_PIN_KEY    = "sosphere_deactivation_pin"; // existing key, read-only from here

/** Elite feature gate. Returns true only for tiers that unlock duressCode. */
export function isDuressFeatureAvailable(): boolean {
  return hasFeature("duressCode");
}

/** Read the stored duress PIN, or null if none is configured. */
export function getDuressPin(): string | null {
  try {
    const v = localStorage.getItem(DURESS_PIN_KEY);
    return v && v.trim().length >= 4 ? v : null;
  } catch {
    return null;
  }
}

/** Set or clear the duress PIN. Pass null/"" to clear. Returns success. */
export function setDuressPin(pin: string | null): boolean {
  try {
    if (pin === null || pin === "") {
      localStorage.removeItem(DURESS_PIN_KEY);
      return true;
    }
    // Basic sanity: 4-10 digits. Exact validation lives in the UI caller.
    if (!/^\d{4,10}$/.test(pin)) return false;
    // Guard: duress PIN must differ from the normal deactivation PIN.
    // Same PIN would defeat the entire point of duress mode.
    const normal = getDeactivationPin();
    if (normal && normal === pin) return false;
    localStorage.setItem(DURESS_PIN_KEY, pin);
    return true;
  } catch {
    return false;
  }
}

/** True if the input exactly matches the configured duress PIN. */
export function isDuressPin(input: string): boolean {
  const stored = getDuressPin();
  if (!stored) return false;
  return input === stored;
}

/** Convenience read-only accessor for the normal deactivation PIN. */
export function getDeactivationPin(): string | null {
  try {
    const v = localStorage.getItem(DEACTIVATION_PIN_KEY);
    return v && v.trim().length >= 4 ? v : null;
  } catch {
    return null;
  }
}

/** Setter for the normal deactivation PIN — mirrors the duress rules. */
export function setDeactivationPin(pin: string | null): boolean {
  try {
    if (pin === null || pin === "") {
      localStorage.removeItem(DEACTIVATION_PIN_KEY);
      return true;
    }
    if (!/^\d{4,10}$/.test(pin)) return false;
    // Guard: must differ from duress PIN so user cannot accidentally shadow it.
    const duress = getDuressPin();
    if (duress && duress === pin) return false;
    localStorage.setItem(DEACTIVATION_PIN_KEY, pin);
    return true;
  } catch {
    return false;
  }
}

/** Whether a normal deactivation PIN is configured. */
export function isDeactivationPinSet(): boolean {
  return getDeactivationPin() !== null;
}

/** Whether a duress PIN is configured. */
export function isDuressPinSet(): boolean {
  return getDuressPin() !== null;
}
