// ═══════════════════════════════════════════════════════════════
// SOSphere — Firebase Cloud Messaging (Push Notifications)
// ─────────────────────────────────────────────────────────────
// Registers for push notifications and stores the FCM token
// in Supabase so the server can send targeted pushes.
//
// Setup (one-time):
//   1. Create Firebase project at console.firebase.google.com
//   2. Enable Cloud Messaging
//   3. Get the VAPID key from Project Settings → Cloud Messaging
//   4. Set VITE_FIREBASE_* env variables
//
// Cost: FREE — Firebase Cloud Messaging has no per-message cost.
// ═══════════════════════════════════════════════════════════════

import { supabase, SUPABASE_CONFIG } from "./supabase-client";

// Firebase config from environment variables
const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
};

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || "";

let _fcmToken: string | null = null;
let _initialized = false;

/**
 * Check if Firebase is configured
 */
export function isFCMConfigured(): boolean {
  return !!(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId && VAPID_KEY);
}

/**
 * Initialize FCM and get push token.
 * Call this after user logs in.
 */
export async function initFCM(userId?: string): Promise<string | null> {
  if (_initialized && _fcmToken) return _fcmToken;
  if (!isFCMConfigured()) {
    console.info("[FCM] Not configured — using Web Push only.");
    return null;
  }

  try {
    // Register service worker if not already
    const registration = await navigator.serviceWorker.ready;

    // Dynamic import Firebase (avoids loading if not configured)
    const { initializeApp } = await import("firebase/app");
    const { getMessaging, getToken, onMessage } = await import("firebase/messaging");

    const app = initializeApp(FIREBASE_CONFIG);
    const messaging = getMessaging(app);

    // Get FCM token
    _fcmToken = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (_fcmToken) {
      console.info("[FCM] Token obtained:", _fcmToken.substring(0, 20) + "...");

      // Store token in Supabase for server-side push
      if (SUPABASE_CONFIG.isConfigured) {
        await saveFCMToken(_fcmToken, userId);
      }

      // Tell the service worker
      registration.active?.postMessage({
        type: "FCM_TOKEN",
        token: _fcmToken,
      });

      // Handle foreground messages
      onMessage(messaging, (payload) => {
        console.log("[FCM] Foreground message received");

        // Dispatch custom event for the app to handle
        window.dispatchEvent(
          new CustomEvent("sosphere-push", {
            detail: {
              title: payload.notification?.title || "SOSphere Alert",
              body: payload.notification?.body || "",
              data: payload.data || {},
            },
          }),
        );
      });
    }

    _initialized = true;
    return _fcmToken;
  } catch (err) {
    console.warn("[FCM] Initialization failed:", err);
    return null;
  }
}

/**
 * Save FCM token to Supabase for server-side push targeting.
 */
async function saveFCMToken(token: string, userId?: string): Promise<void> {
  try {
    await supabase.from("push_tokens").upsert(
      {
        token,
        user_id: userId || "anonymous",
        platform: detectPlatform(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );
    console.log("[FCM] Token saved to Supabase");
  } catch (e) {
    console.warn("[FCM] Failed to save token:", e);
  }
}

/**
 * Get the current FCM token (null if not initialized).
 */
export function getFCMToken(): string | null {
  return _fcmToken;
}

/**
 * Detect platform for token registration.
 */
function detectPlatform(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (/android/.test(ua)) return "android";
  if (/iphone|ipad/.test(ua)) return "ios";
  if (/mobile/.test(ua)) return "mobile-web";
  return "desktop-web";
}
