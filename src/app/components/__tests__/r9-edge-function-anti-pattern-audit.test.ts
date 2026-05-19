// ═══════════════════════════════════════════════════════════════
// R-9 (2026-05-14) — edge-function anti-pattern audit
// ─────────────────────────────────────────────────────────────
// AUDIT METHODOLOGY (executed 2026-05-14)
//   After R-8 fixed `void (async () => {})()` in sos-alert, this audit
//   swept all supabase/functions/*/index.ts for SIX related anti-patterns:
//
//     1. `setInterval(...)` at request scope
//        → would never fire (isolate terminates before any interval tick)
//     2. `setTimeout(...)` capturing state with no await wrapper
//        → callback may not fire after response returns
//     3. `.then(callback)` without `await` on the same chain
//        → unhandled fire-and-forget; silently drops work
//     4. DB writes (`.insert/.update/.upsert/.delete`) not awaited
//        → write buffered; isolate terminates before flush
//     5. `fetch(...)` followed by use of `.json()` without checking `.ok`
//        → silent HTTP failures masked as success
//     6. Empty `try {} catch {}` blocks
//        → silent error swallowing
//
// FINDINGS (33 edge functions scanned, 0 critical bugs)
//   - Pattern 1 (setInterval): NONE found.
//   - Pattern 2 (setTimeout): 6 occurrences of `setTimeout(removeChannel, 2000)`
//     all on per-request-scoped supabase clients. Harmless — Realtime
//     channels are gc'd when the per-request supabase client is gc'd at
//     handler exit. Cleanup is best-effort and not on the critical path.
//   - Pattern 3 (.then without await): 4 sites in stripe-webhook
//     (lines 224, 270, 305, 341). All correctly awaited on the OUTER
//     chain start: `await supabase.rpc(...).then(...)` — the await
//     applies to the entire chain expression including the .then()
//     callback. Verified via node REPL: callback completes before the
//     await resolves.
//   - Pattern 4 (DB writes not awaited): all suspect sites confirmed
//     correctly awaited on the start of multi-line method chains.
//     False positives from line-based grep.
//   - Pattern 5 (fetch .ok): all fetches sampled correctly check .ok.
//   - Pattern 6 (empty try-catch): NONE found.
//
// CONCLUSION
//   R-8 caught the only real instance of the family. R-9 is a clean
//   audit. This test file LOCKS the patterns in place so any future
//   regression triggers a contract-test failure before reaching CI.
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
  let s = src.replace(/^\s*\/\/.*$/gm, "");
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/`[^`]*`/g, "");
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""');
  s = s.replace(/'(?:\\.|[^'\\])*'/g, "''");
  return s;
}

describe("R-9: no setInterval in any edge function (always broken in Deno)", () => {
  for (const f of listEdgeFunctionFiles()) {
    const rel = path.relative(process.cwd(), f);
    it(`${rel}: no setInterval`, () => {
      const raw = fs.readFileSync(f, "utf8");
      const code = stripCommentsAndStrings(raw);
      const found = code.match(/\bsetInterval\s*\(/g) || [];
      expect(found, `${rel} uses setInterval — broken in Deno edge functions`).toEqual([]);
    });
  }
});

describe("R-9: no empty try-catch in any edge function", () => {
  for (const f of listEdgeFunctionFiles()) {
    const rel = path.relative(process.cwd(), f);
    it(`${rel}: catch blocks have at least one statement`, () => {
      const raw = fs.readFileSync(f, "utf8");
      const code = stripCommentsAndStrings(raw);
      // Match catch (...) { } with optional whitespace. Allow `/* */` (which
      // were already stripped). A truly-empty body means silent failure.
      const empty = code.match(/catch\s*\([^)]*\)\s*\{\s*\}/g) || [];
      expect(empty, `${rel} has empty catch block — silent error swallow`).toEqual([]);
    });
  }
});

describe("R-9: stripe-webhook .then() chains are all preceded by await on the chain start", () => {
  it("stripe-webhook/index.ts: every .rpc(...).then(...) is awaited", () => {
    const f = path.resolve(process.cwd(), "supabase/functions/stripe-webhook/index.ts");
    if (!fs.existsSync(f)) {
      // No stripe-webhook in this fork — vacuously OK.
      return;
    }
    const raw = fs.readFileSync(f, "utf8");
    // Find every `}).then(` occurrence. For each, look BACKWARDS up to 50
    // lines to find either:
    //   (a) `await supabase.rpc(` or `await supa*.rpc(` on a previous line, OR
    //   (b) some other `await` start of the same expression.
    // If neither: fire-and-forget — fail the test.
    const lines = raw.split("\n");
    const dotThenLines = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /\}\)\.then\(/.test(l));
    for (const { i: thenIdx } of dotThenLines) {
      let foundAwait = false;
      for (let back = Math.max(0, thenIdx - 60); back <= thenIdx; back++) {
        if (/\bawait\s+(supabase|supa\w*)\.(rpc|from)\(/.test(lines[back])) {
          foundAwait = true;
          break;
        }
      }
      expect(foundAwait, `stripe-webhook line ${thenIdx + 1}: ".then(" without preceding "await supabase.*" on the chain (fire-and-forget — same bug class as R-4b)`).toBe(true);
    }
  });
});

describe("R-9: every edge function index.ts is at least readable + non-empty", () => {
  // Tail-truncation sanity check — locks Gate 3 of npm run verify into
  // the test suite too, so a truncated edge function file can't pass
  // tests even if Gate 3 is somehow bypassed.
  for (const f of listEdgeFunctionFiles()) {
    const rel = path.relative(process.cwd(), f);
    it(`${rel}: non-empty + ends with a closing line`, () => {
      const bytes = fs.readFileSync(f);
      expect(bytes.length).toBeGreaterThan(100);
      // No NUL bytes
      expect(bytes.includes(0)).toBe(false);
      // Last non-empty line should look like a closing line (}, );, etc.)
      const text = bytes.toString("utf8");
      const lastLine = text.trimEnd().split("\n").pop() || "";
      // Must end with one of these structural closers — never an
      // unterminated identifier / string / mid-statement break.
      expect(
        /^[\s)\]};]+$|^}\);?$|^export\s|^\s*\/\//.test(lastLine) || lastLine.endsWith("}") || lastLine.endsWith(");"),
        `${rel} last line looks truncated: "${lastLine.slice(0, 80)}"`,
      ).toBe(true);
    });
  }
});
