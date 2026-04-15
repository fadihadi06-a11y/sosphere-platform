// ═══════════════════════════════════════════════════════════════
// SOSphere — Vitest Configuration (P3-#13)
// ─────────────────────────────────────────────────────────────
// Minimal test-harness setup. We intentionally scope tests to
// `src/**/__tests__/**` and `src/**/*.test.ts(x)` only, so legacy
// Figma Make imports under `src/imports/*` (which carry pre-existing
// typecheck noise) stay excluded.
//
// No jsdom / no component rendering yet — this harness is for the
// pure safety-critical logic layer: risk scoring, date round-trips,
// compliance aggregators, leaderboard formulas. UI component tests
// can bolt on later with `environment: "jsdom"` per-file or via a
// second config.
// ═══════════════════════════════════════════════════════════════

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/**/__tests__/**/*.{test,spec}.{ts,tsx}",
      "src/**/*.{test,spec}.{ts,tsx}",
    ],
    // Keep the legacy Figma Make imports out of the test run — they
    // live in `src/imports/*` and have pre-existing type noise that
    // belongs to a different migration slice.
    exclude: [
      "node_modules/**",
      "dist/**",
      "android/**",
      "src/imports/**",
    ],
    // Isolate per-file so module-level state (companyId, audit queue)
    // can't leak between tests.
    isolate: true,
  },
});
