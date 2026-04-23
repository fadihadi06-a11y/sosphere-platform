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
 * Attempt to dial a phone number safely.
 *  - Native Capacitor: uses CallNumber plugin (no app chooser).
 *  - Mobile web: tel: URI (browser-dispatched).
 *  - Desktop: toast with Copy action.
 *
 * @param phone - Phone number string (will be cleaned of whitespace / brackets)
 * @param label - Optional label for the toast (e.g., employee name)
 */
export async function safeTelCall(phone: string, label?: string): Promise<void> {
  const cleaned = phone.replace(/[\s\-\(\)]/g, "");
  if (!cleaned) return;

  // Tier 1: Capacitor native — use CallNumber plugin (no chooser)
  if (isCapacitorNative()) {
    try {
      const { CallNumber } = await import("capacitor-call-number");
      await CallNumber.call({ number: cleaned, bypassAppChooser: true });
      return;
    } catch (err) {
      console.warn("[safeTelCall] CallNumber plugin failed:", err);
      // fall through to toast — do NOT fall back to tel: URI on native
      // (that would surface the OS app chooser which is what we're avoiding)
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
