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

    // Foundation note (2026-04-28): `firebase` is an OPTIONAL runtime dep —
    // intentionally NOT in package.json. The isFCMConfigured() early-exit
    // above (lines 45-48) guarantees these imports only execute when the
    // operator has explicitly:
    //   1. Set VITE_FIREBASE_* env vars on Vercel, AND
    //   2. Run `npm install firebase` (post-deploy customisation step)
    // If env vars are set without the npm install, the outer try/catch
    // (line 100) gracefully falls back to web push. Vercel can therefore
    // build the project without firebase being present in node_modules.
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
    // Wave1/T1.1 live-test (2026-04-29): improved error logging.
    // Before this, the catch printed `{}` because the error object's
    // own enumerable properties were empty. Use direct property
    // access to capture the actual Error fields so the next failure
    // is debuggable at a glance.
    const e = err as { name?: string; code?: string; message?: string; stack?: string };
    console.warn(
      "[FCM] Initialization failed:",
      e?.name || "(no name)",
      "/",
      e?.code || "(no code)",
      "/",
      e?.message || String(err) || "(empty error)",
    );
    if (e?.stack) console.warn("[FCM] stack:", e.stack.split("\n").slice(0, 5).join("\n"));
    return null;
  }
}

/**
 * Save FCM token to Supabase for server-side push targeting.
 * S-M3: refuses to save with a missing userId. Previously we
 * fell back to "anonymous", which pooled unrelated devices
 * under the same key and allowed a malicious/buggy caller to
 * register a token to nobody in particular. An anonymous row
 * also bypasses per-user RLS on push_tokens.
 *
 * Callers that don't yet have a userId should defer this call
 * until after sign-in completes.
 */
async function saveFCMToken(token: string, userId?: string): Promise<void> {
  if (!userId || typeof userId !== "string" || userId.length < 8) {
    console.warn("[FCM] S-M3: refusing to save token without a valid userId");
    return;
  }
  try {
    // BLOCKER #19 (2026-04-29): explicitly write `is_active: true`. The
    // server-side push dispatcher (send-push-notification) filters with
    // `.eq("is_active", true)`, and is also responsible for flipping
    // tokens to `false` when FCM returns UNREGISTERED. So a user who
    // re-installs the app and re-registers MUST come back to `true` —
    // we cannot rely on the column default for that revival.
    await supabase.from("push_tokens").upsert(
      {
        token,
        user_id: userId,
        platform: detectPlatform(),
        is_active: true,
        updated_at: new Date().toISOS