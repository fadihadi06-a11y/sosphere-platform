// ═══════════════════════════════════════════════════════════════
// SOSphere — Firebase Cloud Messaging Service Worker (Web Push)
// ─────────────────────────────────────────────────────────────
// REQUIRED by firebase/messaging.getToken() — without this file
// at the exact path /firebase-messaging-sw.js the FCM web push
// stack fails with an opaque error and no notifications are
// delivered when the page is in the background.
//
// This SW is intentionally separate from /sw.js (the app's own
// service worker for offline / caching). FCM strictly requires
// its OWN SW at this exact filename.
//
// Hardcoded config: env vars are not available inside service
// workers, so we duplicate the public Firebase web config here.
// All values below are PUBLIC (apiKey is restricted by Firebase
// security rules + HTTP referrer restrictions, not secret).
// ═══════════════════════════════════════════════════════════════

importScripts("https://www.gstatic.com/firebasejs/12.12.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.12.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDk63abLr8SMGV0kNgc3UYg3bB0f54kcpI",
  authDomain: "sosphere-809bb.firebaseapp.com",
  projectId: "sosphere-809bb",
  storageBucket: "sosphere-809bb.firebasestorage.app",
  messagingSenderId: "143943152533",
  appId: "1:143943152533:web:04de9a7a531c7f99b4fc9c",
});

// Wave1/T1.1 ROOT-CAUSE FIX (2026-04-30): in Firebase v12 compat,
// calling firebase.messaging() at top level throws synchronously
// inside SW context because the constructor eagerly runs an
// isSupported() probe that touches APIs not implemented in SW.
// The opaque "ServiceWorker script evaluation failed" was that
// throw bubbling up. Fix: gate via the static isSupported() first.
// See: github.com/firebase/firebase-js-sdk/issues/5347
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

firebase.messaging.isSupported().then((ok) => {
  if (!ok) {
    console.warn("[firebase-messaging-sw] messaging not supported in this SW context");
    return;
  }
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload.notification?.title || "SOSphere Alert";
  const notificationOptions = {
    body: payload.notification?.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: payload.data || {},
    tag: payload.data?.kind || "sosphere",
    requireInteraction: payload.data?.kind === "sos_self_confirm",
  };
    self.registration.showNotification(notificationTitle, notificationOptions);
  });
});

// On click → focus app or open it.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.deep_link || "/dashboard";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(self.location.origin)) {
          w.focus();
          return w.navigate(url);
        }
      }
      return clients.openWindow(url);
    }),
  );
});
