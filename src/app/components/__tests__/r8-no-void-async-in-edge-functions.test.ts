// ═══════════════════════════════════════════════════════════════
// R-8 (2026-05-14) — no fire-and-forget void-async in edge functions
// ─────────────────────────────────────────────────────────────
// LOCKED CONTRACT
//   No Deno Edge Function source file may contain a `void (async () => {})()`
//   block. The Deno isolate is eligible for termination as soon as the
//   request handler returns, so any pending background promise inside such
//   a block is silently dropped. R-4b discovered this caused the L2-B
//   dispatch_attempts ledger to lose every row in production.
//
//   Approved replacements:
//     - synchronous `await` for DB writes (fast, must persist)
//     - `await backgroundOrAwait(promise)` for external HTTP calls
//       (extends worker lifetime via EdgeRuntime.waitUntil when available,
//        falls back to await otherwise — never silently drops work)
//
//   This invariant prevents the regression from re-entering the codebase
//   on any future deploy. Comments referencing the pattern (e.g. in
//   R-4b / R-8 retrospectives) are allowed; only ACTUAL executable
//   `void (async ...)` is forbidden.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const FUNCTIONS_DIR = path.resolve(process.cwd(), "supabase/functions");

function listEdgeFunctionFiles(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "index.ts") out.push(full);
    }
  }
  walk(FUNCTIONS_DIR);
  return out;
}

function stripCommentsAndStrings(src: string): string {
  // Remove single-line // comments
  let s = src.replace(/^\s*\/\/.*$/gm, "");
  // Remove block /* ... */ comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove template literals (they often contain backticks/quotes with
  // example patterns inside, e.g. the dispatch-probe documentation strings).
  s = s.replace(/`[^`]*`/g, "");
  // Remove double-quoted strings
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""');
  // Remove single-quoted strings
  s = s.replace(/'(?:\\.|[^'\\])*'/g, "''");
  return s;
}

describe("R-8: no `void (async () => {})()` in edge function source code", () => {
  const files = listEdgeFunctionFiles();

  it("at least one edge function index.ts exists (sanity)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    const rel = path.relative(process.cwd(), f);
    it(`${rel}: no executable void-async IIFE`, () => {
      const raw = fs.readFileSync(f, "utf8");
      const code = stripCommentsAndStrings(raw);
      // After stripping comments + strings, no `void (async` should remain.
      const found = code.match(/void\s*\(\s*async\s*\(/g) || [];
      expect(found, `${rel} still has ${found.length} void-async block(s); use backgroundOrAwait() instead`).toEqual([]);
    });
  }
});

describe("R-8: backgroundOrAwait helper exists in _shared", () => {
  it("helper module is present", () => {
    const p = path.resolve(process.cwd(), "supabase/functions/_shared/background-work.ts");
    expect(fs.existsSync(p)).toBe(true);
  });

  it("exports backgroundOrAwait + uses EdgeRuntime.waitUntil with await fallback", () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/functions/_shared/background-work.ts"),
      "utf8",
    );
    expect(src).toMatch(/export async function backgroundOrAwait/);
    expect(src).toMatch(/EdgeRuntime/);
    expect(src).toMatch(/waitUntil/);
    // Must have an await fallback so unsupported runtimes don't drop work
    expect(src).toMatch(/await promise/);
  });
});

describe("R-8: sos-alert imports + calls backgroundOrAwait at the converted sites", () => {
  const SOS_ALERT = path.resolve(process.cwd(), "supabase/functions/sos-alert/index.ts");
  let src = "";
  it("file is readable", () => {
    expect(fs.existsSync(SOS_ALERT)).toBe(true);
    src = fs.readFileSync(SOS_ALERT, "utf8");
    expect(src.length).toBeGreaterThan(1000);
  });

  it("imports backgroundOrAwait from _shared", () => {
    src = src || fs.readFileSync(SOS_ALERT, "utf8");
    expect(src).toMatch(/import\s*\{\s*backgroundOrAwait\s*\}\s*from\s*["']\.\.\/_shared\/background-work\.ts["']/);
  });

  it("contains at least two `await backgroundOrAwait((async () => {` call sites (the two push blocks)", () => {
    src = src || fs.readFileSync(SOS_ALERT, "utf8");
    // The two push blocks (self-confirm + owner fan-out) were both
    // converted from `void (async () => {})()` in R-8. We don't pin to
    // the specific block contents (they're large) — we just assert that
    // exactly two backgroundOrAwait IIFE call sites exist. Combined with
    // the "no void (async" invariant above, this proves both blocks were
    // converted (not just one of them).
    const matches = src.match(/await backgroundOrAwait\(\(async \(\) => \{/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("the self-confirm push and owner fan-out comment anchors both still exist", () => {
    src = src || fs.readFileSync(SOS_ALERT, "utf8");
    expect(src).toMatch(/self-confirm push/);
    expect(src).toMatch(/owner fan-out/);
  });
});
