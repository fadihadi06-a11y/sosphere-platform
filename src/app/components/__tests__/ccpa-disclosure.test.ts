// ═══════════════════════════════════════════════════════════════
// SOSphere — CCPA / CPRA disclosure source-pinning (Phase 4)
// ─────────────────────────────────────────────────────────────
// Pins the legally-required CCPA / CPRA disclosure section that
// surfaces on /privacy for California-resident users (and anyone
// else who scrolls down). Per Cal. Civ. Code § 1798.100 et seq:
//
//   1. Notice at Collection — categories of PI we hold
//   2. Right to Know
//   3. Right to Delete
//   4. Right to Correct
//   5. Right to Limit Use of Sensitive PI (GPS qualifies)
//   6. Right to Non-Discrimination
//   7. Right to Opt-Out of sale / sharing
//
// + an affirmative "we do not sell or share" statement, since we
// don't, and a contact channel that mentions "CCPA Request" plus
// the 45-day response window.
//
// If a future PR removes any of these or softens the language,
// this test fails and the regression is caught in CI.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let pageSrc = "";

beforeAll(() => {
  const cwd = process.cwd();
  pageSrc = fs.readFileSync(
    path.resolve(cwd, "src/app/components/privacy-page.tsx"),
    "utf8",
  );
});

describe("Phase 4 / CCPA disclosure — required block", () => {
  it("renders the CCPA section with stable testid", () => {
    expect(pageSrc).toMatch(/data-testid="ccpa-disclosure-section"/);
  });

  it("CcpaSection is mounted in the page (above DataExportSection)", () => {
    const ccpaIdx = pageSrc.indexOf("<CcpaSection />");
    const exportIdx = pageSrc.indexOf("<DataExportSection />");
    expect(ccpaIdx).toBeGreaterThan(0);
    expect(exportIdx).toBeGreaterThan(0);
    expect(ccpaIdx).toBeLessThan(exportIdx);
  });

  it("uses the bilingual heading (Arabic + 'CCPA / CPRA Notice')", () => {
    expect(pageSrc).toContain("CCPA / CPRA Notice");
    expect(pageSrc).toContain("سكان كاليفورنيا");
  });
});

describe("Phase 4 / CCPA disclosure — 7 enumerated rights", () => {
  it("Right to Know is mentioned", () => {
    expect(pageSrc).toMatch(/Right to Know/);
  });
  it("Right to Delete is mentioned", () => {
    expect(pageSrc).toMatch(/Right to Delete/);
  });
  it("Right to Correct is mentioned", () => {
    expect(pageSrc).toMatch(/Right to Correct/);
  });
  it("Right to Limit Use of Sensitive PI is mentioned (GPS)", () => {
    expect(pageSrc).toMatch(/Right to Limit Use of Sensitive PI/);
  });
  it("Right to Non-Discrimination is mentioned", () => {
    expect(pageSrc).toMatch(/Right to Non-Discrimination/);
  });
  it("Right to Opt-Out is mentioned", () => {
    expect(pageSrc).toMatch(/Right to Opt-Out/);
  });
});

describe("Phase 4 / CCPA disclosure — affirmative no-sale statement", () => {
  it("contains the explicit English 'do not sell or share' statement", () => {
    // CCPA permits the simpler disclosure when a business genuinely does
    // not sell. Pinning the wording prevents a later regression that
    // changes the meaning if business model evolves.
    expect(pageSrc).toMatch(
      /We do not sell or share your personal information/,
    );
  });

  it("contains the Arabic mirror statement", () => {
    expect(pageSrc).toContain("لا نبيع بياناتك");
  });
});

describe("Phase 4 / CCPA disclosure — contact channel + SLA", () => {
  it("instructs users to email with subject line 'CCPA Request'", () => {
    expect(pageSrc).toMatch(/CCPA Request/);
    expect(pageSrc).toContain("sosphere.support@gmail.com");
  });

  it("states the 45-day statutory response window", () => {
    expect(pageSrc).toMatch(/٤٥ يوماً|45 days|45-day/);
  });
});
