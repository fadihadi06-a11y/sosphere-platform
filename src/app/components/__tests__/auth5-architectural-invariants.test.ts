// ═══════════════════════════════════════════════════════════════
// SOSphere — AUTH-5 architectural invariants (FOUNDATION-3)
// ─────────────────────────────────────────────────────────────
// Locks in five contracts so a future refactor cannot silently
// regress the foundation we built in AUTH-5 P1-P6 + CRIT #164 +
// the toggle motion.div fix.
//
// Why this style (file-grep over importing + executing): much of
// AUTH-5 lives in client wrappers and React components that import
// from the supabase-js client, the React tree, motion/react, and
// jsPDF. Standing those up in vitest would require a full jsdom
// + mock harness for every test — overkill for the kind of
// invariants we're locking in. File-grep tests prove the source
// matches the architectural contract; behavioural tests can bolt
// on later in a jsdom config.
//
// Pinned contracts:
//   1. ERROR-MESSAGE MAP — friendlyTrialReason + friendlyDpaReason
//      translate every server-reason we expect into human English.
//   2. DPA_VERSION SYNC — the constant appears identically in
//      dpa-page.tsx, company-register.tsx, AND the SQL migration
//      bumping current_dpa_version().
//   3. TOGGLE FIX — every motion.div with `animate={{ x: <bool>...
//      ?16:0 }}` shape has `initial={false}` so the dot doesn't
//      oscillate (the bug we just fixed across 10 sites).
//   4. MOCK-DATA DEV GATE — every MOCK_* fallback in the 7 surfaces
//      cleaned by CRIT #164 is gated on import.meta.env.DEV (or
//      consumed via a DEV-gated alias like ACTIVITY_FALLBACK).
//   5. RPC SIGNATURE PINS — the AUTH-5 P1 RPCs we depend on must
//      keep their argument names + return shape; client wrappers
//      assert on specific JSON keys (success, has_signature, etc.)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const READ = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

let companySubClient = "";
let dpaPage          = "";
let companyRegister  = "";
let dpaSettings      = "";
let trialBanner      = "";
let liveBilling      = "";
let migrationP5      = "";
let migrationP6Bump  = "";
let dashSettings     = "";
let emergencyPb      = "";
let pdfEmail         = "";
let pdfPassword      = "";
let settingsScreens  = "";
let buddySys         = "";
let employeeDetail   = "";
let batchEmail       = "";
let offlinePage      = "";
let dashNotif        = "";
let dashPages        = "";
let incidentInv      = "";

beforeAll(() => {
  const C = "src/app/components";
  companySubClient = READ(`${C}/api/company-subscription-client.ts`);
  dpaPage          = READ(`${C}/dpa-page.tsx`);
  companyRegister  = READ(`${C}/company-register.tsx`);
  dpaSettings      = READ(`${C}/dpa-settings-section.tsx`);
  trialBanner      = READ(`${C}/trial-banner-live.tsx`);
  liveBilling      = READ(`${C}/live-billing-panel.tsx`);
  migrationP5      = READ("supabase/migrations/20260507000000_auth5_p5_get_dpa_acceptance_rpc.sql");
  migrationP6Bump  = READ("supabase/migrations/20260507010000_auth5_p5_bump_dpa_version.sql");
  dashSettings     = READ(`${C}/dashboard-settings-page.tsx`);
  emergencyPb      = READ(`${C}/emergency-playbook.tsx`);
  pdfEmail         = READ(`${C}/pdf-email-modal.tsx`);
  pdfPassword      = READ(`${C}/pdf-password-modal.tsx`);
  settingsScreens  = READ(`${C}/settings-screens.tsx`);
  buddySys         = READ(`${C}/buddy-system.tsx`);
  employeeDetail   = READ(`${C}/dashboard-employee-detail.tsx`);
  batchEmail       = READ(`${C}/batch-email-scheduler.tsx`);
  offlinePage      = READ(`${C}/dashboard-offline-page.tsx`);
  dashNotif        = READ(`${C}/dashboard-notifications-panel.tsx`);
  dashPages        = READ(`${C}/dashboard-pages.tsx`);
  incidentInv      = READ(`${C}/dashboard-incident-investigation.tsx`);
});

