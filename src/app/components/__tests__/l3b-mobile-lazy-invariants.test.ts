// ═══════════════════════════════════════════════════════════════
// SOSphere — L3-B / F-02: Mobile-app lazy-screen invariants
// ─────────────────────────────────────────────────────────────
// Locks the contract that heavy mobile screens stay code-split.
// Workers carry this app in the field — every KB = ms during emergency.
//
// Before L3-B: mobile-app chunk = 787KB + emergency-chat = 391KB extra.
// After L3-B: 5 heaviest screens are React.lazy() so chunks fetch only
// on first navigation to that screen. SOS button + login + sensors stay
// eager (always running or on the critical hot path).
//
// What this guards against:
//   • A future refactor reverting one of the 5 lazy imports back to
//     a top-level eager `import { X } from "./..."` line — re-bloats
//     the cold-start chunk silently.
//   • Removing the <Suspense> boundaries — would crash on first
//     navigation to a lazy screen.
//   • Lazy-loading a HOT-PATH screen by mistake (e.g., LoginPhone or
//     consent-screens) — would block the boot path on chunk fetch.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let mobileSrc = "";

beforeAll(() => {
  mobileSrc = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/components/mobile-app.tsx"),
    "utf8",
  );
});

// Pages that MUST be lazy. Each entry is the symbol + the size reason.
const LAZY_SCREENS: Array<{ name: string; reason: string }> = [
  { name: "MobileEmergencyChat",   reason: "391KB chunk — biggest single win" },
  { name: "IncidentHistory",       reason: "review page, post-emergency only" },
  { name: "SubscriptionPlans",     reason: "upgrade flow, opens rarely" },
  { name: "PostEmergencyDebrief",  reason: "after-action only" },
  { name: "EmergencyResponseRecord", reason: "review page only" },
];

// Hot-path screens that MUST stay eager. If any of these gets lazy
// later, the boot path or SOS press path takes a chunk-fetch hit.
const HOT_PATH_EAGER: string[] = [
  "LoginPhone",          // boot-path login form
  "WelcomeOnboarding",   // first-launch
  "ConsentScreens",      // required boot
  "SosEmergency",        // THE button
  "ShakeToSos",          // always-on sensor
  "FallDetection",       // always-on sensor
  "OfflineGpsTracker",   // always-on sensor
  "BroadcastIsland",     // incoming alerts
];

describe("L3-B: heavy mobile screens are lazy-loaded", () => {
  it("lazy + Suspense are imported from react", () => {
    expect(mobileSrc).toMatch(/import\s*\{[^}]*\blazy\b[^}]*\}\s*from\s*["']react["']/);
    expect(mobileSrc).toMatch(/import\s*\{[^}]*\bSuspense\b[^}]*\}\s*from\s*["']react["']/);
  });

  it("at least one Suspense boundary wraps the lazy renders", () => {
    expect(mobileSrc).toMatch(/<Suspense\s+fallback=/);
    expect(mobileSrc).toMatch(/<\/Suspense>/);
  });

  for (const { name, reason } of LAZY_SCREENS) {
    it(`${name} is lazy (${reason})`, () => {
      const eagerPattern = new RegExp(`^import\\s*\\{\\s*${name}\\s*\\}\\s*from\\s*["']\\./`, "m");
      expect(mobileSrc).not.toMatch(eagerPattern);
      const lazyPattern = new RegExp(`const\\s+${name}\\s*=\\s*lazy\\s*\\(\\s*\\(\\s*\\)\\s*=>\\s*import\\(["']\\./[^"']+["']\\)`);
      expect(mobileSrc).toMatch(lazyPattern);
    });
  }
});

describe("L3-B: hot-path mobile screens stay eager (no lazy)", () => {
  for (const name of HOT_PATH_EAGER) {
    it(`${name} is NOT lazy (boot-path or sensor)`, () => {
      const lazyPattern = new RegExp(`const\\s+${name}\\s*=\\s*lazy\\s*\\(`);
      expect(mobileSrc).not.toMatch(lazyPattern);
    });
  }
});
