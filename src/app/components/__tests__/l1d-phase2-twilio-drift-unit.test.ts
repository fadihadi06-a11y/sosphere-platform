// ═══════════════════════════════════════════════════════════════
// SOSphere — L1-D Phase 2: detectDrift() behavior unit test
// ─────────────────────────────────────────────────────────────
// This is a TRUE unit test — not just a regex against source.
// Imports the pure detectDrift() function and runs it against
// real-shaped Twilio IncomingPhoneNumber payloads (drift,
// no-drift, app-bound, weird casing). If a future refactor
// breaks the comparison rules, the assertions here fail
// immediately — long before a deployed probe could mis-classify
// a live phone number.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import {
  detectDrift,
  detectServiceDrift,
  normalizeUrl,
  type TwilioPhoneNumber,
  type TwilioMessagingService,
  type ExpectedConfig,
} from "../../../../supabase/functions/_shared/twilio-config-drift";

const EXPECTED: ExpectedConfig = {
  smsUrl:    "https://rtfhkbskgrasamhjraul.functions.supabase.co/sos-sms-inbound",
  smsMethod: "POST",
  voiceUrl:  "https://rtfhkbskgrasamhjraul.functions.supabase.co/sos-bridge-twiml",
};

/** Build a Twilio phone number row with sensible defaults. Test
 * cases override only the field(s) under test. */
function phone(overrides: Partial<TwilioPhoneNumber> = {}): TwilioPhoneNumber {
  return {
    sid: "PN1234567890abcdef1234567890abcdef",
    phone_number: "+19999999999",
    friendly_name: "SOSphere test",
    sms_url:    EXPECTED.smsUrl,
    sms_method: "POST",
    voice_url:  EXPECTED.voiceUrl,
    voice_method: "POST",
    ...overrides,
  };
}

describe("L1-D Phase 2: detectDrift — clean configurations", () => {
  it("reports zero drift when every field matches", () => {
    const report = detectDrift([phone()], EXPECTED);
    expect(report.driftedCount).toBe(0);
    expect(report.cleanCount).toBe(1);
    expect(report.total).toBe(1);
    expect(report.phones[0].issues).toEqual([]);
  });

  it("treats lowercase sms_method 'post' as drift (Twilio returns uppercase)", () => {
    // Twilio's API actually returns 'POST' uppercase — but if a future
    // refactor of the comparison strips the case-insensitive guard, a
    // lowercase value should match. We allow both 'POST' and 'post'
    // because comparison is case-insensitive.
    const report = detectDrift([phone({ sms_method: "post" })], EXPECTED);
    expect(report.driftedCount).toBe(0);
  });

  it("normalizes trailing slash (cosmetic Twilio change is NOT drift)", () => {
    const report = detectDrift([phone({ sms_url: EXPECTED.smsUrl + "/" })], EXPECTED);
    expect(report.driftedCount).toBe(0);
  });

  it("normalizes default port :443 (cosmetic Twilio change is NOT drift)", () => {
    const withPort = EXPECTED.smsUrl.replace("supabase.co", "supabase.co:443");
    const report = detectDrift([phone({ sms_url: withPort })], EXPECTED);
    expect(report.driftedCount).toBe(0);
  });

  it("clean when voice_url is unset and expected.voiceUrl is undefined (SMS-only deployment)", () => {
    const smsOnlyExpected: ExpectedConfig = { smsUrl: EXPECTED.smsUrl, smsMethod: "POST" };
    const report = detectDrift(
      [phone({ voice_url: "", voice_method: "" })],
      smsOnlyExpected,
    );
    expect(report.driftedCount).toBe(0);
  });
});

describe("L1-D Phase 2: detectDrift — sms_url drift (the L2-F gap we hit)", () => {
  it("flags the exact failure mode that broke L2-F: empty sms_url", () => {
    const report = detectDrift([phone({ sms_url: "" })], EXPECTED);
    expect(report.driftedCount).toBe(1);
    const issue = report.phones[0].issues.find(i => i.field === "sms_url");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
    expect(issue!.actual).toBe("(empty)");
  });

  it("flags a stale URL pointing at the WRONG Supabase project", () => {
    const stale = "https://OTHERPROJECT.functions.supabase.co/sos-sms-inbound";
    const report = detectDrift([phone({ sms_url: stale })], EXPECTED);
    const issue = report.phones[0].issues.find(i => i.field === "sms_url");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
    expect(issue!.actual).toBe(stale);
  });

  it("flags a URL pointing at the wrong function name on the right project", () => {
    const wrongFn = EXPECTED.smsUrl.replace("sos-sms-inbound", "old-handler");
    const report = detectDrift([phone({ sms_url: wrongFn })], EXPECTED);
    expect(report.phones[0].issues.length).toBe(1);
    expect(report.phones[0].issues[0].field).toBe("sms_url");
  });
});