// ─── 1. ERROR-MESSAGE MAP ────────────────────────────────────────
describe("AUTH-5: friendly error message map (company-subscription-client)", () => {
  it("maps every expected cancel-trial reason to human English", () => {
    // The server returns these reasons via cancel_company_trial; the
    // client wrapper MUST translate them so the UI never shows a raw
    // database string. If we add a new reason server-side, this test
    // fails until the client mapping catches up.
    const expected = [
      "unauthorized",
      "not_owner",
      "no_active_trial_to_cancel",
    ];
    for (const reason of expected) {
      expect(companySubClient).toContain(`case "${reason}":`);
    }
  });

  it("maps every expected DPA-acceptance reason to human English", () => {
    const expected = [
      "unauthorized",
      "not_owner",
      "invalid_signer_name",
      "invalid_signer_title",
      "invalid_version",
    ];
    for (const reason of expected) {
      expect(companySubClient).toContain(`case "${reason}":`);
    }
  });

  it("never returns a raw 'reason' string without a friendly fallback", () => {
    // Both helpers MUST end with `default: return reason || ...` so an
    // unrecognized reason gets a generic fallback rather than crashing.
    expect(companySubClient).toMatch(/friendlyTrialReason[\s\S]*?default:[\s\S]*?return reason \|\|/);
    expect(companySubClient).toMatch(/friendlyDpaReason[\s\S]*?default:[\s\S]*?return reason \|\|/);
  });
});

// ─── 2. DPA_VERSION SYNC ─────────────────────────────────────────
describe("AUTH-5 P5/P6: DPA_VERSION constant must stay in sync everywhere", () => {
  it("dpa-page.tsx pins DPA_VERSION = '2026-05-07'", () => {
    expect(dpaPage).toContain('const DPA_VERSION = "2026-05-07"');
  });

  it("company-register.tsx pins DPA_VERSION = '2026-05-07'", () => {
    expect(companyRegister).toContain('const DPA_VERSION = "2026-05-07"');
  });

  it("server migration bumps current_dpa_version() to '2026-05-07'", () => {
    expect(migrationP6Bump).toContain("'2026-05-07'");
    expect(migrationP6Bump).toContain("current_dpa_version()");
  });

  it("get_dpa_acceptance migration uses current_dpa_version() as the default", () => {
    // The RPC defaults to NULL on p_dpa_version and resolves to
    // current_dpa_version() inside the body — that's the contract the
    // client wrappers depend on.
    expect(migrationP5).toContain("p_dpa_version text DEFAULT NULL");
    expect(migrationP5).toContain("current_dpa_version()");
  });
});

// ─── 3. TOGGLE FIX (initial={false}) ─────────────────────────────
describe("Toggle motion.div fix: every boolean toggle has initial={false}", () => {
  // Each tuple: (file label, source string, count of toggle motion.divs
  // we expect to find with initial={false} pre-pended).
  const cases: { file: string; src: () => string; expected: number }[] = [
    { file: "dashboard-settings-page.tsx", src: () => dashSettings,    expected: 6 }, // +1 MobileMFAControl toggle
    { file: "emergency-playbook.tsx",      src: () => emergencyPb,     expected: 1 },
    { file: "pdf-email-modal.tsx",         src: () => pdfEmail,        expected: 1 },
    { file: "pdf-password-modal.tsx",      src: () => pdfPassword,     expected: 2 },
    { file: "settings-screens.tsx",        src: () => settingsScreens, expected: 1 },
  ];

  it.each(cases)(
    "$file has $expected toggle motion.divs each guarded by initial={false}",
    ({ src, expected }) => {
      // Match: <motion.div initial={false} animate={{ x: <expr> ? <n1> : <n2> }}
      const pattern =
        /<motion\.div\s+initial=\{false\}\s+animate=\{\{\s*x:\s*[^?]+\?\s*\d+\s*:\s*\d+\s*\}\}/g;
      const matches = src().match(pattern) ?? [];
      expect(matches.length).toBe(expected);
    },
  );

  it("no toggle motion.div remains unguarded (would re-oscillate on re-render)", () => {
    // Negative check: scan all 5 files for `<motion.div animate={{ x: <bool>?N:N }}`
    // WITHOUT a preceding initial={false}. Should be zero — every toggle
    // pattern was migrated.
    const allSources = [dashSettings, emergencyPb, pdfEmail, pdfPassword, settingsScreens].join("\n");
    const unguarded = allSources.match(
      /<motion\.div\s+animate=\{\{\s*x:\s*[^?]+\?\s*\d+\s*:\s*\d+\s*\}\}/g,
    ) ?? [];
    expect(unguarded.length).toBe(0);
  });
});

