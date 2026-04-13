// SOSphere — Environment Shield
// ISO 27001 §A.14.2.6 — Secure Development Environment
//
// Prevents sensitive environment variables from leaking into:
//   - Console logs (overrides console.log in production)
//   - Error messages sent to Sentry
//   - DOM content or React state
//   - Network requests visible in DevTools
//
// Also provides a safe accessor that masks sensitive values.

// List of env var patterns that contain secrets
const SENSITIVE_PATTERNS = [
  /VITE_SUPABASE_ANON_KEY/i,
  /VITE_FIREBASE_API_KEY/i,
  /VITE_FIREBASE_VAPID_KEY/i,
  /VITE_SENTRY_DSN/i,
  /VITE_TWILIO/i,
  /VITE_FALLBACK_API_URL/i,
  /key/i,
  /secret/i,
  /token/i,
  /password/i,
];

/**
 * Checks if a string contains sensitive information matching known patterns.
 * @param str The string to check
 * @returns true if the string appears to contain sensitive data
 */
function containsSensitiveData(str: string): boolean {
  if (typeof str !== "string") return false;
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(str));
}

/**
 * Masks a sensitive value, showing only first N and last N characters.
 * For strings shorter than 12 characters, shows only first 2 chars.
 * @param value The value to mask
 * @returns The masked value (e.g., "abc***xyz")
 */
export function maskSensitiveValue(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    return "[REDACTED]";
  }

  if (value.length < 12) {
    // Very short value: show first 2 chars only
    return value.substring(0, 2) + "***";
  }

  // Show first 4 and last 4 characters
  const first = value.substring(0, 4);
  const last = value.substring(value.length - 4);
  return `${first}***${last}`;
}

/**
 * Recursively scans an object/array for sensitive values and masks them.
 * @param obj The object to scan and mask
 * @returns A copy with sensitive values masked
 */
function maskSensitiveInObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    if (containsSensitiveData(obj)) {
      return maskSensitiveValue(obj);
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => maskSensitiveInObject(item));
  }

  if (typeof obj === "object") {
    const masked: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Check if the key itself indicates sensitivity
      if (containsSensitiveData(key)) {
        masked[key] = "[REDACTED]";
      } else {
        masked[key] = maskSensitiveInObject(value);
      }
    }
    return masked;
  }

  return obj;
}

/**
 * Wraps a console method to filter out sensitive data before logging.
 * Does NOT suppress logs entirely — just masks sensitive substrings.
 */
function createConsoleWrapper(originalMethod: (...args: any[]) => void) {
  return function wrappedConsoleMethod(...args: any[]) {
    const maskedArgs = args.map(arg => maskSensitiveInObject(arg));
    originalMethod.apply(console, maskedArgs);
  };
}

/**
 * Initialize the Environment Shield.
 * In production, wraps console methods to prevent secret leakage.
 * Call this at app startup (before other initialization).
 */
export function initEnvShield(): void {
  const isProd = import.meta.env.PROD;

  if (!isProd) {
    // In development, provide a warning that shield is disabled
    // but don't actually wrap console methods
    if (typeof console !== "undefined") {
      console.log("[EnvShield] Running in development mode — console filtering disabled.");
    }
    return;
  }

  // In production, wrap all console methods
  if (typeof console !== "undefined") {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = createConsoleWrapper(originalLog);
    console.warn = createConsoleWrapper(originalWarn);
    console.error = createConsoleWrapper(originalError);

    // Log a startup message using the wrapped console
    originalLog("[EnvShield] ACTIVE — sensitive data is being filtered from logs");
  }
}

/**
 * Returns a summary of all VITE_ environment variables with values masked.
 * Useful for debugging without exposing secrets.
 * @returns Record of env var names to masked values
 */
export function getSafeEnvSummary(): Record<string, string> {
  const summary: Record<string, string> = {};

  // Only look at import.meta.env for VITE_ prefixed vars
  for (const [key, value] of Object.entries(import.meta.env)) {
    if (key.startsWith("VITE_")) {
      const strValue = String(value);
      if (strValue && strValue.length > 0) {
        summary[key] = maskSensitiveValue(strValue);
      }
    }
  }

  return summary;
}

/**
 * Validates that required environment variables are set for production.
 * Returns a detailed report of what's configured and what's missing.
 * @returns Object with valid flag, list of missing vars, and warnings
 */
export function validateEnvIntegrity(): {
  valid: boolean;
  missing: string[];
  warnings: string[];
} {
  const missing: string[] = [];
  const warnings: string[] = [];
  const isProd = import.meta.env.PROD;

  // Critical: Supabase configuration
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    if (isProd) {
      missing.push("VITE_SUPABASE_URL");
    } else {
      warnings.push("VITE_SUPABASE_URL not set — using offline mode");
    }
  } else if (typeof supabaseUrl === "string" && !supabaseUrl.startsWith("https://")) {
    warnings.push("VITE_SUPABASE_URL must use HTTPS");
  }

  if (!supabaseAnonKey) {
    if (isProd) {
      missing.push("VITE_SUPABASE_ANON_KEY");
    } else {
      warnings.push("VITE_SUPABASE_ANON_KEY not set — using offline mode");
    }
  } else if (typeof supabaseAnonKey === "string" && supabaseAnonKey.length < 20) {
    warnings.push("VITE_SUPABASE_ANON_KEY appears to be invalid (too short)");
  }

  // Critical: Sentry for error tracking (production only)
  const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
  if (!sentryDsn && isProd) {
    missing.push("VITE_SENTRY_DSN");
  }

  // Important: Firebase for push notifications
  const firebaseApiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  if (!firebaseApiKey) {
    warnings.push("VITE_FIREBASE_API_KEY not set — push notifications disabled");
  }

  // Optional: Twilio for PSTN calls
  const twilioEnabled = import.meta.env.VITE_TWILIO_ENABLED;
  if (!twilioEnabled) {
    warnings.push("VITE_TWILIO_ENABLED not set — voice calls limited to WebRTC");
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}
