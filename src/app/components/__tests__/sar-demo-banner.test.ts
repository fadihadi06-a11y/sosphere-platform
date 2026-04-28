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

  it("dashboard-sar-page.tsx only touches Supabase via the audit RPC", () => {
    // 2026-04-28 evolution:
    //   • #48 Enhancement B added a direct .from("audit_log").insert
    //   • Beehive audit #2 caught that GRANT + RLS block direct INSERT
    //     on audit_log from authenticated → silent fail
    //   • Fix: route through log_sos_audit RPC (SECURITY DEFINER, the
    //     same path sos-alert uses)
    //
    // The page now should have ZERO direct .from() calls — all
    // server reach goes through the SECDEF RPC. Anything else
    // (a SELECT for employees, a sos_outbox push, a fetch for live
    // GPS) would be the start of real wiring and should remove the
    // demo banner first.
    expect(pageSrc).toMatch(
      /import \{ supabase \} from "\.\/api\/supabase-client"/,
    );
    // No direct .from() table reach.
    // CRITICAL: strip single-line and block comments BEFORE counting,
    // otherwise documentation that mentions the legacy pattern (e.g.
    // "the previous version did supabase.from(\"audit_log\")...")
    // would falsely fail this assertion.
    const codeOnly = pageSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")  // strip /* ... */
      .replace(/\/\/.*$/gm, "");              // strip // ...
    const fromMatches = codeOnly.match(/\.from\("[a-z_]+"\)/g) || [];
    expect(fromMatches.length).toBe(0);
    // The RPC call is the only Supabase reach.
    expect(pageSrc).toMatch(/supabase\.rpc\("log_sos_audit"/);
    // No raw fetch() either (also comment-stripped).
    expect(codeOnly).not.toMatch(/\bfetch\(/);
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

// ─────────────────────────────────────────────────────────────
// #48 SAR enhancements (2026-04-28) — Toggle + audit_log entry.
// ─────────────────────────────────────────────────────────────

describe("#48 SAR Enhancement A / Live<->Training mode toggle", () => {
  it("renders the toggle with stable testid", () => {
    expect(pageSrc).toMatch(/data-testid="sar-mode-toggle"/);
  });

  it("Training button is the active one (aria-pressed=true)", () => {
    // Pin the contract: Training is selected, Live is not.
    expect(pageSrc).toMatch(/aria-pressed="true"[\s\S]*?Training/);
  });

  it("Live button is disabled with explanatory tooltip", () => {
    expect(pageSrc).toMatch(/aria-disabled="true"/);
    expect(pageSrc).toMatch(/Live \(coming soon\)/);
    // The title attribute documents what wiring is missing — pinning
    // it ensures a future engineer reads the contract before flipping
    // Live to enabled.
    expect(pageSrc).toMatch(/gps_trail subscription[\s\S]*?sos_outbox dispatch[\s\S]*?Twilio bridge/);
  });

  it("Live button uses Lock icon (visual cue for the disabled state)", () => {
    // Source-pinning: the Lock icon makes the disabled state obvious
    // even at a glance. Replacing it with a non-lock icon would soften
    // the gate and is exactly the kind of visual regression we guard.
    const liveBtnBlock = pageSrc.match(
      /aria-disabled="true"[\s\S]{0,1500}/,
    );
    expect(liveBtnBlock).not.toBeNull();
    expect(liveBtnBlock![0]).toMatch(/<Lock /);
  });

  it("toggle is positioned BEFORE the PageHeader (above the page title)", () => {
    const toggleIdx = pageSrc.indexOf('data-testid="sar-mode-toggle"');
    const headerIdx = pageSrc.indexOf("<PageHeader");
    expect(toggleIdx).toBeGreaterThan(0);
    expect(toggleIdx).toBeLessThan(headerIdx);
  });
});

describe("#48 SAR Enhancement B / audit_log entry on scenario load", () => {
  it("imports the supabase client", () => {
    expect(pageSrc).toMatch(
      /import \{ supabase \} from "\.\/api\/supabase-client"/,
    );
  });

  it("handleStartMission writes an sar_training_session audit via RPC", () => {
    // Beehive fix (2026-04-28): direct INSERT on audit_log is blocked
    // by GRANT + RLS for authenticated. The training audit goes through
    // the log_sos_audit SECURITY DEFINER RPC (same path sos-alert uses).
    const handlerBlock = pageSrc.match(
      /handleStartMission = useCallback[\s\S]*?\}, \[\]\);/,
    );
    expect(handlerBlock).not.toBeNull();
    expect(handlerBlock![0]).toMatch(/supabase\.rpc\("log_sos_audit"/);
    expect(handlerBlock![0]).toMatch(/p_action:\s*"sar_training_session"/);
    expect(handlerBlock![0]).toMatch(/p_actor_level:\s*"dispatcher"/);
    expect(handlerBlock![0]).toMatch(/p_operation:\s*"LOAD_SCENARIO"/);
  });

  it("audit metadata captures scenario context (name, zone, terrain)", () => {
    const handlerBlock = pageSrc.match(
      /handleStartMission = useCallback[\s\S]*?\}, \[\]\);/,
    );
    expect(handlerBlock).not.toBeNull();
    expect(handlerBlock![0]).toMatch(/employee_name: scenario\.employeeName/);
    expect(handlerBlock![0]).toMatch(/zone:\s*scenario\.zone/);
    expect(handlerBlock![0]).toMatch(/terrain:\s*scenario\.terrain/);
    expect(handlerBlock![0]).toMatch(/mode:\s*"training"/);
    // Preserves the legacy `category` semantic in the metadata blob
    // even though the RPC writes the row with its own category column.
    expect(handlerBlock![0]).toMatch(/category:\s*"training"/);
  });

  it("audit write is fire-and-forget (try/catch + no await blocking)", () => {
    // The audit write MUST NOT block the UI — a failed insert becomes
    // a console warning but the mission still launches. Pinning the
    // try/catch prevents a regression that re-throws and breaks the
    // happy path.
    const handlerBlock = pageSrc.match(
      /handleStartMission = useCallback[\s\S]*?\}, \[\]\);/,
    );
    expect(handlerBlock).not.toBeNull();
    expect(handlerBlock![0]).toMatch(/void \(async \(\) =>/);
    expect(handlerBlock![0]).toMatch(/try \{/);
    expect(handlerBlock![0]).toMatch(/catch \(err\)/);
    expect(handlerBlock![0]).toMatch(/console\.warn/);
  });
});
