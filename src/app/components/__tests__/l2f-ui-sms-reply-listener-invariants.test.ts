// ═══════════════════════════════════════════════════════════════
// SOSphere — L2-F-UI: mobile-app sms_reply listener invariants
// ─────────────────────────────────────────────────────────────
// The L2-F backend (sos-sms-inbound) broadcasts inbound SMS
// replies on the SAME tenant-scoped Realtime channel that
// sos-alert uses. The mobile-app's active-SOS screen MUST
// subscribe during a live SOS so the user sees a contact's
// "ON MY WAY" reply within seconds.
//
// What this guards against:
//   • A refactor removing the supabase.channel subscription —
//     would silently break the two-way visibility (backend
//     still records, UI just stops surfacing)
//   • A refactor reverting to a global `sos-live` channel —
//     same W3-3 cross-tenant PHI regression risk as sos-alert
//   • A refactor dropping the messageSid dedupe — would
//     re-render the same reply on every Realtime reconnect
//   • A refactor dropping the emergencyId filter — would
//     show replies from a previous SOS on the current screen
//     (state bleed across sessions)
//   • A refactor subscribing during "starting" / "ended" phases
//     — wastes a Realtime connection and may attach to a stale
//     emergencyId
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let sosSrc = "";

beforeAll(() => {
  sosSrc = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/components/sos-emergency.tsx"),
    "utf8",
  );
});

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("L2-F-UI: state declarations", () => {
  it("declares smsReplies state array with the broadcast payload shape", () => {
    expect(sosSrc).toMatch(/const \[smsReplies,\s*setSmsReplies\]\s*=\s*useState</);
    // Each entry must carry the fields the backend broadcasts.
    // If the backend changes the payload shape, this list must change
    // in lockstep — that's the whole point of the invariant.
    for (const field of [
      "contactIndex",
      "contactName",
      "body",
      "isAck",
      "ackKeyword",
      "ts",
      "messageSid",
      "fromPhone",
    ]) {
      expect(sosSrc).toMatch(new RegExp(`\\b${field}:\\s*`));
    }
  });

  it("declares firstAckBanner state (first-ack-wins UX contract)", () => {
    expect(sosSrc).toMatch(/const \[firstAckBanner,\s*setFirstAckBanner\]\s*=\s*useState/);
    // The first-ack banner shape: { name, keyword }. Keyword may be null.
    expect(sosSrc).toMatch(/\{\s*name:\s*string;\s*keyword:\s*string \| null\s*\}/);
  });
});

describe("L2-F-UI: Realtime subscription", () => {
  it("subscribes to a supabase.channel inside a useEffect", () => {
    const code = stripComments(sosSrc);
    expect(code).toMatch(/supabase\.channel\(/);
    expect(code).toMatch(/\.on\(\s*["']broadcast["']\s*,\s*\{\s*event:\s*["']sms_reply["']/);
    expect(code).toMatch(/await ch\.subscribe\(\)/);
  });

  it("channel scoping matches sos-alert (tenant-scoped, never global)", () => {
    const code = stripComments(sosSrc);
    // B2B path: sos-live:<companyId>
    expect(code).toMatch(/`sos-live:\$\{companyId\}`/);
    // Civilian path: sos-live:civilian:<userId>
    expect(code).toMatch(/`sos-live:civilian:\$\{userId\}`/);
    // Anti-regression: bare `sos-live` channel is forbidden (PHI leak).
    expect(code).not.toMatch(/channel\(\s*["']sos-live["']\s*\)/);
  });

  it("subscription is gated to live SOS phases only (not starting / ended)", () => {
    const code = stripComments(sosSrc);
    // The phase allowlist must include the in-flight states and
    // EXCLUDE the boundary states. Test the array shape.
    expect(code).toMatch(/liveSet:\s*Phase\[\]\s*=\s*\[[^\]]*"calling"[^\]]*"no_answer"[^\]]*"answered"[^\]]*"recording"[^\]]*"monitoring"[^\]]*\]/);
    // starting + ended must NOT appear in the allowlist — the most
    // direct check is the early return on !liveSet.includes(phase).
    expect(code).toMatch(/if \(!liveSet\.includes\(phase\)\)\s*return/);
  });

  it("removes the channel on unmount (cleanup) — no leaked subscriptions", () => {
    const code = stripComments(sosSrc);
    expect(code).toMatch(/supabase\.removeChannel\(ch\)/);
    // The cleanup function must be returned from the useEffect.
    expect(code).toMatch(/return \(\) => \{[\s\S]{0,200}if \(cleanup\) cleanup\(\)/);
  });
});

describe("L2-F-UI: payload handling — filter + dedupe + ack", () => {
  it("filters incoming broadcasts by emergencyId (prevents cross-session bleed)", () => {
    const code = stripComments(sosSrc);
    // The handler must early-return when payload.emergencyId !=
    // errIdRef.current's emergencyId. The exact comparison string:
    expect(code).toMatch(/if \(!p \|\| p\.emergencyId !== emergencyId\)\s*return/);
  });

  it("dedupes by messageSid (idempotent on Realtime reconnect)", () => {
    const code = stripComments(sosSrc);
    expect(code).toMatch(/prev\.some\(\s*r\s*=>\s*r\.messageSid\s*===\s*entry\.messageSid\s*\)/);
  });

  it("first-ack-wins: firstAckBanner is set only by the FIRST ack", () => {
    const code = stripComments(sosSrc);
    // `prevBanner ?? { ... }` is the first-wins idiom — overrides
    // never happen once set.
    expect(code).toMatch(/setFirstAckBanner\(\(prevBanner\)\s*=>\s*prevBanner\s*\?\?\s*\{/);
  });

  it("toast fires on ack (operationally meaningful event surfacing)", () => {
    const code = stripComments(sosSrc);
    // The toast.success call is wrapped in try so a toast-system
    // failure doesn't crash the handler — pattern preserved.
    expect(code).toMatch(/if \(entry\.isAck\)[\s\S]{0,400}toast\.success/);
  });
});

describe("L2-F-UI: rendered banner — visible, dismissible-by-end-of-SOS", () => {
  it("renders firstAckBanner inside AnimatePresence (smooth in/out)", () => {
    expect(sosSrc).toMatch(/<AnimatePresence>[\s\S]{0,200}\{firstAckBanner\s*&&/);
  });

  it("banner is fixed-position at the top so it doesn't disrupt SOS UI", () => {
    expect(sosSrc).toMatch(/position:\s*["']fixed["']/);
    expect(sosSrc).toMatch(/top:\s*["']calc\(env\(safe-area-inset-top\)/);
  });

  it("banner is screen-reader announceable (assertive aria-live)", () => {
    expect(sosSrc).toMatch(/aria-live=["']assertive["']/);
    expect(sosSrc).toMatch(/role=["']status["']/);
  });

  it("displays the contact name and matched ack keyword", () => {
    expect(sosSrc).toMatch(/firstAckBanner\.name/);
    expect(sosSrc).toMatch(/firstAckBanner\.keyword/);
  });

  it("shows +N counter when more than one reply has arrived", () => {
    const code = stripComments(sosSrc);
    expect(code).toMatch(/smsReplies\.length\s*>\s*1[\s\S]{0,200}smsReplies\.length\s*-\s*1/);
  });
});
