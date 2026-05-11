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
  /** L1-D Phase 2.5: if set, the number is bound to a Messaging
   * Service and Twilio routes inbound via the Service's webhook
   * (not the number's sms_url) UNLESS the Service has
   * use_inbound_webhook_on_number = true. Probe behaviour:
   *   - bound number → don't error on number's sms_url (Service
   *     is authoritative); the Service-level check covers it.
   *   - unbound number → number's sms_url IS authoritative. */
  messaging_service_sid?: string;
}

/** Twilio Messaging Service. Inbound SMS to any phone in this
 * Service's Sender Pool is routed via inbound_request_url
 * (unless use_inbound_webhook_on_number = true, in which case
 * Twilio falls back to the number-level webhook). */
export interface TwilioMessagingService {
  sid: string;
  friendly_name: string;
  inbound_request_url?: string;
  inbound_method?: string;
  fallback_url?: string;
  fallback_method?: string;
  use_inbound_webhook_on_number?: boolean;
}

export interface ExpectedConfig {
  smsUrl: string;
  smsMethod: "POST";
  /** Optional: omit to skip voice-URL checking for SMS-only deployments. */
  voiceUrl?: string;
}

export interface DriftIssue {
  field:
    | "sms_url"
    | "sms_method"
    | "voice_url"
    | "sms_application_sid_set"
    | "inbound_request_url"
    | "inbound_method"
    | "use_inbound_webhook_on_number_unexpected";
  expected: string;
  actual: string;
  severity: "error" | "warning" | "info";
}

export interface PhoneDriftReport {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  /** L1-D Phase 2.5: if the number is bound to a Messaging Service,
   * its inbound SMS is routed via the Service — the number-level
   * sms_url check is suppressed and replaced with an info line.
   * The Service's drift is reported separately in DriftReport.services. */
  routedVia?: "number" | "messaging_service";
  messagingServiceSid?: string;
  issues: DriftIssue[];
}

export interface ServiceDriftReport {
  sid: string;
  friendlyName: string;
  /** Whether the Service is configured to defer to per-number webhooks.
   * When true, the Service's own inbound_request_url is ignored at
   * runtime — we surface this as info, not drift. */
  defersToNumberLevel: boolean;
  issues: DriftIssue[];
}

export interface DriftReport {
  /** Total entities checked: phones + services. */
  total: number;
  cleanCount: number;
  driftedCount: number;
  phones: PhoneDriftReport[];
  /** L1-D Phase 2.5: per-Messaging-Service drift findings. */
  services: ServiceDriftReport[];
  expected: ExpectedConfig;
  generatedAt: string;
}

// ── Pure logic ──────────────────────────────────────────────────────

/** Build a Set of Service SIDs that defer to the per-number webhook.
 * Phones bound to such Services are treated like UNBOUND phones for
 * routing purposes — the number-level sms_url IS authoritative. */
function buildDeferringServicesSet(services: TwilioMessagingService[]): Set<string> {
  const s = new Set<string>();
  for (const svc of services) {
    if (svc.use_inbound_webhook_on_number === true) s.add(svc.sid);
  }
  return s;
}

/** Compare each Twilio phone number's webhook config against the
 * expected canonical config. No I/O — pure function.
 *
 * L1-D Phase 2.5 routing-aware behaviour: if a phone is bound to a
 * Messaging Service AND that Service does NOT defer to the number
 * (use_inbound_webhook_on_number is false/undefined), Twilio routes
 * inbound via the Service's webhook, NOT the number's sms_url. In
 * that case we suppress the number-level sms_url drift error and
 * tag the phone routedVia: "messaging_service". The Service-level
 * drift is reported separately in DriftReport.services. */
export function detectDrift(
  phones: TwilioPhoneNumber[],
  expected: ExpectedConfig,
  services: TwilioMessagingService[] = [],
): DriftReport {
  const deferringServices = buildDeferringServicesSet(services);

  const phoneReports: PhoneDriftReport[] = phones.map((p) => {
    const issues: DriftIssue[] = [];

    // Determine routing path. A phone is "routed via messaging_service"
    // when bound to a Service that doesn't defer to the number.
    const boundServiceSid = p.messaging_service_sid && p.messaging_service_sid.length > 0
      ? p.messaging_service_sid
      : null;
    const isRoutedViaService = boundServiceSid !== null && !deferringServices.has(boundServiceSid);

    // App-bound SMS: we never use TwiML Apps. Presence => drift.
    // This check runs REGARDLESS of Service binding — TwiML Apps are
    // an entirely different routing path that we never want to see.
    if (p.sms_application_sid && p.sms_application_sid.length > 0) {
      issues.push({
        field: "sms_application_sid_set",
        expected: "(none — we use direct URLs)",
        actual:   p.sms_application_sid,
        severity: "error",
      });
    } else if (!isRoutedViaService) {
      // Number-level webhook checks ONLY when the number is the
      // authoritative routing target. Otherwise the Service's
      // drift report is the source of truth.
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
      sid:                 p.sid,
      phoneNumber:         p.phone_number,
      friendlyName:        p.friendly_name || "",
      routedVia:           isRoutedViaService ? "messaging_service" : "number",
      messagingServiceSid: boundServiceSid || undefined,
      issues,
    };
  });

  // L1-D Phase 2.5: also check each Messaging Service's inbound webhook.
  const serviceReports = detectServiceDrift(services, expected);

  const allDrifted =
    phoneReports.filter((p) => p.issues.length > 0).length +
    serviceReports.filter((s) => s.issues.length > 0).length;
  const total = phoneReports.length + serviceReports.length;

  return {
    total,
    cleanCount:   total - allDrifted,
    driftedCount: allDrifted,
    phones:       phoneReports,
    services:     serviceReports,
    expected,
    generatedAt:  new Date().toISOString(),
  };
}

/** Compare each Messaging Service's inbound webhook config against
 * the expected canonical config. Pure function — no I/O. */
export function detectServiceDrift(
  services: TwilioMessagingService[],
  expected: ExpectedConfig,
): ServiceDriftReport[] {
  return services.map((svc) => {
    const issues: DriftIssue[] = [];
    const defers = svc.use_inbound_webhook_on_number === true;

    if (defers) {
      // Service is configured to defer routing to per-number webhooks.
      // The Service's own inbound_request_url is ignored at runtime.
      // We tag this as INFO (not error) — it's a valid configuration
      // choice. The number-level checks (in detectDrift) handle the
      // actual routing path.
      issues.push({
        field: "use_inbound_webhook_on_number_unexpected",
        expected: "false (Service is the authoritative router)",
        actual:   "true (defers to per-number webhooks)",
        severity: "info",
      });
    } else {
      // Service IS the authoritative router. Check inbound_request_url.
      const actualUrl = normalizeUrl(svc.inbound_request_url || "");
      const expectedUrl = normalizeUrl(expected.smsUrl);
      if (actualUrl !== expectedUrl) {
        issues.push({
          field: "inbound_request_url",
          expected: expected.smsUrl,
          actual:   svc.inbound_request_url || "(empty)",
          severity: "error",
        });
      }
      if ((svc.inbound_method || "").toUpperCase() !== expected.smsMethod) {
        issues.push({
          field: "inbound_method",
          expected: expected.smsMethod,
          actual:   svc.inbound_method || "(unset)",
          severity: "error",
        });
      }
    }

    return {
      sid:                svc.sid,
      friendlyName:       svc.friendly_name || "",
      defersToNumberLevel: defers,
      issues,
    };
  });
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
