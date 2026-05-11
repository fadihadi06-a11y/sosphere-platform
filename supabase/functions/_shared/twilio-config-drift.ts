// ═══════════════════════════════════════════════════════════════
// SOSphere — L1-D Phase 2: pure drift-detection logic
// ─────────────────────────────────────────────────────────────
// Extracted from twilio-config-probe/index.ts so it's importable
// by both the Deno edge function AND the Vitest unit test (which
// runs under Node and can't follow Deno https:// imports).
//
// This file is deliberately import-free: no Deno globals, no
// fetch, no env reads. Just types + the comparison rules + URL
// normalization. The edge function wraps this with HTTP + auth +
// audit_log mirror.
// ═══════════════════════════════════════════════════════════════

// ── Types ───────────────────────────────────────────────────────────
export interface TwilioPhoneNumber {
  sid: string;
  phone_number: string;
  friendly_name?: string;
  sms_url?: string;
  sms_method?: string;
  voice_url?: string;
  voice_method?: string;
  /** If set, the phone number is bound to a TwiML App — the URL
   * fields are then ignored by Twilio. We never set this in our
   * stack, so its presence is itself a drift signal. */
  sms_application_sid?: string;
  voice_application_sid?: string;
}

export interface ExpectedConfig {
  smsUrl: string;
  smsMethod: "POST";
  /** Optional: omit to skip voice-URL checking for SMS-only deployments. */
  voiceUrl?: string;
}

export interface DriftIssue {
  field: "sms_url" | "sms_method" | "voice_url" | "sms_application_sid_set";
  expected: string;
  actual: string;
  severity: "error" | "warning";
}

export interface PhoneDriftReport {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  issues: DriftIssue[];
}

export interface DriftReport {
  total: number;
  cleanCount: number;
  driftedCount: number;
  phones: PhoneDriftReport[];
  expected: ExpectedConfig;
  generatedAt: string;
}

// ── Pure logic ──────────────────────────────────────────────────────

/** Compare each Twilio phone number's webhook config against the
 * expected canonical config. No I/O — pure function. */
export function detectDrift(
  phones: TwilioPhoneNumber[],
  expected: ExpectedConfig,
): DriftReport {
  const phoneReports: PhoneDriftReport[] = phones.map((p) => {
    const issues: DriftIssue[] = [];

    // App-bound SMS: we never use TwiML Apps. Presence => drift.
    if (p.sms_application_sid && p.sms_application_sid.length > 0) {
      issues.push({
        field: "sms_application_sid_set",
        expected: "(none — we use direct URLs)",
        actual:   p.sms_application_sid,
        severity: "error",
      });
    } else {
      const actualSmsUrl = normalizeUrl(p.sms_url || "");
      const expectedSms  = normalizeUrl(expected.smsUrl);
      if (actualSmsUrl !== expectedSms) {
        issues.push({
          field: "sms_url",
          expected: expected.smsUrl,
          actual:   p.sms_url || "(empty)",
          severity: "error",
        });
      }
      if ((p.sms_method || "").toUpperCase() !== expected.smsMethod) {
        issues.push({
          field: "sms_method",
          expected: expected.smsMethod,
          actual:   p.sms_method || "(unset)",
          severity: "error",
        });
      }
    }

    // voice_url is optional. Only enforce when caller provided one.
    if (expected.voiceUrl) {
      if (p.voice_application_sid && p.voice_application_sid.length > 0) {
        issues.push({
          field: "voice_url",
          expected: expected.voiceUrl,
          actual:   `(app-bound: ${p.voice_application_sid})`,
          severity: "warning",
        });
      } else {
        const actualVoiceUrl = normalizeUrl(p.voice_url || "");
        const expectedVoice  = normalizeUrl(expected.voiceUrl);
        if (actualVoiceUrl !== expectedVoice) {
          issues.push({
            field: "voice_url",
            expected: expected.voiceUrl,
            actual:   p.voice_url || "(empty)",
            severity: "warning",
          });
        }
      }
    }

    return {
      sid:          p.sid,
      phoneNumber:  p.phone_number,
      friendlyName: p.friendly_name || "",
      issues,
    };
  });

  const driftedCount = phoneReports.filter((p) => p.issues.length > 0).length;
  return {
    total:        phoneReports.length,
    cleanCount:   phoneReports.length - driftedCount,
    driftedCount,
    phones:       phoneReports,
    expected,
    generatedAt:  new Date().toISOString(),
  };
}

/** URL normalization for drift comparison. Twilio normalizes URLs
 * slightly (trailing slash, port, query-param order); we normalize
 * both sides before comparing so a cosmetic Twilio change doesn't
 * register as drift. */
export function normalizeUrl(u: string): string {
  if (!u) return "";
  try {
    const url = new URL(u);
    url.host = url.host.toLowerCase();
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    if ((url.protocol === "https:" && url.port === "443") ||
        (url.protocol === "http:"  && url.port === "80")) {
      url.port = "";
    }
    const params = [...url.searchParams.entries()].sort();
    url.search = "";
    for (const [k, v] of params) url.searchParams.append(k, v);
    return url.toString();
  } catch {
    return u.trim();
  }
}
