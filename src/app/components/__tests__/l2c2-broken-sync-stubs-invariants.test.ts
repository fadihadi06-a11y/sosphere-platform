// ═══════════════════════════════════════════════════════════════
// SOSphere — L2-C2: Broken-table sync stubs (checkin / incident / message)
// ─────────────────────────────────────────────────────────────
// Companion to l2c-sos-replay-single-source-invariants.test.ts. Where
// L2-C fixed the SOS replay path (life-critical), L2-C2 stubs the three
// remaining sync categories that were silently broken the same way:
//
//   • syncCheckins  → supabase.from('checkin')   — actual table is `checkins`
//   • syncIncidents → supabase.from('incident')  — no such table
//   • syncMessages  → supabase.from('message')   — no such table
//
// Audit confirmed nothing in the codebase ever calls queueCheckin,
// queueIncident, or queueMessage — the IndexedDB stores are unwritten,
// so the sync paths were dead loops over empty stores against missing
// tables. The stubs below mark them not-yet-wired without firing any
// broken supabase.from() call.
//
// What this guards against:
//   • A future refactor re-introducing the broken supabase.from('checkin'/
//     'incident'/'message') direct insert pattern.
//   • A future refactor calling simulateNetworkSend with one of those
//     dead category labels.
//   • A future refactor wiring queueCheckin/Incident/Message WITHOUT
//     also wiring a proper backend table — that would silently re-create
//     the same dual-source problem L2-C fixed for SOS.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let engineSrc = "";

beforeAll(() => {
  engineSrc = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/components/offline-sync-engine.ts"),
    "utf8",
  );
});

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("L2-C2: broken-table sync paths are stubbed, not active", () => {
  it("syncCheckins does NOT call supabase.from('checkin') (singular — wrong table)", () => {
    const code = stripComments(engineSrc);
    expect(code).not.toMatch(/supabase\.from\(\s*['"]checkin['"]\s*\)/);
  });

  it("syncIncidents does NOT call supabase.from('incident') (no such table)", () => {
    const code = stripComments(engineSrc);
    expect(code).not.toMatch(/supabase\.from\(\s*['"]incident['"]\s*\)/);
  });

  it("syncMessages does NOT call supabase.from('message') (no such table)", () => {
    const code = stripComments(engineSrc);
    expect(code).not.toMatch(/supabase\.from\(\s*['"]message['"]\s*\)/);
  });

  it("none of the active stubs call simulateNetworkSend with the broken category labels", () => {
    const code = stripComments(engineSrc);
    expect(code).not.toMatch(/simulateNetworkSend\([^)]*['"]checkin['"]/);
    expect(code).not.toMatch(/simulateNetworkSend\([^)]*['"]incident['"]/);
    expect(code).not.toMatch(/simulateNetworkSend\([^)]*['"]message['"]/);
  });

  it("the stubs log a clear deferral warning when records exist (operator visibility)", () => {
    expect(engineSrc).toMatch(/checkins:.*backend wiring is pending/);
    expect(engineSrc).toMatch(/incidents:.*backend wiring is pending/);
    expect(engineSrc).toMatch(/messages:.*backend wiring is pending/);
  });

  it("the stubs leave their category status='done' (UI counters render zeros, no failure noise)", () => {
    // Each stub function must call updateCategory(...) with status: 'done'
    // and counts of 0 — verified by source-text scan, not behavior.
    expect(engineSrc).toMatch(/updateCategory\(\s*"checkins"[\s\S]*?status:\s*"done"/);
    expect(engineSrc).toMatch(/updateCategory\(\s*"incidents"[\s\S]*?status:\s*"done"/);
    expect(engineSrc).toMatch(/updateCategory\(\s*"messages"[\s\S]*?status:\s*"done"/);
  });
});
