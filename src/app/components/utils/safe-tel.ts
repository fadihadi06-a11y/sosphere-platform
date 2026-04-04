// ═══════════════════════════════════════════════════════════════
// SOSphere — Safe tel: Link Handler
// ─────────────────────────────────────────────────────────────
// In web browser context, tel: links don't work.
// This helper detects mobile vs desktop and shows a toast
// with the phone number on desktop instead.
// ═══════════════════════════════════════════════════════════════

import { toast } from "sonner";

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Attempt to open a tel: link. On desktop, show a toast with the number instead.
 * @param phone - Phone number string (will be cleaned of whitespace)
 * @param label - Optional label for the toast (e.g., employee name)
 */
export function safeTelCall(phone: string, label?: string): void {
  const cleaned = phone.replace(/[\s\-\(\)]/g, "");
  if (isMobileDevice()) {
    window.open(`tel:${cleaned}`);
  } else {
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
}
