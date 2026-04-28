// ═══════════════════════════════════════════════════════════════
// SOSphere — SAR demo-mode banner source-pinning (CRIT 2026-04-28)
// ─────────────────────────────────────────────────────────────
// Pins the safety-critical disclaimer rendered at the top of the
// SAR Protocol page. Discovery (2026-04-28): the entire SAR
// console (912 + 1856 lines) reads/writes localStorage only — it
// does NOT touch Supabase, has no fetch/API calls, and is not
// wired to any real rescue dispatch service. A dispatcher who
// presses "Send Rescue Team" affects nothing in the real world.
//
// The banner is the only thing standing between a trusting user
// and the false belief that help has been dispatched. If a
// future refactor:
//   • removes the banner entirely
//   • softens the headline copy
//   • drops the local-emergency-number guidance
//   • removes the data-testid hook
// …this test fails and the regression is caught in CI.
//
// Once the SAR engine is actually wired to live data + a real
// dispatch channel, this test (and the banner) can be retired
// together — but not before.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let pageSrc = "";
let engineSrc = "";

beforeAll(() => {
  const cwd = process.cwd();
  pageSrc = fs.readFileSync(
    path.resolve(cwd, "src/app/components/dashboard-sar-page.tsx"),
    "utf8",
  );
  engineSrc = fs.readFileSync(
    path.resolve(cwd, "src/app/components/sar-engine.ts"),
    "utf8",
  );
});

// ─────────────────────────────────────────────────────────────
describe("CRIT / SAR demo banner — required disclosure", () => {
  it("renders the banner element with stable testid", () => {
    expect(pageSrc).toMatch(/data-testid="sar-demo-mode-banner"/);
  });

  it("declares role='alert' for accessibility / screen readers", () => {
    // Screen readers must announce this — it's safety-critical.
    const bannerBlock = pageSrc.match(
      /data-testid="sar-demo-mode-banner"[\s\S]{0,500}/,
    );
    expect(bannerBlock).not.toBeNull();
    expect(bannerBlock![0]).toMatch(/role="alert"/);
  });

  it("contains the English headline 'NOT CONNECTED TO LIVE RESCUE SERVICES'", () => {
    // This wording is the legal disclosure. Do not soften.
    expect(pageSrc).toMatch(
      /NOT CONNECTED TO LIVE RESCUE SERVICES/,
    );
  });

  it("contains the Arabic translation 'وضع تدريبي'", () => {
    expect(pageSrc).toContain("وضع تدريبي");
    expect(pageSrc).toContain("لا تتصل بخدمات الإنقاذ الفعلية");
  });

  it("tells the user to dial real emergency numbers (911 / 999 / 112)", () => {
    expect(pageSrc).toMatch(/911 \/ 999 \/ 112/);
    expect(pageSrc).toMatch(/DIAL YOUR LOCAL EMERGENCY NUMBER/i);
  });

  it("explicitly states actions are local-only (do not reach real services)", () => {
    expect(pageSrc).toMatch(/saved locally/i);
    expect(pageSrc).toMatch(/do.*NOT.*reach/i);
  });

  it("PageHeader description mentions 'Demo / Training Mode'", () => {
    // Secondary backstop — even if the banner is hidden by CSS
    // somehow, the page title still carries the warning.
    expect(pageSrc).toMatch(
      /description="Search & Rescue.*Demo \/ Training Mode/,
    );
  });
});

// ─────────────────────────────────────────────────────────────
describe("CRIT / SAR engine — true wiring state (proves disclosure is necessary)", () => {
  // These tests document WHY the banner is necessary. If a future
  // PR wires SAR to Supabase + a real dispatch channel, these
  // tests will fail and the author MUST remove the banner in the
  // same PR (and update this test file).
  it("sar-engine.ts has zero supabase imports", () => {
    expect(engineSrc).not.toMatch(/supabase/i);
  });

  it("sar-engine.ts has zero fetch / API calls", () => {
    // Guards against accidental partial wiring.
    expect(engineSrc).not.toMatch(/\bfetch\(/);
  });

  it("sar-engine.ts persists to localStorage only", () => {
    // The engine is allowed to use localStorage (that's its current
    // contract), but if a fetch/supabase call appears alongside it,
    // the prior tests will fail and someone must reconcile.
    expect(engineSrc).toMatch(/localStorage/);
  });

  it("dashboard-sar-page.tsx has zero supabase / fetch calls (UI is read-only)", () => {
    // The UI layer must also stay disconnected until SAR is wired
    // end-to-end. Ad-hoc fetch from this page is a regression.
    expect(pageSrc).not.toMatch(/supabase/i);
    expect(pageSrc).not.toMatch(/\bfetch\(/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("CRIT / SAR demo banner — visual prominence", () => {
  it("banner has high-contrast border (alert color)", () => {
    // 2px solid #FF2D55 is the visual contract; if a future tweak
    // tones it down to a hairline, the disclosure loses prominence.
    const bannerBlock = pageSrc.match(
      /data-testid="sar-demo-mode-banner"[\s\S]{0,2000}/,
    );
    expect(bannerBlock).not.toBeNull();
    expect(bannerBlock![0]).toMatch(/border:\s*"2px solid #FF2D55"/);
  });

  it("banner cannot be dismissed (no onClick close handler near testid)", () => {
    // Sticky / non-dismissible by design. Search for any "close" or
    // "dismiss" word within ~1500 chars of the banner block.
    const bannerBlock = pageSrc.match(
      /data-testid="sar-demo-mode-banner"[\s\S]{0,1500}/,
    );
    expect(bannerBlock).not.toBeNull();
    expect(bannerBlock![0]).not.toMatch(/onClick.*set.*Banner.*false/i);
    expect(bannerBlock![0]).not.toMatch(/dismiss/i);
  });
});
