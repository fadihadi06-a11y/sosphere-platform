// ═══════════════════════════════════════════════════════════════
// SOSphere — L2-C: Single-source SOS replay invariants
// ─────────────────────────────────────────────────────────────
// Locks the post-fix contract for offline SOS resilience:
//   ① The OFFLINE SYNC engine must NOT directly insert SOS records to
//     supabase.from("sos") — there is no `sos` table in production.
//     Any direct path silently failed and raced the canonical replay.
//   ② There must be EXACTLY ONE replay path:
//     sos-server-trigger.replayPendingSOS().
//   ③ offline-sync-engine.syncSOSAlerts must DELEGATE to that canonical
//     path instead of having its own (broken) implementation.
//
// What this guards against:
//   • A future refactor re-adding `simulateNetworkSend(sos, "sos")` —
//     it would silently fail because the `sos` table doesn't exist.
//   • A future refactor implementing a SECOND SOS replay loop that
//     races the canonical one over the same IndexedDB queue (would
//     exhaust retry quota before legitimate replays could fire).
//   • A future refactor removing the delegation and re-introducing
//     the broken supabase.from("sos") direct insert.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let engineSrc = "";
let triggerSrc = "";

beforeAll(() => {
  engineSrc = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/components/offline-sync-engine.ts"),
    "utf8",
  );
  triggerSrc = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/components/sos-server-trigger.ts"),
    "utf8",
  );
});

// Strip JS line + block comments so the postmortem in syncSOSAlerts
// (which mentions the broken pattern as a CAUTIONARY note) doesn't trip
// the regex. Same pattern used in L2-D test.
function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("L2-C: offline-sync-engine has no direct SOS insert path", () => {
  it("does NOT call supabase.from('sos').insert(...) (no `sos` table exists)", () => {
    const code = stripComments(engineSrc);
    expect(code).not.toMatch(/supabase\.from\(\s*['"]sos['"]\s*\)/);
  });

  it("does NOT call simulateNetworkSend with 'sos' category (broken path)", () => {
    const code = stripComments(engineSrc);
    expect(code).not.toMatch(/simulateNetworkSend\([^)]*['"]sos['"]/);
  });

  it("syncSOSAlerts delegates to the canonical replayPendingSOS() helper", () => {
    // Should be a dynamic import to avoid a circular dependency with
    // sos-server-trigger.ts (which imports from offline-database.ts).
    expect(engineSrc).toMatch(/import\s*\(\s*['"]\.\/sos-server-trigger['"]\s*\)/);
    expect(engineSrc).toMatch(/replayPendingSOS\s*\(\s*\)/);
  });
});

describe("L2-C: replayPendingSOS is the canonical SOS replay path", () => {
  it("sos-server-trigger.ts exports replayPendingSOS", () => {
    expect(triggerSrc).toMatch(/export\s+async\s+function\s+replayPendingSOS\s*\(/);
  });

  it("replayPendingSOS calls the actual sos-alert edge function (not direct DB insert)", () => {
    // The canonical path wraps fetch to /functions/v1/sos-alert. Should
    // never bypass the edge function — every replay must go through the
    // same idempotency-keyed pipeline as fresh triggers.
    expect(triggerSrc).toMatch(/sos-alert/);
    // Negative: must NOT have a fallback that inserts directly to a 'sos' table.
    const code = stripComments(triggerSrc);
    expect(code).not.toMatch(/\.from\(\s*['"]sos['"]\s*\)\.insert/);
  });

  it("replayPendingSOS is auth-gated (skips when no Bearer token)", () => {
    expect(triggerSrc).toMatch(/getStoredBearerToken\(\)/);
    expect(triggerSrc).toMatch(/no auth session yet/);
  });

  it("replayPendingSOS honors a TTL window so stale events don't re-page contacts", () => {
    expect(triggerSrc).toMatch(/REPLAY_TTL_MS/);
  });

  it("replayPendingSOS guards against concurrent runs (replayInFlight)", () => {
    expect(triggerSrc).toMatch(/replayInFlight/);
  });
});
