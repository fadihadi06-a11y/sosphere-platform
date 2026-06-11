// Show a local OS notification SAFELY.
// On Service-Worker-controlled pages, `new Notification()` throws
// "Illegal constructor" and the OS notification silently never shows
// (Sentry: TypeError "Illegal constructor"). Prefer the SW's
// registration.showNotification() — clicks are handled by the
// notificationclick listener in public/sw.js — and only fall back to the
// legacy constructor when no Service Worker controls the page.
export async function showLocalNotification(
  title: string,
  options?: NotificationOptions,
): Promise<boolean> {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return false;
    if (Notification.permission !== "granted") return false;
    if ("serviceWorker" in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (reg && typeof reg.showNotification === "function") {
          await reg.showNotification(title, options);
          return true;
        }
      } catch { /* fall through to legacy constructor */ }
    }
    try { new Notification(title, options); return true; } catch { return false; }
  } catch {
    return false;
  }
}
