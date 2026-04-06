import { createBrowserRouter } from "react-router";
import { createElement } from "react";
import { LandingPage } from "./components/landing-page";

function RouteLoading() {
  return createElement("div", { style: { width: "100vw", height: "100vh", background: "#05070E" } });
}

export const router = createBrowserRouter([
  { path: "/", Component: LandingPage, HydrateFallback: RouteLoading },
  { path: "/app", lazy: () => import("./components/mobile-app").then(m => ({ Component: m.MobileApp })), HydrateFallback: RouteLoading },
  // ── PERF: Dashboard lazy-loaded (was synchronous — ~3900 lines + 70 sub-imports) ──
  { path: "/dashboard", lazy: () => import("./components/dashboard-web-page").then(m => ({ Component: m.DashboardWebPage })), HydrateFallback: RouteLoading },
  { path: "/welcome", lazy: () => import("./components/welcome-activation").then(m => ({ Component: m.WelcomeActivation })), HydrateFallback: RouteLoading },
  { path: "/demo", lazy: () => import("./components/wow-demo").then(m => ({ Component: m.WowDemo })), HydrateFallback: RouteLoading },
  { path: "/training", lazy: () => import("./components/training-center").then(m => ({ Component: m.TrainingCenter })), HydrateFallback: RouteLoading },
  { path: "*", lazy: () => import("./components/not-found-page").then(m => ({ Component: m.NotFoundPage })), HydrateFallback: RouteLoading },
]);
