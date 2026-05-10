// ═══════════════════════════════════════════════════════════════
// SOSphere — L3-A / F-01: lazy-page invariants
// ─────────────────────────────────────────────────────────────
// Locks the contract that heavy dashboard pages stay code-split.
// Before L3-A: company-dashboard.tsx eagerly imported 18+ pages,
// dragging jsPDF (382KB) + html2canvas (198KB) + recharts + QRCode
// into the dashboard chunk (2.2MB). After L3-A: each page is
// React.lazy() so chunks load only on first navigation.
//
// What this guards against:
//   • A future refactor reverting one of the lazy imports back to
//     a top-level eager `import { XPage } from "./..."` — would
//     re-bloat the initial bundle without anyone noticing until
//     bundle analysis catches it weeks later.
//   • Removing the <Suspense> boundary — would crash on first
//     navigation when the lazy chunk takes >0ms to resolve.
//   • Removing the lazy import for one of the heaviest pages
//     (AuditLogPage, AnalyticsPage, BillingPage) — these directly
//     drag jsPDF and are the highest-leverage lazy-loads.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let dashboardSrc = "";

beforeAll(() => {
  dashboardSrc = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/components/company-dashboard.tsx"),
    "utf8",
  );
});

// Pages that MUST be lazy because they bring heavy dependencies.
// Each entry is the page name + the dependency it would otherwise drag.
const HEAVY_LAZY_PAGES: Array<{ name: string; reason: string }> = [
  { name: "AuditLogPage",            reason: "jsPDF + jspdf-autotable + QRCode + DOMPurify" },
  { name: "AnalyticsPage",           reason: "jsPDF + recharts" },
  { name: "BillingPage",             reason: "Stripe checkout flow paths" },
  { name: "PricingPage",             reason: "Stripe checkout flow paths" },
  { name: "SettingsPage",            reason: "large form tree + media uploads" },
  { name: "RolesPermissionsPage",    reason: "large permission matrix UI" },
  { name: "PipelineHealthPage",      reason: "L1-E observability page" },
  { name: "UnifiedEmployeesPage",    reason: "CSV import wizard + bulk actions" },
  { name: "DashboardJobsPage",       reason: "realtime channel + job UI" },
  { name: "LocationZonesPage",       reason: "leaflet map (heavy)" },
  { name: "WorkforcePage",           reason: "shift scheduling UI" },
  { name: "CommsHubPage",            reason: "messaging UI" },
  { name: "LeaderboardPage",         reason: "recharts" },
  { name: "RRPAnalyticsPage",        reason: "recharts" },
  { name: "OfflineMonitoringPage",   reason: "offline sync UI" },
  { name: "SARProtocolPage",         reason: "SAR export flows" },
  { name: "IncidentInvestigationPage", reason: "investigation flows" },
  { name: "RiskRegisterPage",        reason: "risk matrix UI" },
];

describe("L3-A: heavy dashboard pages are lazy-loaded", () => {
  it("React.lazy and Suspense are imported from react", () => {
    expect(dashboardSrc).toMatch(/import\s*\{[^}]*\blazy\b[^}]*\}\s*from\s*["']react["']/);
    expect(dashboardSrc).toMatch(/import\s*\{[^}]*\bSuspense\b[^}]*\}\s*from\s*["']react["']/);
  });

  it("Suspense boundary wraps the page-switch render block", () => {
    // Just check that Suspense with a fallback prop is present and is closed.
    // Don't try to match the closing `}>` because the fallback may contain
    // nested object literals (e.g., inline style={{ ... }}).
    expect(dashboardSrc).toMatch(/<Suspense\s+fallback=/);
    expect(dashboardSrc).toMatch(/<\/Suspense>/);
  });

  for (const { name, reason } of HEAVY_LAZY_PAGES) {
    it(`${name} is lazy (${reason})`, () => {
      // Two requirements:
      //  (1) NO top-level eager `import { ${name} } from "./..."` line
      //  (2) A `const ${name} = lazy(() => import("./...").then(m => ({ default: m.${name} })))`
      const eagerPattern = new RegExp(`^import\\s*\\{\\s*${name}\\s*\\}\\s*from\\s*["']\\./`, "m");
      expect(dashboardSrc).not.toMatch(eagerPattern);
      const lazyPattern = new RegExp(`const\\s+${name}\\s*=\\s*lazy\\s*\\(\\s*\\(\\s*\\)\\s*=>\\s*import\\(["']\\./[^"']+["']\\)`);
      expect(dashboardSrc).toMatch(lazyPattern);
    });
  }
});
