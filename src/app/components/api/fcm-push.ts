// ═══════════════════════════════════════════════════════════════
// SOSphere — Web Push Notifications (Native, no Firebase)
// ─────────────────────────────────────────────────────────────
// PIVOT (2026-04-30): replaced Firebase Cloud Messaging with the
// native Web Push API (W3C standard, RFC 8030 / RFC 8291). FCM was
// rejecting our API key with 401 UNAUTHENTICATED on the FCM
// Registration API V1 endpoint despite all visible Cloud Console
// settings being correct (API restriction allows FCM Registration,
// Application restrictions = None, key value matches, FCM API
// enabled). Root cause was opaque (likely Google-side propagation
// or OAuth consent screen requirement). Rather than burning more
// hours, we pivoted to the underlying standard.
//
// Why Web Push is the right choice for SOSphere:
//   • W3C standard built into all modern browsers (Chrome, Firefox,
//     Edge, Safari 16.4+) — no third-party SDK required.
//   • Same VAPID key we already had (push services accept VAPID
//     directly; FCM was just one wrapper around it).
//   • FREE — push services are operated by browser vendors at no
//     per-message cost.
//   • Background delivery + action buttons + badges all supported.
//   • Removes Firebase dependency entirely from the web bundle.
//
// File name kept as `fcm-push.ts` to avoid breaking import paths
// across the codebase. The export surface (`initFCM`, `getFCMToken`,
// `isFCMConfigured`) is preserved so call sites don't change. Each
// function is now backed by Web Push under the hood.
//
// Storage shape: we save the entire PushSubscription as a JSON
// string into push_tokens.token. The endpoint URL inside the JSON
// uniquely identifies the device (replaces the FCM token's role).
// The send-push-notification edge function parses the JSON to get
// endpoint + p256dh + auth and signs a Web Push request with the
// same VAPID private key that FCM was using.
// ═══════════════════════════════════════════════════════════════

import { supabase, SUPABASE_CONFIG } from "./supabase-client";

// VAPID public key — the SAME one we used for FCM. Push services
// (Mozilla, Google, Apple) accept VAPID-signed requests directly.
const VAPID_PUBLIC_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || "";

let _subscriptionJson: string | null = null;
let _initialized = false;

/**
 * Check if Web Push is configured. Only requires the VAPID public
 * key — no Firebase project setup.
 */
export function isFCMConfigured(): boolean {
  return !!VAPID_PUBLIC_KEY;
}

/**
 * Initialize Web Push and store the subscription on the server.
 * Call after the user signs in (we need their userId to scope the
 * push_tokens row correctly).
 *
 * Returns the JSON-stringified PushSubscription on success, null
 * on any failure. Failures are NEVER thrown — they're logged and
 * swallowed so the caller (auth listener) doesn't break sign-in.
 */
export async function initFCM(userId?: string): Promise<string | null> {
  if (_initialized && _subscriptionJson) return _subscriptionJson;
  if (!isFCMConfigured()) {
    console.info("[WebPush] VAPID key not configured — push disabled.");
    return null;
  }

  try {
    // ─── Pre-flight: browser support ──────────────────────────
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      console.info("[WebPush] Browser missing serviceWorker / PushManager / Notification APIs.");
      return null;
    }

    // ─── Permission gate (must be 'granted' before subscribing) ───
    const perm =
      Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
    if (perm !== "granted") {
      console.info("[WebPush] Notification permission not granted:", perm);
      return null;
    }

    // ─── Use the existing /sw.js registration ─────────────────
    // Unlike FCM (which required its OWN service worker file at a
    // fixed scope), native Web Push works with any registered SW
    // that listens for `push` events. /sw.js already has a
    // complete `push` handler (see public/sw.js around line 138)
    // so we just reuse the app shell SW.
    const registration = await navigator.serviceWorker.ready;
    if (!registration) {
      console.warn("[WebPush] No active service worker registration.");
      return null;
    }

    // ─── Subscribe (or reuse existing subscription) ────────────
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    // The `toJSON()` form is the canonical representation: it has
    // `endpoint` plus `keys: { p256dh, auth }`. We serialise the
    // whole object so the edge function can parse and reuse it
    // exactly without losing any information.
    _subscriptionJson = JSON.stringify(subscription.toJSON());

    console.info("[WebPush] Subscription obtained for endpoint:",
      subscription.endpoint.substring(0, 60) + "...");

    // ─── Persist to Supabase for server-side targeting ────────
    if (SUPABASE_CONFIG.isConfigured) {
      await saveSubscription(_subscriptionJson, userId);
    }

    _initialized = true;
    return _subscriptionJson;
  } catch (err) {
    const e = err as { name?: string; code?: string; message?: string; stack?: string };
    console.warn(
      "[WebPush] Initialization failed:",
      e?.name || "(no name)",
      "/",
      e?.code || "(no code)",
      "/",
      e?.message || String(err) || "(empty error)",
    );
    if (e?.stack) console.warn("[WebPush] stack:", e.stack.split("\n").slice(0, 5).join("\n"));
    return null;
  }
}

/**
 * Save the PushSubscription JSON to Supabase for server-side push
 * targeting. Same S-M3 guard as before: refuses to save without a
 * valid userId so we don't pool unrelated devices anonymously.
 *
 * The PushSubscription's endpoint URL is the unique key (a single
 * device can only have one active subscription per origin), so we
 * use it via onConflict to update the row instead of creating a
 * duplicate when the user re-installs / re-subscribes.
 */
async function saveSubscription(subscriptionJson: string, userId?: string): Promise<void> {
  if (!userId || typeof userId !== "string" || userId.length < 8) {
    console.warn("[WebPush] S-M3: refusing to save subscription without a valid userId");
    return;
  }
  try {
    await supabase.from("push_tokens").upsert(
      {
        token: subscriptionJson,
        user_id: userId,
        platform: detectPlatform(),
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );
    console.log("[WebPush] Subscription saved to Supabase for user", userId);
  } catch (e) {
    console.warn("[WebPush] Failed to save subscription:", e);
  }
}

/**
 * Get the current PushSubscription JSON (null if not initialized).
 * Kept for compatibility with old callers that named it "FCM token";
 * the value is now a JSON-stringified PushSubscription.
 */
export function getFCMToken(): string | null {
  return _subscriptionJson;
}

/**
 * Detect platform for token registration metadata.
 */
function detectPlatform(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (/android/.test(ua)) return "android";
  if (/iphone|ipad/.test(ua)) return "ios";
  if (/mobile/.test(ua)) return "mobile-web";
  return "desktop-web";
}

/**
 * Convert a base64url-encoded VAPID public key into a Uint8Array
 * for PushManager.subscribe(). This is required because the spec
 * mandates an ArrayBuffer / Uint8Array, not a string.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");