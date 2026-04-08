// ═══════════════════════════════════════════════════════════════
// SOSphere — Biometric Authentication Gate (WebAuthn)
// ─────────────────────────────────────────────────────────────
// ISO 27001 §A.9.4.2 — Secure log-on procedures
//
// Uses the Web Authentication API (WebAuthn) to require biometric
// verification before accessing sensitive areas:
//   - /compliance dashboard
//   - Viewing active SOS signals (medical data, GPS)
//   - Audit trail access
//
// Supports: FaceID (iOS/macOS), TouchID (macOS), Windows Hello,
// Android biometric, and hardware security keys (YubiKey).
//
// Flow:
//   1. Check if WebAuthn is available
//   2. If enrolled → challenge with navigator.credentials.get()
//   3. If not enrolled → prompt to register with navigator.credentials.create()
//   4. Store credential ID in localStorage (public, not sensitive)
//   5. Verification valid for configurable TTL (default: 15 minutes)
// ═══════════════════════════════════════════════════════════════

interface BiometricConfig {
  challengeTtlMs: number; // How long a verification lasts (default: 15min)
  rpName: string; // Relying party name
  rpId: string; // Relying party ID (domain)
  requireUserVerification: boolean; // true = biometric required, false = presence-only
}

export type BiometricStatus = "available" | "enrolled" | "not_available" | "not_enrolled";

interface BiometricSessionData {
  verifiedAt: number;
  credentialId: string;
}

// Default configuration
const DEFAULT_CONFIG: BiometricConfig = {
  challengeTtlMs: 15 * 60 * 1000, // 15 minutes
  rpName: "SOSphere",
  rpId: typeof window !== "undefined" ? window.location.hostname : "localhost",
  requireUserVerification: true,
};

// Session storage keys
const SESSION_KEY = "sosphere_biometric_session";
const STORAGE_KEY = "sosphere_biometric_enrolled";

// ──────────────────────────────────────────────────────────────
// Helper functions
// ──────────────────────────────────────────────────────────────

/**
 * Convert a string to a Uint8Array
 */
function stringToBuffer(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Convert a Uint8Array to a base64 string
 */
function bufferToBase64(buffer: Uint8Array): string {
  return btoa(String.fromCharCode(...buffer));
}

/**
 * Convert a base64 string to a Uint8Array
 */
function base64ToBuffer(str: string): Uint8Array {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

/**
 * Generate a random challenge (32 bytes)
 */
function generateChallenge(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

// ──────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────

/**
 * Check if biometric authentication is available on this device
 */
export async function checkBiometricAvailability(): Promise<BiometricStatus> {
  if (typeof window === "undefined") {
    return "not_available";
  }

  // Check if PublicKeyCredential exists
  if (!window.PublicKeyCredential) {
    return "not_available";
  }

  try {
    // Check if platform authenticator is available (biometric capable)
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();

    if (!available) {
      return "not_available";
    }

    // Check if user already enrolled
    const enrolled = !!localStorage.getItem(STORAGE_KEY);
    return enrolled ? "enrolled" : "not_enrolled";
  } catch (e) {
    console.warn("[Biometric] Availability check failed:", e);
    return "not_available";
  }
}

/**
 * Enroll a new biometric credential
 * Returns true if enrollment successful, false otherwise
 */
export async function enrollBiometric(userId: string, userName: string): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }

  if (!window.PublicKeyCredential) {
    console.warn("[Biometric] WebAuthn not available");
    return false;
  }

  try {
    const config = DEFAULT_CONFIG;

    // Create credential request
    const credentialCreationOptions = {
      challenge: generateChallenge(),
      rp: {
        name: config.rpName,
        id: config.rpId,
      },
      user: {
        id: stringToBuffer(userId),
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [{ type: "public-key" as const, alg: -7 }], // ES256
      authenticatorSelection: {
        authenticatorAttachment: "platform" as const, // Require platform authenticator
        userVerification: config.requireUserVerification ? ("required" as const) : ("preferred" as const),
      },
      timeout: 60000, // 60 seconds
      attestation: "direct" as const,
    };

    // Attempt enrollment
    const credential = (await navigator.credentials.create({
      publicKey: credentialCreationOptions,
    })) as PublicKeyCredential | null;

    if (!credential) {
      console.warn("[Biometric] Enrollment cancelled or failed");
      return false;
    }

    // Store the credential ID in localStorage (not sensitive - just an identifier)
    const credentialId = bufferToBase64(new Uint8Array(credential.id));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ credentialId, enrolledAt: Date.now() }));

    console.log("[Biometric] Enrollment successful");
    return true;
  } catch (e) {
    console.warn("[Biometric] Enrollment failed:", e);
    return false;
  }
}

