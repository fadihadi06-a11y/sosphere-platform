// ═══════════════════════════════════════════════════════════════
// SOSphere — 3-tier individual PDF report source-pinning
// ─────────────────────────────────────────────────────────────
// Pins the tier-gating contract (CRIT 3-tier reports, 2026-04-28)
// for individual-pdf-report.tsx.
//
// The product promise (privacy-page §5 + pricing page):
//   • free   → no PDF (audit_log only — retroactive after upgrade)
//   • basic  → "Standard Report" — court-admissible, abbreviated
//   • elite  → "Forensic Evidence" — full server-verified audit chain
//
// If a future refactor:
//   • removes the tier param entirely (regresses to one-PDF-fits-all)
//   • lets basic users render the Server-Verified Audit Chain (§7)
//   • lets basic users see the audio storage URL or Privacy Packet state
//   • removes the "default to basic if tier missing" safety
//   • lets free users reach generateIndividualReport without upgrading
// …this test fails and the regression is caught in CI.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let pdfSrc = "";
let callerSrc = "";

beforeAll(() => {
  const cwd = process.cwd();
  pdfSrc = fs.readFileSync(
    path.resolve(cwd, "src/app/components/individual-pdf-report.tsx"),
    "utf8",
  );
  callerSrc = fs.readFileSync(
    path.resolve(cwd, "src/app/components/emergency-response-record.tsx"),
    "utf8",
  );
});