// ─── 4. MOCK-DATA DEV GATE (CRIT #164) ───────────────────────────
describe("CRIT #164: every MOCK_* fallback is DEV-gated in production-bound surfaces", () => {
  // Each tuple: (file label, source) — every MOCK_ reference in the
  // file MUST appear in a context that's DEV-gated. We assert by
  // requiring the file to BOTH contain MOCK_ AND contain
  // `import.meta.env.DEV`. This is a coarse but catches the regression
  // we care about — someone removing the env.DEV guard but leaving the
  // MOCK_ array.
  const surfaces: { file: string; src: () => string }[] = [
    { file: "dashboard-notifications-panel.tsx", src: () => dashNotif },
    { file: "dashboard-pages.tsx",               src: () => dashPages },
    { file: "dashboard-incident-investigation.tsx", src: () => incidentInv },
    { file: "buddy-system.tsx",                  src: () => buddySys },
    { file: "dashboard-employee-detail.tsx",     src: () => employeeDetail },
    { file: "batch-email-scheduler.tsx",         src: () => batchEmail },
    { file: "dashboard-offline-page.tsx",        src: () => offlinePage },
  ];

  it.each(surfaces)("$file has MOCK_ refs gated by import.meta.env.DEV", ({ src }) => {
    const s = src();
    expect(s).toMatch(/MOCK_/);
    expect(s).toMatch(/import\.meta\.env\.DEV/);
  });

  it("offline-page guards 3 divide-by-zero spots when fleet is empty", () => {
    // If DISPLAY_FLEET is [] in production, NaN must not leak to the UI.
    expect(offlinePage).toContain("DISPLAY_FLEET.length > 0");
    expect(offlinePage).toContain("DISPLAY_FLEET.length === 0");
    expect(offlinePage).toContain("DISPLAY_SYNC_HISTORY.length > 0");
  });
});

// ─── 5. RPC SIGNATURE PINS ───────────────────────────────────────
describe("AUTH-5 P1/P5: client wrappers assert on the contract keys we depend on", () => {
  it("company-subscription-client maps server snake_case → client camelCase", () => {
    // The server returns has_subscription / is_owner / dpa_accepted etc.
    // The client mapping MUST translate them. If a server reshape
    // happens, this test surfaces which keys to update.
    const expectedServerKeys = [
      "has_subscription",
      "is_owner",
      "billing_cycle",
      "trial_ends_at",
      "current_period_end",
      "days_left_in_trial",
      "dpa_version",
      "dpa_accepted",
      "stripe_customer_id",
    ];
    for (const k of expectedServerKeys) {
      expect(companySubClient).toContain(k);
    }
  });

  it("dpa-settings-section uses the parallel get_dpa_acceptance + state RPCs", () => {
    expect(dpaSettings).toContain("get_dpa_acceptance");
    expect(dpaSettings).toContain("get_company_subscription_state");
    // Auto-open via localStorage flag must be in place — it's how the
    // banner→settings deep-link works.
    expect(dpaSettings).toContain("sosphere_dpa_renewal_intent");
  });

  it("trial-banner-live + live-billing-panel both consume CompanySubscriptionState", () => {
    expect(trialBanner).toContain("getCompanySubscriptionState");
    expect(liveBilling).toContain("getCompanySubscriptionState");
    // Both files mount via companyId from localStorage (per dashboard wiring)
    expect(trialBanner).toContain("companyId");
    expect(liveBilling).toContain("companyId");
  });
});