/**
 * Verify biometric identity
 * Returns true if verification successful, false otherwise
 */
export async function verifyBiometric(): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }

  if (!window.PublicKeyCredential) {
    console.warn("[Biometric] WebAuthn not available");
    return false;
  }

  try {
    // Get enrolled credential
    const enrolledData = localStorage.getItem(STORAGE_KEY);
    if (!enrolledData) {
      console.warn("[Biometric] No enrolled biometric found");
      return false;
    }

    const { credentialId } = JSON.parse(enrolledData);
    const config = DEFAULT_CONFIG;

    // Create assertion request
    const credentialGetOptions = {
      challenge: generateChallenge(),
      allowCredentials: [
        {
          type: "public-key" as const,
          id: base64ToBuffer(credentialId),
        },
      ],
      userVerification: config.requireUserVerification ? ("required" as const) : ("preferred" as const),
      timeout: 60000, // 60 seconds
    };

    // Attempt verification
    const assertion = (await navigator.credentials.get({
      publicKey: credentialGetOptions,
    })) as PublicKeyCredential | null;

    if (!assertion) {
      console.warn("[Biometric] Verification cancelled or failed");
      return false;
    }

    // Store verification timestamp in sessionStorage
    const sessionData: BiometricSessionData = {
      verifiedAt: Date.now(),
      credentialId,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));

    console.log("[Biometric] Verification successful");
    return true;
  } catch (e) {
    console.warn("[Biometric] Verification failed:", e);
    return false;
  }
}

/**
 * Check if biometric verification is still valid (within TTL)
 */
export function isBiometricVerified(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const sessionData = sessionStorage.getItem(SESSION_KEY);
  if (!sessionData) {
    return false;
  }

  try {
    const data: BiometricSessionData = JSON.parse(sessionData);
    const config = DEFAULT_CONFIG;
    const elapsed = Date.now() - data.verifiedAt;

    const isValid = elapsed < config.challengeTtlMs;
    if (!isValid) {
      // Expire the session
      sessionStorage.removeItem(SESSION_KEY);
    }

    return isValid;
  } catch (e) {
    console.warn("[Biometric] Session check failed:", e);
    sessionStorage.removeItem(SESSION_KEY);
    return false;
  }
}

/**
 * Clear the biometric verification session
 */
export function clearBiometricSession(): void {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

/**
 * Get current biometric status
 */
export function getBiometricStatus(): {
  available: boolean;
  enrolled: boolean;
  lastVerifiedAt: number | null;
  ttlRemainingMs: number;
} {
  const config = DEFAULT_CONFIG;

  // Check availability
  const available = typeof window !== "undefined" && !!window.PublicKeyCredential;

  // Check enrollment
  const enrolledData = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  const enrolled = !!enrolledData;

  // Check verification
  const sessionData = typeof window !== "undefined" ? sessionStorage.getItem(SESSION_KEY) : null;
  let lastVerifiedAt: number | null = null;
  let ttlRemainingMs = 0;

  if (sessionData) {
    try {
      const data: BiometricSessionData = JSON.parse(sessionData);
      lastVerifiedAt = data.verifiedAt;
      ttlRemainingMs = Math.max(0, config.challengeTtlMs - (Date.now() - data.verifiedAt));

      // Expire if TTL exceeded
      if (ttlRemainingMs === 0) {
        sessionStorage.removeItem(SESSION_KEY);
        lastVerifiedAt = null;
      }
    } catch (e) {
      console.warn("[Biometric] Status check failed:", e);
    }
  }

  return {
    available,
    enrolled,
    lastVerifiedAt,
    ttlRemainingMs,
  };
}

/**
 * Unenroll biometric (remove stored credential)
 */
export function unenrollBiometric(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  }
}
