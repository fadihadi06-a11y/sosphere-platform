// ═══════════════════════════════════════════════════════════════════════════
// R-53 (MOBILE_AUDIT_FINDINGS, 2026-05-19) — Native Push registration
// ─────────────────────────────────────────────────────────────────────────
// MOBILE_AUDIT_FINDINGS #R-53 root cause: @capacitor/push-notifications was
// listed in package.json but `PushNotifications.register()` was never
// called anywhere in the codebase. The 2026-04-30 pivot to Web Push API
// solved the web/dashboard path but broke the native Android path —
// service workers in Capacitor WebView do NOT receive push events when
// the app is force-closed or killed by Doze mode. Owner phones with the
// app in background = ZERO SOS alerts.
//
// This module fixes that:
//   • On native Android (Capacitor.isNativePlatform()): requests OS
//     permission, registers with FCM, listens for the FCM registration
//     token, persists it to push_tokens with platform='android'.
//   • Listens for pushNotificationActionPerformed → wires into deep-link
//     handler so a tap on the SOS notification opens the right screen.
//   • Listens for pushNotificationReceived → optional foreground hook
//     (Android shows nothing by default for foreground push; we surface
//     a toast so the admin still notices).
//
// Companion: R-54 dual-path send-push-notification edge function which
// reads push_tokens, detects platform, and routes Web Push subscriptions
// through the existing W3C path while routing native FCM tokens through
// FCM HTTP v1 with the Service Account JWT (R-55).
//
// Lazy imports + isNativePlatform guards mean this is safe to call from
// any code path on web — it short-circuits with a single info log.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from "./supabase-client";

// Module-level guards: initialization is idempotent across cold-start +
// post-login flows that both call initNativePush().
let _initialized = false;
let _registrationToken: string | null = null;
let _lastSavedForUserId: string | null = null;

type DeepLinkHandler = (path: string, data: Record<string, unknown>) => void;
let _deepLinkHandler: DeepLinkHandler | null = null;

/**
 * Register a callback that fires when the user taps a push notification.
 * Called once at app boot from mobile-app.tsx. The handler receives the
 * notification's deep-link path (e.g. "/sos/abc-123") and the full data
 * payload so it can route to the correct screen.
 */
export function setNativePushDeepLinkHandler(fn: DeepLinkHandler): void {
  _deepLinkHandler = fn;
}

/**
 * Check whether the runtime is a Capacitor native shell.
 * Cached lookup so call sites can be cheap.
 */
async function isNative(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Initialize native push notifications. Idempotent across multiple
 * cold-start + auth-listener invocations.
 *
 * @param userId — required. The registration token is stored in
 *   push_tokens scoped to this user so we don't pool unrelated devices.
 * @returns the FCM registration token on success, null on any failure.
 *   Failures are NEVER thrown — caller is auth listener / mount handler
 *   and must not break.
 */
export async function initNativePush(userId?: string): Promise<string | null> {
  if (_initialized && _registrationToken && _lastSavedForUserId === userId) {
    return _registrationToken;
  }

  if (!userId || typeof userId !== "string" || userId.length < 8) {
    console.warn("[NativePush] refusing to init without valid userId");
    return null;
  }

  if (!(await isNative())) {
    console.info("[NativePush] not a native runtime — skipping");
    return null;
  }

  try {
    const mod: any = await import("@capacitor/push-notifications").catch(() => null);
    if (!mod?.PushNotifications) {
      console.warn("[NativePush] @capacitor/push-notifications plugin not loadable");
      return null;
    }
    const PN = mod.PushNotifications;

    // ── Permission ─────────────────────────────────────────────────────
    // On Android 13+ POST_NOTIFICATIONS is a runtime permission.
    // The plugin abstracts this — requestPermissions() returns the
    // unified status. On Android <13 it returns granted unconditionally.
    let perm = await PN.checkPermissions().catch(() => ({ receive: "prompt" as const }));
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await PN.requestPermissions();
    }
    if (perm.receive !== "granted") {
      console.warn(`[NativePush] permission ${perm.receive} — cannot register`);
      return null;
    }

    // ── Register listeners BEFORE calling register() ───────────────────
    // The plugin docs are explicit: listeners must be attached first or
    // the registration event may fire before we're listening for it.
    // We do this in initOnce() (below) so re-init doesn't pile listeners.
    if (!_initialized) {
      await initListenersOnce(PN);
      _initialized = true;
    }

    // Persist userId for the registration callback's saveToken closure.
    _lastSavedForUserId = userId;

    // ── Trigger FCM registration ───────────────────────────────────────
    // This is async and resolves immediately — the actual token arrives
    // via the 'registration' event we just wired up.
    await PN.register();
    console.info("[NativePush] register() dispatched — awaiting token via event");

    // Return whatever we have now (may be null on first call before
    // the registration event fires; the saveToken side-effect will
    // upsert to push_tokens as soon as the event arrives).
    return _registrationToken;
  } catch (err) {
    console.warn("[NativePush] init threw:", err);
    return null;
  }
}

