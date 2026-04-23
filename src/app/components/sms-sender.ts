// ═══════════════════════════════════════════════════════════════
// SOSphere — Silent SMS Sender (2026-04-21)
// ───────────────────────────────────────────────────────────────
// One helper that every SOS path uses to deliver the emergency
// message. It tries 3 strategies in order and never silently
// claims success:
//
//   1. Native Android SmsManager via SOSphereNative bridge — TRULY
//      silent, no UI, works offline (uses carrier's SMS channel).
//      Requires SEND_SMS permission granted at runtime.
//
//   2. Twilio server-side send via Supabase Edge Function
//      (/functions/v1/sos-alert). Requires Twilio credentials set
//      in Supabase secrets. Works even if the user's SIM has no
//      credit — Twilio sends from a different number.
//
//   3. `sms:` URL scheme fallback — opens the device's Messages
//      app pre-filled with recipients + body. The user still has
//      to tap Send. Only used when the two silent paths both fail.
//
// The function returns a structured result so the caller (sos-
// emergency.tsx) can log the actual delivery status, not a lie.
// ═══════════════════════════════════════════════════════════════

export interface SOSMessageParts {
  userName: string;
  gpsCoords: { lat: number; lng: number } | null;
  gpsAccuracy?: number; // meters
  trigger: "hold_3s" | "shake_3x" | "voice" | "duress_pin" | "dms_auto";
  errId?: string;       // Emergency Response ID for cross-reference
  lang?: "en" | "ar";
}

export interface SendResult {
  /** Which strategy actually dispatched the message. */
  path: "native" | "twilio" | "sms_url" | "none";
  /** Recipients the message was accepted for (not necessarily delivered). */
  sent: string[];
  /** Recipients that failed at this layer. */
  failed: string[];
  /** Raw error reason when path === "none" or partial failure. */
  error?: string;
}

// ── Build the SOS message body ──────────────────────────────

/**
 * Canonical SOS message. Consistent across all triggers so responders
 * see the same structure every time and know it's from SOSphere.
 */