describe("L1-D Phase 2: detectDrift — method drift", () => {
  it("flags sms_method=GET (silently breaks signature validation)", () => {
    const report = detectDrift([phone({ sms_method: "GET" })], EXPECTED);
    const issue = report.phones[0].issues.find(i => i.field === "sms_method");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
    expect(issue!.actual).toBe("GET");
  });

  it("flags missing sms_method as (unset)", () => {
    const report = detectDrift([phone({ sms_method: undefined })], EXPECTED);
    const issue = report.phones[0].issues.find(i => i.field === "sms_method");
    expect(issue?.actual).toBe("(unset)");
  });
});

describe("L1-D Phase 2: detectDrift — TwiML-app binding (we never use)", () => {
  it("flags any sms_application_sid as drift, even if URL fields are clean", () => {
    const report = detectDrift(
      [phone({ sms_application_sid: "AP1234567890abcdef1234567890abcdef" })],
      EXPECTED,
    );
    expect(report.driftedCount).toBe(1);
    const issue = report.phones[0].issues.find(i => i.field === "sms_application_sid_set");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
  });

  it("when sms_application_sid is set, does NOT also flag sms_url (would be a misleading double-fault)", () => {
    const report = detectDrift(
      [phone({ sms_application_sid: "AP000", sms_url: "" })],
      EXPECTED,
    );
    // App-bound numbers have empty URL fields — we report ONLY the app
    // binding, not also "sms_url empty" (it's expected to be empty
    // when app-bound).
    const fields = report.phones[0].issues.map(i => i.field);
    expect(fields).toContain("sms_application_sid_set");
    expect(fields).not.toContain("sms_url");
    expect(fields).not.toContain("sms_method");
  });

  it("flags voice_application_sid as a WARNING (less critical than SMS-app binding)", () => {
    const report = detectDrift(
      [phone({ voice_application_sid: "AP_VOICE_BOUND" })],
      EXPECTED,
    );
    const issue = report.phones[0].issues.find(i => i.field === "voice_url");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warning");
    expect(issue!.actual).toContain("AP_VOICE_BOUND");
  });
});

describe("L1-D Phase 2: detectDrift — multi-phone reports", () => {
  it("aggregates cleanCount + driftedCount correctly across multiple numbers", () => {
    const report = detectDrift(
      [
        phone({ sid: "PN1" }),                                  // clean
        phone({ sid: "PN2", sms_url: "" }),                     // drift
        phone({ sid: "PN3" }),                                  // clean
        phone({ sid: "PN4", sms_method: "GET" }),               // drift
      ],
      EXPECTED,
    );
    expect(report.total).toBe(4);
    expect(report.cleanCount).toBe(2);
    expect(report.driftedCount).toBe(2);
    // Order is preserved so the dashboard can correlate by SID.
    expect(report.phones.map(p => p.sid)).toEqual(["PN1", "PN2", "PN3", "PN4"]);
  });

  it("empty phone list returns zero counts (no Twilio numbers on this account)", () => {
    const report = detectDrift([], EXPECTED);
    expect(report.total).toBe(0);
    expect(report.cleanCount).toBe(0);
    expect(report.driftedCount).toBe(0);
    expect(report.phones).toEqual([]);
  });
});

describe("L1-D Phase 2: normalizeUrl — edge cases", () => {
  it("preserves path case (function names are case-sensitive)", () => {
    // sos-sms-inbound vs SOS-SMS-INBOUND would be a real bug, not a cosmetic diff.
    const a = normalizeUrl("https://x.co/functions/v1/sos-sms-inbound");
    const b = normalizeUrl("https://x.co/functions/v1/SOS-SMS-INBOUND");
    expect(a).not.toBe(b);
  });

  it("lowercases the HOST (case in DNS is not significant)", () => {
    const a = normalizeUrl("https://X.CO/path");
    const b = normalizeUrl("https://x.co/path");
    expect(a).toBe(b);
  });

  it("sorts query parameters (param order is cosmetic)", () => {
    const a = normalizeUrl("https://x.co/p?b=2&a=1");
    const b = normalizeUrl("https://x.co/p?a=1&b=2");
    expect(a).toBe(b);
  });

  it("returns the trimmed input for malformed URLs (no crash)", () => {
    expect(normalizeUrl("  not a url  ")).toBe("not a url");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeUrl("")).toBe("");
  });
});

// =============================================================
// L1-D Phase 2.5: Messaging Services + routing-aware drift
// =============================================================

function service(overrides: Partial<TwilioMessagingService> = {}): TwilioMessagingService {
  return {
    sid: "MG583f833e58c2e8a3601c2a8e7c421606",
    friendly_name: "SOSphere",
    inbound_request_url: EXPECTED.smsUrl,
    inbound_method: "POST",
    fallback_url: "",
    fallback_method: "POST",
    use_inbound_webhook_on_number: false,
    ...overrides,
  };
}

