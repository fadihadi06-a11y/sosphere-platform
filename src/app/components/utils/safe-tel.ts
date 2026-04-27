// ═══════════════════════════════════════════════════════════════
// SOSphere — Safe tel: Link Handler (2026-04-23 hardened)
// ─────────────────────────────────────────────────────────────
// Three-tier strategy:
//  1. Native Capacitor shell  → capacitor-call-number plugin (ACTION_CALL,
//                                bypasses the OS app chooser — no Zoom /
//                                WhatsApp / Truecaller popup).
//  2. Mobile web browser      → tel: URI (opens user's dialer directly on
//                                mobile browsers; no chooser since the
//                                browser handles it).
//  3. Desktop                 → toast with the number + Copy button.
//
// CRIT-#2 (2026-04-27): on native, if the CallNumber plugin throws (plugin
// not installed, runtime error, etc.) AND the number is an emergency-services
// short code (911 / 112 / 999 / 997 / 998 / 122 / 140 / 000 / etc.), we now
// fall back to a tel: URI as the absolute last resort. The OS app chooser
// is annoying — but it is FAR better than silently failing to dial the
// emergency number. For non-emergency contacts the original refuse-and-toast
// behaviour is preserved (no surprise chooser during a regular dial).
// ═══════════════════════════════════════════════════════════════

import { toast } from "sonner";

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function isCapacitorNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

/**
 * CRIT-#2: detect emergency-services short codes.
 *
 * Worldwide emergency numbers are always 3 or 4 digits with no plus / spaces:
 *  - 3-digit: 911 (US/CA/JO), 112 (EU/KW/most), 999 (UK/QA/BH), 997 (SA),
 *             998 (AE), 122 (IQ), 123 (EG), 140 (LB), 100 (IN), 119 (KR), …
 *  - 4-digit: 9999 (OM), 1000 (some), …
 *  - Edge:    000 (AU)
 *
 * Heuristic: 3-4 numeric digits. Catches every official emergency number
 * we know about and accepts no false positives that matter (a regular
 * personal contact is always 8+ digits in E.164 form).
 */
export function isEmergencyShortCode(cleaned: string): boolean {
  return /^\d{3,4}$/.test(cleaned);
}

export interface SafeTelOptions {
  /**
   * CRIT-#2: force tel: fallback on native when the CallNumber plugin
   * fails. Use this for life-critical dials (911 / dispatcher SOS bridge)
   * even when the OS app chooser may briefly appear. Defaults to `true`
   * automatically when the number looks like an emergency short code.
   */
  allowTelFallbackOnNative?: boolean;
}

/**
 * Attempt to dial a phone number safely.
 *  - Native Capacitor: uses CallNumber plugin (no app chooser).
 *  - Mobile web: tel: URI (browser-dispatched).
 *  - Desktop: toast with Copy action.
 *
 * @param phone - Phone number string (will be cleaned of whitespace / brackets)
 * @param label - Optional label for the toast (e.g., employee name)
 * @param opts  - Optional behaviour overrides (see SafeTelOptions)
 */
export async function safeTelCall(
  phone: string,
  label?: string,
  opts?: SafeTelOptions,
): Promise<void> {
  const cleaned = phone.replace(/[\s\-\(\)]/g, "");
  if (!cleaned) return;

  // CRIT-#2: emergency short codes auto-opt-in to tel: fallback. Callers
  // can also pass allowTelFallbackOnNative explicitly for non-short-code
  // life-critical numbers (rare).
  const allowFallback = opts?.allowTelFallbackOnNative ?? isEmergencyShortCode(cleaned);

  // Tier 1: Capacitor native — use CallNumber plugin (no chooser)
  if (isCapacitorNative()) {
    try {
      const { CallNumber } = await import("capacitor-call-number");
      await CallNumber.call({ number: cleaned, bypassAppChooser: true });
      return;
    } catch (err) {
      console.warn("[safeTelCall] CallNumber plugin failed:", err);
      // CRIT-#2: For emergency-services / explicit-allow, fall back to tel:
      // even though the OS chooser may appear briefly. Life > UX.
      if (allowFallback) {
        try {
          window.location.href = `tel:${cleaned}`;
          console.warn(
            "[safeTelCall] using tel: fallback (chooser may appear) — emergency dial:",
            cleaned,
          );
          return;
        } catch (telErr) {
          console.error("[safeTelCall] tel: fallback also failed:", telErr);
        }
      }
      // Last-resort: surface the failure to the user (regular contacts only).
      toast.error(`Cannot call ${phone} — try dialing manually`);
      return;
    }
  }

  // Tier 2: Mobile web browser
  if (isMobileDevice()) {
    window.open(`tel:${cleaned}`);
    return;
  }

  // Tier 3: Desktop — show toast with Copy
  toast(`Call: ${phone}${label ? ` (${label})` : ""}`, {
    description: "Tap on mobile to dial — or copy the number",
    duration: 5000,
    action: {
      label: "Copy",
      onClick: () => {
        navigator.clipboard.writeText(cleaned).catch(() => {});
        toast.success("Number copied to clipboard");
      },
    },
  });
}
