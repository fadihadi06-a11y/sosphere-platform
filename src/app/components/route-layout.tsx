// ═══════════════════════════════════════════════════════════════
// SOSphere — Route-Level Transitions Layout
// ─────────────────────────────────────────────────────────────
// Wraps route outlets with page transitions for smooth navigation
// between main app pages (dashboard, welcome, demo, etc.)
// ═══════════════════════════════════════════════════════════════

import React from "react";
import { Outlet, useLocation } from "react-router";
import { AnimatePresence } from "motion/react";
import { PageTransition } from "./view-transitions";

/**
 * RouteTransitionLayout - Wraps the main router outlet with smooth page transitions
 *
 * Usage in routes.ts:
 * Create a layout route that wraps all pages:
 * { path: "/", Component: RouteTransitionLayout, children: [...pages] }
 *
 * Or wrap specific route groups with this component.
 */
export function RouteTransitionLayout() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <PageTransition key={location.pathname}>
        <Outlet />
      </PageTransition>
    </AnimatePresence>
  );
}

/**
 * Helper component for routes that need a consistent page layout
 */
export function withRouteTransition<P extends object>(
  Component: React.ComponentType<P>
): React.ComponentType<P> {
  return (props: P) => {
    const location = useLocation();

    return (
      <AnimatePresence mode="wait">
        <PageTransition key={location.pathname}>
          <Component {...props} />
        </PageTransition>
      </AnimatePresence>
    );
  };
}
