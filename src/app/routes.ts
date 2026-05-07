import { createBrowserRouter, redirect } from "react-router";
import { createElement } from "react";
import { LandingPage } from "./components/landing-page";
import { RouteTransitionLayout } from "./components/route-layout";

function RouteLoading() {
  return createElement("div", { style: { width: "100vw", height: "100vh", background: "#05070E" } });
}

// Detect Capacitor native app
function isNative(): boolean {
  return typeof window !== 'undefined' && !!(window as any).Capacitor;
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
      { path: "/dashboard", lazy: () => import("./components/dashboard-web-page").then(m => ({ Component: m.DashboardWebPage })), HydrateFallback: RouteLoading },
      { path: "/welcome", lazy: () => import("./components/welcome-activation").then(m => ({ Component: m.WelcomeActivation })), HydrateFallback: RouteLoading },
      { path: "/demo", lazy: () => import("./components/wow-demo").then(m => ({ Component: m.WowDemo })), HydrateFallback: RouteLoading },
      { path: "/training", lazy: () => import("./components/training-center").then(m => ({ Component: m.TrainingCenter })), HydrateFallback: RouteLoading },
      // ── DEV: Diagnostic Stress-Test Suite (dev mode only) ──
      ...(import.meta.env.DEV ? [
        { path: "/dev/stress-test", lazy: () => import("./components/diagnostic-stress-test-v2").then(m => ({ Component: m.DiagnosticStressTest })), HydrateFallback: RouteLoading },
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
