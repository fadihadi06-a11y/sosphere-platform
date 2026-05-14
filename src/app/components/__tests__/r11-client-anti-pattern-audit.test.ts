// ═══════════════════════════════════════════════════════════════
// R-11 (2026-05-14) — client-side anti-pattern audit
// ─────────────────────────────────────────────────────────────
// SISTER OF R-9, BUT FOR BROWSER CODE
//   R-9 audited supabase/functions/*/index.ts for isolation-lifetime
//   bugs (void async, empty try-catch). Browser code doesn't have
//   the same isolate-termination problem — long-lived isolates make
//   void async safe — but it has its own foot-guns:
//
//     - setInterval without clearInterval in useEffect cleanup
//     - addEventListener without removeEventListener
//     - supabase.channel().subscribe() without removeChannel() on unmount
//     - voiceCallEngine.subscribe() without unsub() on unmount
//     - localStorage in render path (SSR / hydration breakage)
//     - async work in component body (race conditions on remount)
//
// AUDIT METHODOLOGY (executed 2026-05-14)
//   Swept all src/app/components/**/*.tsx, classifying findings as:
//     - SAFE (singleton module-init listener, idempotent guard)
//     - SAFE (useEffect cleanup explicitly removes)
//     - LEAK (resource allocated, no cleanup path on unmount)
//
// FINDINGS
//   - setInterval coverage:   clean in production tsx (only tests use it)
//   - window/document addEventListener: 2 module-init singletons in api/
//     (authenticated-role.ts, tenant.ts) — safe, guarded
//   - supabase.channel():    sos-emergency.tsx + dashboard-jobs-page.tsx
//                            both have proper cleanup. CLEAN.
//   - voiceCallEngine.subscribe(): admin-incoming-call.tsx has TWO
//                                  components that subscribe but only
//                                  unsubscribe in event handlers — if
//                                  the admin navigated away mid-call,
//                                  the subscription leaked. FIXED with
//                                  dedicated unmount-only useEffect.
//   - localStorage in render: NONE found
//   - async in render body:   NONE found
//
// THIS TEST FILE
//   Locks the patterns so any future regression triggers a contract
//   failure before reaching CI:
//     1. No setInterval without clearInterval in production .tsx
//     2. No window.addEventListener without removeEventListener in .tsx
//     3. admin-incoming-call.tsx has unmount cleanup for voiceUnsubRef
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const COMPONENTS_DIR = path.resolve(process.cwd(), "src/app/components");

function listTsxFiles(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      // Skip __tests__ — test files use timers freely
      if (entry.name === "__tests__") continue;
      // Skip workers — they have their own lifecycle
      if (entry.name === "workers") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx")) out.push(full);
    }
  }
  walk(COMPONENTS_DIR);
  return out;
}

function stripCommentsAndStrings(src: string): string {
  let s = src.replace(/^\s*\/\/.*$/gm, "");
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/`[^`]*`/g, "");
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""');
  s = s.replace(/'(?:\\.|[^'\\])*'/g, "''");
  return s;
}

describe("R-11: every .tsx with setInterval also has clearInterval", () => {
  for (const f of listTsxFiles()) {
    const rel = path.relative(process.cwd(), f);
    const raw = fs.readFileSync(f, "utf8");
    const code = stripCommentsAndStrings(raw);
    const setCount = (code.match(/\bsetInterval\s*\(/g) || []).length;
    if (setCount === 0) continue; // skip files that don't use setInterval
    it(`${rel}: setInterval is balanced by clearInterval`, () => {
      const clearCount = (code.match(/\bclearInterval\s*\(/g) || []).length;
      expect(
        clearCount,
        `${rel}: setInterval=${setCount} but clearInterval=${clearCount} (missing cleanup risks memory leak)`,
      ).toBeGreaterThanOrEqual(setCount);
    });
  }
});

describe("R-11: every .tsx with window/document.addEventListener also removes it", () => {
  for (const f of listTsxFiles()) {
    const rel = path.relative(process.cwd(), f);
    const raw = fs.readFileSync(f, "utf8");
    const code = stripCommentsAndStrings(raw);
    const addCount = (code.match(/\b(window|document)\.addEventListener\b/g) || []).length;
    if (addCount === 0) continue;
    it(`${rel}: addEventListener is balanced by removeEventListener`, () => {
      const rmCount = (code.match(/\b(window|document)\.removeEventListener\b/g) || []).length;
      expect(
        rmCount,
        `${rel}: addEventListener=${addCount} but removeEventListener=${rmCount} (leaks listener on unmount)`,
      ).toBeGreaterThanOrEqual(addCount);
    });
  }
});

describe("R-11: admin-incoming-call.tsx has unmount-only cleanup for voiceUnsubRef", () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/components/admin-incoming-call.tsx"),
    "utf8",
  );

  it("IncomingCallOverlay: dedicated unmount useEffect calls voiceUnsubRef.current()", () => {
    // The fix pattern: `useEffect(() => () => { if (voiceUnsubRef.current) ...; }, [])`
    // (an effect that returns ONLY a cleanup function and has an empty dep array
    // — fires exactly once at unmount).
    const matches = src.match(
      /useEffect\(\(\)\s*=>\s*\(\)\s*=>\s*\{\s*if\s*\(voiceUnsubRef\.current\)\s*\{\s*voiceUnsubRef\.current\(\);\s*voiceUnsubRef\.current\s*=\s*null;?\s*\}\s*\},\s*\[\]\)/g,
    ) || [];
    // Two separate components share the pattern — assert AT LEAST TWO call sites.
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("R-11: useEffect cleanup return is always inside the effect body", () => {
  // Spot-check: sos-emergency.tsx is the highest-stakes file with multiple
  // subscriptions inside useEffect. Make sure its supabase.channel + voice
  // subscriptions are both released.
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/components/sos-emergency.tsx"),
    "utf8",
  );

  it("sos-emergency.tsx releases supabase.channel via removeChannel", () => {
    expect(src).toMatch(/supabase\.removeChannel/);
  });

  it("sos-emergency.tsx releases voiceCallEngine subscription via unsubVoice()", () => {
    expect(src).toMatch(/unsubVoice\(\)/);
  });
});