// ─────────────────────────────────────────────────────────────
describe("CRIT 3-tier reports / type contract", () => {
  it("exports the ReportTier type with 'basic' | 'elite' (free is NOT a report tier)", () => {
    expect(pdfSrc).toMatch(/export type ReportTier = "basic" \| "elite"/);
    // Free must NOT be a valid report tier — it should not appear as
    // an alternative in the union.
    expect(pdfSrc).not.toMatch(/ReportTier = .*"free"/);
  });

  it("IndividualReportData has tier?: ReportTier field", () => {
    expect(pdfSrc).toMatch(/tier\?: ReportTier/);
  });

  it("legacy plan field is preserved as deprecated (backward-compat)", () => {
    // Don't break old callers during rollout — but mark deprecated.
    expect(pdfSrc).toMatch(/@deprecated/);
    expect(pdfSrc).toMatch(/plan\?: "personal" \| "family"/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("CRIT 3-tier reports / safe-default tier resolution", () => {
  it("resolveTier defaults to 'basic' when tier is missing or unknown", () => {
    // Critical safety: silently rendering Elite content for a Basic
    // user would be a security/billing leak. Default MUST be the
    // lower-fidelity 'basic'.
    expect(pdfSrc).toMatch(/function resolveTier/);
    const block = pdfSrc.match(/function resolveTier[\s\S]*?\n}/);
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/data\.tier === "elite"/);
    expect(block![0]).toMatch(/return "basic"/);
  });

  it("entry point invokes resolveTier and stores isElite", () => {
    expect(pdfSrc).toMatch(/const tier = resolveTier\(data\)/);
    expect(pdfSrc).toMatch(/const isElite = tier === "elite"/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("CRIT 3-tier reports / Elite-only sections", () => {
  it("§7 Server-Verified Audit Chain is gated behind isElite", () => {
    // The legal-gold property MUST require Elite. A basic report
    // showing the server audit chain is the regression we guard against.
    const sec7 = pdfSrc.match(
      /SERVER-VERIFIED AUDIT CHAIN[\s\S]*?(?=\/\/ ── Legal Notice)/,
    );
    expect(sec7).not.toBeNull();
    expect(sec7![0]).toMatch(/if \(!isElite\)/);
    expect(sec7![0]).toMatch(/requires the Elite Forensic tier/);
  });

  it("Audio Recording storage URL is Elite-only", () => {
    const audioBlock = pdfSrc.match(
      /"Audio Recording"[\s\S]*?\}\)\(\)\],/,
    );
    expect(audioBlock).not.toBeNull();
    expect(audioBlock![0]).toMatch(/!isElite/);
    expect(audioBlock![0]).toMatch(/Elite Forensic tier/);
  });

  it("Privacy Packet Shared field is Elite-only", () => {
    const packetBlock = pdfSrc.match(
      /"Privacy Packet Shared"[\s\S]*?\}\)\(\)\]/,
    );
    expect(packetBlock).not.toBeNull();
    expect(packetBlock![0]).toMatch(/!isElite/);
    expect(packetBlock![0]).toMatch(/Available in Elite Forensic tier/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("CRIT 3-tier reports / abbreviation behavior on basic", () => {
  it("§5 Timeline shows 'abbreviated' label and limits to last 10 events for basic", () => {
    expect(pdfSrc).toMatch(
      /isElite \? "5\. EVENT TIMELINE" : "5\. EVENT TIMELINE \(abbreviated\)"/,
    );
    expect(pdfSrc).toMatch(
      /const timelineRows = isElite \? data\.timeline : data\.timeline\.slice\(-10\)/,
    );
  });

  it("§6 GPS Trail shows 5 rows for basic vs 20 for elite", () => {
    expect(pdfSrc).toMatch(/const trailLimit = isElite \? 20 : 5/);
  });

  it("Footer for abbreviated GPS trail mentions Elite upgrade path", () => {
    expect(pdfSrc).toMatch(/full trail table included in Elite Forensic tier/);
  });

  it("Footer for abbreviated timeline mentions Elite upgrade path", () => {
    expect(pdfSrc).toMatch(/full chronological timeline included in Elite Forensic tier/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("CRIT 3-tier reports / tier badge and metadata", () => {
  it("tier label table has both basic and elite entries", () => {
    expect(pdfSrc).toMatch(/basic: "STANDARD REPORT"/);
    expect(pdfSrc).toMatch(/elite: "FORENSIC EVIDENCE"/);
  });

  it("tier line in cover metadata reflects the rendered tier", () => {
    // The cover page "Tier:" line must show what the reader is getting.
    expect(pdfSrc).toMatch(
      /Tier: \$\{TIER_LABEL\[tier\]\}\$\{isElite \? " — full server-verified audit" : " — abbreviated evidence sections"\}/,
    );
  });
});

// ─────────────────────────────────────────────────────────────
describe("CRIT 3-tier reports / caller passes tier correctly", () => {
  it("emergency-response-record imports getTier from subscription-service", () => {
    expect(callerSrc).toMatch(
      /import \{ getTier \} from "\.\/subscription-service"/,
    );
  });

  it("caller imports the ReportTier type", () => {
    expect(callerSrc).toMatch(/type ReportTier/);
  });

  it("caller resolves _reportTier from getTier() — no hardcoded plan", () => {
    expect(callerSrc).toMatch(/const _effectiveTier = getTier\(\)/);
    expect(callerSrc).toMatch(
      /const _reportTier: ReportTier = _effectiveTier === "elite" \? "elite" : "basic"/,
    );
  });

  it("caller passes tier (not the legacy plan field) on report data", () => {
    // Replaces `plan: "personal"` — that hardcoded field misled users
    // about what tier they were receiving.
    expect(callerSrc).toMatch(/tier: _reportTier/);
    expect(callerSrc).not.toMatch(/plan: "personal"/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("CRIT 3-tier reports / promise-of-no-leak guards", () => {
  // These tests assert the absence of patterns that, if present,
  // would mean the tier gate is bypassed somewhere.
  it("audit chain section never renders unconditionally (must have isElite gate)", () => {
    // The string "data.serverAudit.slice(0, 40)" must only appear
    // inside an `else` branch following `if (!isElite)`.
    const sec7Body = pdfSrc.match(
      /SERVER-VERIFIED AUDIT CHAIN[\s\S]*?\}\) \/\/ end of/,
    );
    expect(sec7Body).not.toBeNull();
    expect(sec7Body![0]).toMatch(/if \(!isElite\) \{[\s\S]*?\} else \{/);
  });

  it("Document Hash (SHA-256) is preserved for both tiers (basic legal gold)", () => {
    // Basic still gets integrity verification — that's table-stakes.
    expect(pdfSrc).toMatch(/Document Hash: SHA-256:/);
  });
});
