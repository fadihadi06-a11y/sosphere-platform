// ═══════════════════════════════════════════════════════════════
// SOSphere — Subscription Realtime listener (CRIT-#3)
// ─────────────────────────────────────────────────────────────
// Pushes subscription tier changes from the server to the client in
// near real-time. When the Stripe webhook updates the user's row in
// `public.subscriptions`, Postgres NOTIFY → Supabase Realtime → here.
//
// The callback passed in is fired on INSERT / UPDATE / DELETE that
// matches the current user. The mobile-app tier-resync useEffect
// uses this to call refreshTier() instantly rather than waiting for
// the 5-minute polling interval.
//
// FAIL-SECURE: every code path is best-effort. If the channel fails
// to subscribe (Realtime disabled, missing publication, network
// issue, etc.) we silently bail and rely on the polling fallback.
// We never throw out of this module — a failure here must not crash
// the calling component.
//
// Auth-change handling: if the user signs in / out we tear down the
// old channel and (re)subscribe under the new user_id. This lets the
// listener follow the active session through completeLogout() and
// the next sign-in without the caller having to manage it.
//
// Returns a cleanup function the caller MUST run on unmount, OR null
// if the listener could not be set up. Cleanup is idempotent.
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./supabase-client";
import { getStoredUser } from "./safe-rpc";

export type SubscriptionChangeCallback = () => void;

/**
 * Subscribe to realtime changes on the public.subscriptions row owned
 * by the currently-authenticated user. Re-subscribes automatically on
 * auth state change.
 *
 * @param onChange  Fired (with no payload) whenever the row matching
 *                  user_id = auth.uid() changes. Caller decides how to
 *                  refresh — typically by calling fetchCivilianTier().
 * @returns A cleanup function. Calling it more than once is safe.
 */
export async function subscribeSubscriptionChanges(
  onChange: SubscriptionChangeCallback,
): Promise<() => void> {
  let currentChannel: ReturnType<typeof supabase.channel> | null = null;
  let currentUserId: string | null = null;
  let stopped = false;

  const teardown = () => {
    if (currentChannel) {
      try { void supabase.removeChannel(currentChannel); } catch { /* ignore */ }
      currentChannel = null;
    }
  };

  const subscribeFor = async (userId: string) => {
    teardown();
    if (stopped) return;
    try {
      // Channel name MUST be unique per user to avoid cross-tenant message
      // bleed if a tab is shared. Filter is server-side via Postgres RLS,
      // but we belt-and-suspenders by also setting a server-side filter
      // expression on the channel.
      const channel = supabase
        .channel(`sub-tier:${userId}`)
        .on(
          // Cast keeps the call valid against supabase-js v2 typings without
          // dragging the entire postgres_changes overload here.
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "subscriptions",
            filter: `user_id=eq.${userId}`,
          },
          () => {
            if (stopped) return;
            try { onChange(); } catch (e) { console.warn("[sub-rt] onChange threw:", e); }
          },
        )
        .subscribe((status: string) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn(`[sub-rt] subscribe status=${status} (will rely on polling)`);
          }
        });
      currentChannel = channel;
      currentUserId = userId;
    } catch (e) {
      console.warn("[sub-rt] failed to open channel:", e);
      currentChannel = null;
    }
  };

  // Initial subscribe (if a session exists right now).
  try {
    // E1.6-PHASE3: JWT from storage (auth-state-change fires later for real session).
    const u = getStoredUser();
    if (u?.id) {
      await subscribeFor(u.id);
    }
  } catch (e) {
    console.warn("[sub-rt] could not read initial session:", e);
  }

  // Re-subscribe on auth changes — sign-in opens the channel, sign-out
  // tears it down, sign-in-as-other-user swaps it.
  let authSub: { unsubscribe: () => void } | null = null;
  try {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (stopped) return;
      const newUserId = session?.user?.id ?? null;
      if (newUserId === currentUserId) return; // no-op on same user
      if (!newUserId) {
        teardown();
        currentUserId = null;
        return;
      }
      void subscribeFor(newUserId);
    });
    authSub = data?.subscription ?? null;
  } catch (e) {
    console.warn("[sub-rt] could not register auth listener:", e);
  }

  // Cleanup function — idempotent.
  return () => {
    if (stopped) return;
    stopped = true;
    teardown();
    try { authSub?.unsubscribe(); } catch { /* ignore */ }
  };
}