export function buildSOSMessage(p: SOSMessageParts): string {
  const isAr = p.lang === "ar";
  const mapsLink = p.gpsCoords
    ? `https://maps.google.com/?q=${p.gpsCoords.lat.toFixed(6)},${p.gpsCoords.lng.toFixed(6)}`
    : null;
  const time = new Date().toLocaleString(isAr ? "ar" : "en-US", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const triggerLabel = (() => {
    if (isAr) {
      switch (p.trigger) {
        case "hold_3s":   return "ضغطة مطوّلة";
        case "shake_3x":  return "هزّ الهاتف";
        case "voice":     return "أمر صوتي";
        case "duress_pin":return "رمز إنذار";
        case "dms_auto":  return "مؤقّت الاطمئنان";
      }
    } else {
      switch (p.trigger) {
        case "hold_3s":   return "Hold 3s";
        case "shake_3x":  return "Shake ×3";
        case "voice":     return "Voice trigger";
        case "duress_pin":return "Duress PIN";
        case "dms_auto":  return "Check-in timer expired";
      }
    }
    return p.trigger;
  })();

  if (isAr) {
    const lines = [
      `🚨 SOS — ${p.userName || "مستخدم SOSphere"}`,
      `أحتاج مساعدة عاجلة.`,
      mapsLink ? `الموقع: ${mapsLink}` : `الموقع: غير متاح`,
      p.gpsAccuracy ? `دقة: ±${Math.round(p.gpsAccuracy)}م` : "",
      `النوع: ${triggerLabel}`,
      `الوقت: ${time}`,
      p.errId ? `ID: ${p.errId}` : "",
      `— SOSphere`,
    ];
    return lines.filter(Boolean).join("\n");
  }
  const lines = [
    `🚨 SOS — ${p.userName || "SOSphere user"}`,
    `I need urgent help.`,
    mapsLink ? `Location: ${mapsLink}` : `Location: unavailable`,
    p.gpsAccuracy ? `Accuracy: ±${Math.round(p.gpsAccuracy)}m` : "",
    `Trigger: ${triggerLabel}`,
    `Time: ${time}`,
    p.errId ? `ID: ${p.errId}` : "",
    `— SOSphere`,
  ];
  return lines.filter(Boolean).join("\n");
}

// ── Normalise phone to E.164 ────────────────────────────────

function normalise(phone: string): string {
  let s = String(phone || "").replace(/[\s\-()]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  return s;
}

// ── Strategy 1: Native Android SmsManager ───────────────────

async function trySendNative(recipients: string[], body: string): Promise<SendResult> {
  const w = window as unknown as {
    SOSphereNative?: {
      sendSMSSilent?: (recipientsCsv: string, message: string) => string;
    };
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  if (!w.Capacitor?.isNativePlatform?.()) {
    return { path: "none", sent: [], failed: recipients, error: "not_native" };
  }
  if (!w.SOSphereNative?.sendSMSSilent) {
    return { path: "none", sent: [], failed: recipients, error: "bridge_unavailable" };
  }
  try {
    const result = w.SOSphereNative.sendSMSSilent(recipients.join(","), body);
    // Expected format: "OK:sent/total" or "ERR:reason"
    if (result && result.startsWith("OK:")) {
      const match = result.match(/^OK:(\d+)\/(\d+)/);
      const sentCount = match ? parseInt(match[1], 10) : recipients.length;
      return {
        path: "native",
        sent: recipients.slice(0, sentCount),
        failed: recipients.slice(sentCount),
      };
    }
    return {
      path: "none",
      sent: [],
      failed: recipients,
      error: result || "unknown_native_error",
    };
  } catch (e) {
    return {
      path: "none",
      sent: [],
      failed: recipients,
      error: String((e as Error)?.message || e),
    };
  }
}

// ── Strategy 2: Twilio via Supabase edge function ───────────

async function trySendTwilio(
  recipients: string[],
  body: string,
  supabaseUrl: string,
  authHeader?: string,
): Promise<SendResult> {
  if (!supabaseUrl) {
    return { path: "none", sent: [], failed: recipients, error: "supabase_url_missing" };
  }
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/twilio-sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({ recipients, message: body }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return {
        path: "none",
        sent: [],
        failed: recipients,
        error: `twilio_${res.status}:${txt.slice(0, 120)}`,
      };
    }
    const json = await res.json().catch(() => ({}));
    const accepted: string[] = Array.isArray(json?.sent) ? json.sent : recipients;
    const rejected: string[] = Array.isArray(json?.failed) ? json.failed : [];
    return { path: "twilio", sent: accepted, failed: rejected };
  } catch (e) {
    return {
      path: "none",
      sent: [],
      failed: recipients,
      error: String((e as Error)?.message || e),
    };
  }
}

// ── Strategy 3: sms: URL fallback (opens Messages app) ──────

function openSmsUrl(recipients: string[], body: string): SendResult {
  try {
    const to = recipients.join(",");
    const href = `sms:${to}?body=${encodeURIComponent(body)}`;
    window.location.href = href;
    return { path: "sms_url", sent: recipients, failed: [] };
  } catch (e) {
    return {
      path: "none",
      sent: [],
      failed: recipients,
      error: String((e as Error)?.message || e),
    };
  }
}

// ── Public API — the only function callers should use ──────

export interface SendOptions {
  recipients: string[];                 // E.164 numbers
  parts: SOSMessageParts;
  supabaseUrl?: string;                 // for Twilio fallback
  supabaseAuthHeader?: string;          // Bearer token if required
  /**
   * If true, DO NOT fall back to `sms:` URL (which opens the
   * Messages app UI). Use this for Shake ×3 / covert flows
   * where the victim cannot interact with the screen. Default: false.
   */
  strictSilent?: boolean;
}

export async function sendSOSMessage(opts: SendOptions): Promise<SendResult> {
  const { parts, supabaseUrl, supabaseAuthHeader, strictSilent } = opts;
  const recipients = opts.recipients
    .map(normalise)
    .filter(r => r.length >= 8);
  if (recipients.length === 0) {
    return { path: "none", sent: [], failed: [], error: "no_valid_recipients" };
  }
  const body = buildSOSMessage(parts);

  // Try native silent first
  const nativeResult = await trySendNative(recipients, body);
  if (nativeResult.path === "native" && nativeResult.sent.length > 0) {
    return nativeResult;
  }

  // Then Twilio (server-side)
  if (supabaseUrl) {
    const twilioResult = await trySendTwilio(recipients, body, supabaseUrl, supabaseAuthHeader);
    if (twilioResult.path === "twilio" && twilioResult.sent.length > 0) {
      return twilioResult;
    }
  }

  // Last resort: sms: URL (user must tap Send) — skipped in strictSilent mode
  if (!strictSilent) {
    return openSmsUrl(recipients, body);
  }

  return {
    path: "none",
    sent: [],
    failed: recipients,
    error: `all_silent_paths_failed: native=${nativeResult.error || "?"}`,
  };
}