describe("L1-D Phase 2.5: detectServiceDrift - clean", () => {
  it("zero drift when Service inbound_request_url matches expected", () => {
    const reports = detectServiceDrift([service()], EXPECTED);
    expect(reports).toHaveLength(1);
    expect(reports[0].issues).toEqual([]);
    expect(reports[0].defersToNumberLevel).toBe(false);
  });
});

describe("L1-D Phase 2.5: detectServiceDrift - service-side drift", () => {
  it("flags inbound_request_url drift (the L2-F gap shifted to Service-level)", () => {
    const reports = detectServiceDrift(
      [service({ inbound_request_url: "https://demo.twilio.com/welcome/sms/reply/" })],
      EXPECTED,
    );
    const issue = reports[0].issues.find(i => i.field === "inbound_request_url");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
    expect(issue!.actual).toBe("https://demo.twilio.com/welcome/sms/reply/");
  });

  it("flags empty inbound_request_url (Service exists but never configured)", () => {
    const reports = detectServiceDrift(
      [service({ inbound_request_url: "" })],
      EXPECTED,
    );
    const issue = reports[0].issues.find(i => i.field === "inbound_request_url");
    expect(issue?.actual).toBe("(empty)");
    expect(issue?.severity).toBe("error");
  });

  it("flags GET method (silently breaks signature validation just like phone-level)", () => {
    const reports = detectServiceDrift(
      [service({ inbound_method: "GET" })],
      EXPECTED,
    );
    const issue = reports[0].issues.find(i => i.field === "inbound_method");
    expect(issue?.actual).toBe("GET");
    expect(issue?.severity).toBe("error");
  });

  it("treats use_inbound_webhook_on_number=true as INFO (not error)", () => {
    const reports = detectServiceDrift(
      [service({ use_inbound_webhook_on_number: true, inbound_request_url: "anything" })],
      EXPECTED,
    );
    expect(reports[0].defersToNumberLevel).toBe(true);
    const issue = reports[0].issues[0];
    expect(issue.severity).toBe("info");
    expect(issue.field).toBe("use_inbound_webhook_on_number_unexpected");
  });
});

describe("L1-D Phase 2.5: detectDrift - routing-aware phone/service interaction", () => {
  it("phone bound to clean Service - routedVia messaging_service AND number-level drift suppressed", () => {
    const report = detectDrift(
      [phone({
        sms_url: "https://demo.twilio.com/welcome/sms/reply/",
        messaging_service_sid: "MG583f833e58c2e8a3601c2a8e7c421606",
      })],
      EXPECTED,
      [service()],
    );
    expect(report.phones[0].routedVia).toBe("messaging_service");
    expect(report.phones[0].messagingServiceSid).toBe("MG583f833e58c2e8a3601c2a8e7c421606");
    const fields = report.phones[0].issues.map(i => i.field);
    expect(fields).not.toContain("sms_url");
    expect(fields).not.toContain("sms_method");
  });

  it("phone bound to BROKEN Service - service drift surfaces, NOT phone-level (no double-report)", () => {
    const report = detectDrift(
      [phone({
        sms_url: "https://demo.twilio.com/welcome/sms/reply/",
        messaging_service_sid: "MG_BROKEN",
      })],
      EXPECTED,
      [service({
        sid: "MG_BROKEN",
        inbound_request_url: "https://demo.twilio.com/welcome/sms/reply/",
      })],
    );
    expect(report.services).toHaveLength(1);
    expect(report.services[0].issues.length).toBeGreaterThan(0);
    expect(report.phones[0].issues.find(i => i.field === "sms_url")).toBeUndefined();
    expect(report.driftedCount).toBe(1);
  });

  it("phone bound to defers-to-number Service - number-level check IS applied", () => {
    const report = detectDrift(
      [phone({
        sms_url: "https://demo.twilio.com/welcome/sms/reply/",
        messaging_service_sid: "MG_DEFERS",
      })],
      EXPECTED,
      [service({
        sid: "MG_DEFERS",
        use_inbound_webhook_on_number: true,
      })],
    );
    expect(report.phones[0].routedVia).toBe("number");
    expect(report.phones[0].issues.some(i => i.field === "sms_url")).toBe(true);
  });

  it("unbound phone (no Service) - unchanged Phase-2 behaviour", () => {
    const report = detectDrift(
      [phone({ sms_url: "" })],
      EXPECTED,
    );
    expect(report.phones[0].routedVia).toBe("number");
    expect(report.phones[0].issues.some(i => i.field === "sms_url")).toBe(true);
    expect(report.services).toEqual([]);
  });

  it("total + cleanCount + driftedCount aggregate phones AND services", () => {
    const report = detectDrift(
      [
        phone({ sid: "PN1" }),
        phone({ sid: "PN2", messaging_service_sid: "MG_OK" }),
      ],
      EXPECTED,
      [
        service({ sid: "MG_OK" }),
        service({ sid: "MG_BAD", inbound_request_url: "https://demo.x.com/" }),
      ],
    );
    expect(report.total).toBe(4);
    expect(report.driftedCount).toBe(1);
    expect(report.cleanCount).toBe(3);
  });
});
