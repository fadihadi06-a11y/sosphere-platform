// ═══════════════════════════════════════════════════════════════
// SOSphere — Deep-link route handlers (BLOCKER #21 fix)
// ─────────────────────────────────────────────────────────────
// Beehive audit #2 (2026-04-28) discovered that BLOCKER #21 added
// Android intent-filters for /auth, /reset-password, /payment-success,
// /payment-cancelled, /shared-sos — but routes.ts had no React-side
// handlers, so every deep link landed on the 404 page inside the app.
//
// This file provides the missing handlers. Each one is intentionally
// minimal: extract any URL params, do a small piece of auth/state
// work, then navigate to the canonical in-app screen. Full UI for
// these flows lives elsewhere (DashboardWebPage, MobileApp); these
// handlers are the bridge from the deep link to that UI.
//
// Design notes:
//   • Each handler is a tiny lazy-loaded component so the main bundle
//     doesn't pay for code paths that only fire from intent-filter taps.
//   • We use React Router's useNavigate + useSearchParams (already a
//     project dep — see routes.ts top import) for parameter extraction.
//   • A short visible "Redirecting…" frame keeps users from staring at
//     a blank page during the in-flight navigation.
//   • All handlers emit a toast on the redirect so the user has
//     feedback even if navigation is instant.
// ═══════════════════════════════════════════════════════════════

import { useEffect } from "react";
import { useNavigate, useSearchParams, useParams } from "react-router";
import { toast } from "sonner";
import { supabase } from "./api/supabase-client";

const FRAME_STYLE: React.CSSProperties = {
  width: "100vw",
  height: "100vh",
  background: "#05070E",
  color: "white",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "'Tajawal','Outfit',sans-serif",
  fontSize: 14,
  padding: 20,
  textAlign: "center",
};

// ─────────────────────────────────────────────────────────────────────
// /auth/callback — Supabase auth callback (magic link, email verify,
// OAuth return). The Supabase client picks up the session automatically
// from the URL hash; we just need to land on a valid screen.
// ─────────────────────────────────────────────────────────────────────
export function AuthCallbackHandler() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    if (error) {
      // Supabase puts auth errors in query params on failed callbacks.
      console.warn("[auth-callback] Supabase returned error:", error, errorDescription);
      toast.error(`تعذّر تسجيل الدخول: ${errorDescription || error}`, { duration: 6000 });
      navigate("/", { replace: true });
      return;
    }

    // Success path: Supabase client has already processed the URL hash
    // by the time this component mounts (see api/supabase-client.ts —
    // detectSessionInUrl is enabled). Just navigate to the right shell.
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        toast.success("تم تسجيل الدخول بنجاح.");
        navigate("/dashboard", { replace: true });
      } else {
        // Token wasn't valid / expired before we got here.
        toast.error("انتهت صلاحية الرابط. يُرجى المحاولة مرة أخرى.");
        navigate("/", { replace: true });
      }
    })();
  }, [navigate, searchParams]);

  return <div style={FRAME_STYLE}>جاري إكمال تسجيل الدخول…</div>;
}

// ─────────────────────────────────────────────────────────────────────
// /reset-password — Password reset link landing page. Supabase puts a
// recovery token in the URL hash; the SDK exchanges it for a session
// automatically. We then send the user to the dashboard, where they
// can be prompted to set a new password (existing flow in dashboard
// settings — out of scope for this handler).
// ─────────────────────────────────────────────────────────────────────
export function ResetPasswordHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        toast.success("الرابط صالح. يرجى تعيين كلمة مرور جديدة في الإعدادات.");
        // Drop the user into the dashboard with a flag the settings
        // screen can pick up to auto-open the password panel.
        navigate("/dashboard?action=reset-password", { replace: true });
      } else {
        toast.error("انتهت صلاحية رابط إعادة التعيين.");
        navigate("/", { replace: true });
      }
    })();
  }, [navigate]);

  return <div style={FRAME_STYLE}>جاري التحقّق من رابط إعادة التعيين…</div>;
}

// ─────────────────────────────────────────────────────────────────────
// /payment-success — Stripe checkout success return. We dispatch the
// `tier_refresh` event (subscription-realtime listens on it from
// CRIT-#3) so any open dashboard re-fetches the new tier without
// waiting for the realtime push to arrive. Then redirect to the app.
// ─────────────────────────────────────────────────────────────────────
export function PaymentSuccessHandler() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const sessionId = searchParams.get("session_id"); // Stripe checkout session id
    console.info("[payment-success] Stripe session:", sessionId || "(none)");

    // Trigger subscription refresh (CRIT-#3 listener picks this up).
    try {
      // NOTE: event name uses underscore (`sosphere_tier_refresh`) — must
      // match the listener registered in mobile-app.tsx:955. A previous
      // version used a colon (`sosphere:tier_refresh`) which silently
      // never fired the refresh after Stripe checkout.
      window.dispatchEvent(new CustomEvent("sosphere_tier_refresh", {
        detail: { reason: "payment_success", sessionId },
      }));
    } catch {
      /* non-fatal */
    }

    toast.success("تم الدفع بنجاح! جاري تفعيل اشتراكك…", { duration: 4000 });
    // Brief delay so the toast is visible before navigation.
    const t = setTimeout(() => navigate("/app", { replace: true }), 1200);
    return () => clearTimeout(t);
  }, [navigate, searchParams]);

  return (
    <div style={FRAME_STYLE}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: "#00C853" }}>
          ✓ تم الدفع بنجاح
        </div>
        <div>جاري تفعيل اشتراكك…</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// /payment-cancelled — Stripe checkout cancelled return. No state
// change needed; just inform the user and send them back.
// ─────────────────────────────────────────────────────────────────────
export function PaymentCancelledHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    toast.info("تم إلغاء عملية الدفع. يمكنك المحاولة مرة أخرى في أي وقت.", { duration: 5000 });
    const t = setTimeout(() => navigate("/app", { replace: true }), 1500);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div style={FRAME_STYLE}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: "#FF9500" }}>
          عملية الدفع ملغاة
        </div>
        <div>جاري إعادتك إلى التطبيق…</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// /shared-sos/:emergencyId — public web viewer for a shared SOS link.
// The web viewer feature itself isn't built yet — for now we redirect
// to the dashboard which has incident lookup. The route exists so the
// Android intent-filter targets a valid path (otherwise notification
// taps land on 404).
// ─────────────────────────────────────────────────────────────────────
export function SharedSosViewerHandler() {
  const navigate = useNavigate();
  const params = useParams<{ emergencyId?: string }>();

  useEffect(() => {
    const eid = params.emergencyId;
    console.info("[shared-sos] requested emergency:", eid || "(no id)");

    // Stash the requested incident id so the dashboard can deep-scroll
    // to it after auth completes.
    if (eid) {
      try {
        sessionStorage.setItem("sosphere_pending_shared_sos", eid);
      } catch {
        /* non-fatal */
      }
    }

    toast.info("جاري فتح تفاصيل الحادثة…");
    navigate("/dashboard", { replace: true });
  }, [navigate, params]);

  return <div style={FRAME_STYLE}>جاري تحميل تفاصيل الحادثة…</div>;
}