/**
 * Wire all PushNotifications listeners exactly once. Subsequent init
 * calls just re-trigger register() — listeners persist for the app
 * lifetime.
 */
async function initListenersOnce(PN: any): Promise<void> {
  // ─── registration: token delivery ────────────────────────────────────
  PN.addListener("registration", async (token: { value: string }) => {
    _registrationToken = token.value;
    console.info(`[NativePush] received FCM token (len=${token.value.length})`);
    // saveToken uses the cached _lastSavedForUserId because the event
    // fires asynchronously — closure capture won't help.
    if (_lastSavedForUserId) {
      await saveTokenToSupabase(token.value, _lastSavedForUserId);
    } else {
      console.warn("[NativePush] token arrived but no userId cached — will retry on next init");
    }
  });

  // ─── registrationError: token delivery failed ────────────────────────
  PN.addListener("registrationError", (err: { error: string }) => {
    console.warn("[NativePush] FCM registration error:", err?.error);
    // Common causes (from Firebase docs):
    //   • google-services.json missing → fixed in R-53 setup
    //   • Google Play Services not installed on device → user issue
    //   • Network failure → will retry on next app launch automatically
  });

  // ─── pushNotificationReceived: foreground delivery ───────────────────
  // Android does NOT show a system notification for foreground push by
  // default — the data lands here and we choose what to do. For SOS
  // alerts we surface a toast so the admin notices even with the app open.
  PN.addListener("pushNotificationReceived", (notif: any) => {
    console.info("[NativePush] foreground push:", notif?.data?.type || "generic");
    // The toast layer (sonner) is web-side — import lazily to avoid
    // pulling the dependency graph into this api module.
    try {
      import("sonner").then(({ toast }) => {
        const title = notif?.title || notif?.data?.title || "Notification";
        const body = notif?.body || notif?.data?.body || "";
        toast(title, { description: body, duration: 8000 });
      }).catch(() => { /* sonner not available in this context */ });
    } catch { /* swallow */ }
  });

  // ─── pushNotificationActionPerformed: tap-to-open ────────────────────
  // This fires when the user taps the notification (either from the
  // tray, lock screen, or system notification banner). The data payload
  // is what the FCM HTTP v1 send put in `data` — we use a `path` field
  // by convention.
  PN.addListener("pushNotificationActionPerformed", (action: any) => {
    const data = action?.notification?.data || {};
    const path = (data.path || data.deep_link || "/") as string;
    console.info(`[NativePush] notification tapped → path=${path}`);
    if (_deepLinkHandler) {
      try { _deepLinkHandler(path, data); }
      catch (e) { console.warn("[NativePush] deep-link handler threw:", e); }
    } else {
      console.warn("[NativePush] no deep-link handler registered — tap ignored");
    }
  });
}

/**
 * Upsert the FCM registration token into push_tokens with
 * platform='android'. Uses the same composite unique constraint
 * (user_id, token) that fcm-push.ts uses for Web Push subscriptions,
 * so the same row is updated if the user reinstalls / reauthenticates.
 *
 * R-54 will read this row and route messages via FCM HTTP v1 when
 * platform='android' (vs Web Push when token starts with '{').
 */
async function saveTokenToSupabase(token: string, userId: string): Promise<void> {
  try {
    const { error } = await supabase.from("push_tokens").upsert(
      {
        token,
        user_id: userId,
        platform: "android",
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,token" },
    );
    if (error) {
      console.warn("[NativePush] saveToken failed:", error.message);
      return;
    }
    console.info(`[NativePush] token persisted for user ${userId}`);
  } catch (e) {
    console.warn("[NativePush] saveToken threw:", e);
  }
}

/**
 * For tests: clear internal state.
 */
export function __resetForTests(): void {
  _initialized = false;
  _registrationToken = null;
  _lastSavedForUserId = null;
  _deepLinkHandler = null;
}
