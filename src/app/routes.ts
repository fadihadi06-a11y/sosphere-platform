import { createBrowserRouter, redirect } from "react-router";
import { createElement } from "react";
import { LandingPage } from "./components/landing-page";
import { RouteTransitionLayout } from "./components/route-layout";
import { isNativeApp } from "./components/capacitor-bridge";

// Branded loading fallback. Previously a blank dark div, which showed a
// ~3s empty screen while the lazy dashboard chunk (~3900 lines) loaded.
// Now renders a centered spinner so first paint communicates progress.
function RouteLoading() {
  return createElement(
    "div",
    {
      style: {
        width: "100vw", height: "100vh", background: "#05070E",
        display: "flex", alignItems: "center", justifyContent: "center",
      },
    },
    createElement("div", {
      "aria-label": "Loading",
      role: "status",
      style: {
        width: 44, height: 44, borderRadius: "50%",
        border: "3px solid rgba(255,255,255,0.12)",
        borderTopColor: "#FF2D55",
        animation: "sos-route-spin 0.8s linear infinite",
      },
    }),
    createElement("style", null,
      "@keyframes sos-route-spin{to{transform:rotate(360deg)}}")
  );
}

// Detect Capacitor native app. Single source of truth: isNativeApp()
// uses Capacitor.isNativePlatform() (true ONLY in a real iOS/Android
// container), so web visitors correctly fall through to the landing page.
function isNative(): boolean {
  return isNativeApp();
}

export const router = createBrowserRouter([
  // ── Root route with transitions enabled ──
  {
    Component: RouteTransitionLayout,
    children: [
      {
        path: "/",
        // On native app → go straight to mobile view. On web → show landing page.
        loader: () => isNative() ? redirect("/app") : null,
        Component: LandingPage,
        HydrateFallback: RouteLoading,
      },
      { path: "/app", lazy: () => import("./components/mobile-app").then(m => ({ Component: m.MobileApp })), HydrateFallback: RouteLoading },
      // ── PERF: Dashboard lazy-loaded (was synchronous — ~3900 lines + 70 sub-imports) ──
      // 2026-06-04 fresh-audit #2: dashboardSessionLoader runs in parallel with
      // the dynamic chunk import. It clears expired display hints (getDashboardSession
      // + isSessionExpired were imported by the page but never called - so 9h-old
      // hints survived forever) and resolves the server-verified session up front.
      // Non-redirecting variant - the page still renders its in-component PIN+MFA
      // flow when verified is null, so the UX contract is preserved.
      {
        path: "/dashboard",
        loader: () => import("./components/utils/dashboard-auth-guard").then(m => m.dashboardSessionLoader()),
        lazy: () => import("./components/dashboard-web-page").then(m => ({ Component: m.DashboardWebPage })),
        HydrateFallback: RouteLoading,
      },
      // ── Platform Super-Admin console (standalone; server-gated via is_platform_admin RPC) ──
      { path: "/super-admin", lazy: () => import("./components/super-admin-console").then(m => ({ Component: m.SuperAdminConsole })), HydrateFallback: RouteLoading },
      { path: "/welcome", lazy: () => import("./components/welcome-activation").then(m => ({ Component: m.WelcomeActivation })), HydrateFallback: RouteLoading },
      { path: "/demo", lazy: () => import("./components/wow-demo").then(m => ({ Component: m.WowDemo })), HydrateFallback: RouteLoading },
      { path: "/training", lazy: () => import("./components/training-center").then(m => ({ Component: m.TrainingCenter })), HydrateFallback: RouteLoading },
      // ── DEV: Diagnostic Stress-Test Suite (dev mode only) ──
      ...(import.meta.env.DEV ? [
        // P0-doctrine-completion (2026-05-25): /dev/stress-test route removed.
        // The diagnostic-stress-test-v2.tsx component imported 3 modules that no
        // longer exist (./emergency-buffer, ./dead-sync-detector, ./privacy-obfuscator).
        // The file had been silently broken; removing the route + file is the
        // root-cause fix for dead code. Resurrect via a fresh PR if the diagnostic
        // is still needed (will require rebuilding the 3 backing modules).
      ] : []),
      // ── LEGAL: Privacy Policy and Terms of Service ──
      { path: "/privacy", lazy: () => import("./components/privacy-page").then(m => ({ Component: m.PrivacyPage })), HydrateFallback: RouteLoading },
      { path: "/terms", lazy: () => import("./components/terms-page").then(m => ({ Component: m.TermsPage })), HydrateFallback: RouteLoading },
      // AUTH-5 P5 (#175): Data Processing Agreement — public legal page;
      // shows signed-copy banner + PDF download when visitor is signed in
      // and their active company has accepted.
      { path: "/legal/dpa", lazy: () => import("./components/dpa-page").then(m => ({ Component: m.DpaPage })), HydrateFallback: RouteLoading },
      // ── COMPLIANCE: Hidden ISO 27001 Auditor Dashboard (requires admin PIN) ──
      { path: "/compliance", lazy: () => import("./components/compliance-dashboard-v2").then(m => ({ Component: m.ComplianceDashboard })), HydrateFallback: RouteLoading },
      // ── DEEP-LINK HANDLERS (BLOCKER #21 / Beehive fix #2, 2026-04-28) ──
      // Android intent-filters route Supabase auth callbacks, Stripe
      // redirects, and shared-SOS notification taps to these paths.
      // Without them every deep link landed on the 404 page even
      // though Android opened SOSphere correctly.
      { path: "/auth/callback", lazy: () => import("./components/deep-link-handlers").then(m => ({ Component: m.AuthCallbackHandler })), HydrateFallback: RouteLoading },
      { path: "/reset-password", lazy: () => import("./components/deep-link-handlers").then(m => ({ Component: m.ResetPasswordHandler })), HydrateFallback: RouteLoading },
      { path: "/payment-success", lazy: () => import("./components/deep-link-handlers").then(m => ({ Component: m.PaymentSuccessHandler })), HydrateFallback: RouteLoading },
      { path: "/payment-cancelled", lazy: () => import("./components/deep-link-handlers").then(m => ({ Component: m.PaymentCancelledHandler })), HydrateFallback: RouteLoading },
      { path: "/shared-sos/:emergencyId", lazy: () => import("./components/deep-link-handlers").then(m => ({ Component: m.SharedSosViewerHandler })), HydrateFallback: RouteLoading },
      { path: "*", lazy: () => import("./components/not-found-page").then(m => ({ Component: m.NotFoundPage })), HydrateFallback: RouteLoading },
    ],
  },
]);
