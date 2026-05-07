// ═══════════════════════════════════════════════════════════════
// SOSphere — onAuthStateChange cleanup invariant (F-03)
// ─────────────────────────────────────────────────────────────
// Locks in the contract that every supabase.auth.onAuthStateChange
// subscription is unsubscribed somewhere in the same file.
//
// Background: F-03 audit finding flagged 7 call sites with only 6
// unsubscribe() calls — looked like a leak. Manual verification
// proved every site DOES unsubscribe properly (in useEffect cleanup
// or in a returned teardown closure), but the original grep heuristic
// was too narrow (3-line window). This test makes the contract
// explicit so a future regression — someone copy-pasting a subscribe
// call without remembering the cleanup — fails CI immediately.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const READ = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

const CALLER_FILES = [
  "src/app/components/api/subscription-realtime.ts",
  "src/app/components/dashboard-web-page.tsx",
  "src/app/components/mobile-app.tsx",
  "src/app/components/sentry-client.ts",
  "src/app/components/sos-audio-upload.ts",
  "src/app/components/sos-server-trigger.ts",
];

function countRealCalls(src: string): number {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const lines = noBlock.split("\n").map((l) => l.replace(/\/\/.*$/, ""));
  return lines.join("\n").match(/supabase\.auth\.onAuthStateChange\s*\(/g)?.length ?? 0;
}

function countCleanups(src: string): number {
  const patternA = src.match(/\.unsubscribe\s*\(\s*\)/g)?.length ?? 0;
  const patternB = src.match(/__\w*AuthSub/g)?.length ?? 0;
  return patternA + Math.ceil(patternB / 2);
}

describe("F-03: onAuthStateChange cleanup invariant", () => {
  it.each(CALLER_FILES)(
    "%s — every onAuthStateChange has at least one cleanup path",
    (file) => {
      const src = READ(file);
      const calls = countRealCalls(src);
      const cleanups = countCleanups(src);
      expect(calls).toBeGreaterThan(0);
      expect(cleanups).toBeGreaterThanOrEqual(calls);
    },
  );

  it("CALLER_FILES list stays in sync with the codebase", { timeout: 30_000 }, () => {
    const ROOT = path.resolve(process.cwd(), "src/app");
    const SKIP_DIRS = new Set(["node_modules", "__tests__", "imports", "ui"]);
    const allCallers: string[] = [];

    const walk = (dir: string, depth = 0) => {
      if (depth > 5) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (
          /\.(ts|tsx)$/.test(entry.name) &&
          !entry.name.includes(".test.") &&
          !entry.name.includes(".spec.")
        ) {
          const src = fs.readFileSync(full, "utf8");
          if (!src.includes("onAuthStateChange")) continue;
          if (countRealCalls(src) > 0) {
            allCallers.push(full.replace(/\\/g, "/").replace(/^.*?(src\/.*)$/, "$1"));
          }
        }
      }
    };
    walk(ROOT);

    const missing = allCallers.filter((f) => !CALLER_FILES.includes(f));
    expect(missing).toEqual([]);
  });
});
