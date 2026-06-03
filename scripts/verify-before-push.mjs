#!/usr/bin/env node
// SOSphere — pre-push verification gate (R-7, hardened in R-23)
// Runs every CI check locally so failures don't slip into GitHub.
// Usage: node scripts/verify-before-push.mjs  (or: npm run verify)
// Exit:  0 = all green; 1 = at least one gate failed.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const failures = [];
const warnings = [];
let stepsRun = 0;

function step(name, fn) {
  stepsRun += 1;
  const t0 = Date.now();
  process.stdout.write(`[verify] ${name.padEnd(56)} `);
  try {
    const ok = fn();
    const ms = Date.now() - t0;
    if (ok === true) {
      console.log(`PASS (${ms}ms)`);
    } else if (ok && typeof ok === "object" && ok.warn) {
      console.log(`WARN ${ok.warn} (${ms}ms)`);
      warnings.push({ name, detail: ok.warn });
    } else {
      console.log(`FAIL ${ok || "fail"} (${ms}ms)`);
      failures.push({ name, detail: String(ok || "fail").slice(0, 600) });
    }
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(`THREW ${e.message} (${ms}ms)`);
    failures.push({ name, detail: e.message });
  }
}

function readJsonOrThrow(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function walk(dir, predicate, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.name === "dist" || entry.name === "build") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

// Gate 1: JSON files parse
step("Gate 1: JSON files parse", () => {
  const files = [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "supabase/functions/.deploy-drift-allowlist.json",
    "supabase/migrations.lock.json",
  ].filter((p) => fs.existsSync(p));
  const bad = [];
  for (const f of files) {
    try { readJsonOrThrow(f); }
    catch (e) { bad.push(f + ": " + e.message.slice(0, 100)); }
  }
  return bad.length === 0 || bad.join("; ");
});

// Gate 2: GHA workflow YAML files parse (R-20 cross-platform fix)
// Uses Node-native `yaml` package instead of Python (which isn't on Windows).
// `yaml` is a devDependency declared in package.json.
step("Gate 2: GHA workflow YAML files parse", () => {
  const dir = ".github/workflows";
  if (!fs.existsSync(dir)) return true;
  let yamlLib;
  try {
    yamlLib = require("yaml");
  } catch (e) {
    return "yaml package not installed (run: npm install)";
  }
  const ymls = fs.readdirSync(dir).filter((n) => n.endsWith(".yml") || n.endsWith(".yaml"));
  const bad = [];
  for (const y of ymls) {
    const p = path.join(dir, y);
    try {
      yamlLib.parse(fs.readFileSync(p, "utf8"));
    } catch (e) {
      bad.push(y + ": " + String(e.message || e).slice(0, 200));
    }
  }
  return bad.length === 0 || bad.join("; ");
});

// Gate 3: no NUL bytes
step("Gate 3: no NUL bytes in source files", () => {
  const targets = [
    ...walk("src/app/components", (p) => p.endsWith(".ts") || p.endsWith(".tsx")),
    ...walk("supabase/functions", (p) => p.endsWith(".ts")),
    ...walk("scripts", (p) => p.endsWith(".mjs") || p.endsWith(".js") || p.endsWith(".cjs")),
    ".github/workflows/probes.yml",
    ".github/workflows/ci.yml",
    "package.json",
    "supabase/config.toml",
  ].filter((p) => fs.existsSync(p));
  const bad = [];
  for (const f of targets) {
    const bytes = fs.readFileSync(f);
    if (bytes.includes(0)) bad.push(f + ": contains NUL byte (truncation artifact)");
  }
  return bad.length === 0 || bad.slice(0, 5).join("; ");
});

// Gate 3b: TypeScript files parse cleanly (R-32 — catches mount-sync truncation).
// Walks every .ts / .tsx and parses with the TS compiler. Catches files that
// were silently truncated mid-statement before they reach CI.
step("Gate 3b: TypeScript source files parse cleanly", () => {
  let ts;
  try {
    ts = require("typescript");
  } catch {
    return "typescript not installed (run npm install)";
  }
  const targets = [
    ...walk("src", (p) => p.endsWith(".ts") || p.endsWith(".tsx")),
    ...walk("supabase/functions", (p) => p.endsWith(".ts")),
  ];
  const bad = [];
  for (const f of targets) {
    const source = fs.readFileSync(f, "utf8");
    const kind = f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(f, source, ts.ScriptTarget.Latest, true, kind);
    const diags = sf.parseDiagnostics || [];
    if (diags.length > 0) {
      const first = diags[0];
      const msg = typeof first.messageText === "string"
        ? first.messageText
        : (first.messageText && first.messageText.messageText) || "syntax error";
      bad.push(f + " @ pos " + first.start + ": " + msg.slice(0, 80));
      if (bad.length >= 5) break;
    }
  }
  return bad.length === 0 || bad.join(" | ");
});

// Gate 4: package.json <-> package-lock.json STRICT sync (matches `npm ci`)
//
// R-23 root fix: the original Gate 4 only checked "is the package NAME in
// lockfile's top-level deps map". That missed the case where a package was
// declared in package.json devDependencies but the install-tree entry
// `node_modules/<pkg>` was never generated (i.e. someone edited
// package.json by hand without running `npm install`). `npm ci` enforces
// BOTH conditions and was failing in CI while verify said OK.
//
// We now verify: for every package.json {dep, devDep}, the lockfile has
//   1. the name in packages[""].dependencies or packages[""].devDependencies
//   2. an entry at packages["node_modules/<name>"] with a `version` field
// This is the structural invariant `npm ci` checks first; mismatch ⇒ fatal.
step("Gate 4: package.json and lockfile are in sync (strict, matches npm ci)", () => {
  const pkg = readJsonOrThrow("package.json");
  const lock = readJsonOrThrow("package-lock.json");
  const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
  const lockRoot = (lock.packages && lock.packages[""]) || {};
  const lockTopDeps = Object.assign({}, lockRoot.dependencies || {}, lockRoot.devDependencies || {});
  const lockPackages = lock.packages || {};

  const missingFromTop = [];
  const missingInstallEntry = [];
  for (const name of Object.keys(deps)) {
    if (!(name in lockTopDeps)) missingFromTop.push(name);
    if (!(("node_modules/" + name) in lockPackages)) missingInstallEntry.push(name);
  }

  if (missingFromTop.length > 0 || missingInstallEntry.length > 0) {
    const parts = [];
    if (missingFromTop.length > 0) {
      parts.push("not in lockfile top-level deps: " + missingFromTop.join(", "));
    }
    if (missingInstallEntry.length > 0) {
      parts.push("missing node_modules/<pkg> entry: " + missingInstallEntry.join(", "));
    }
    return parts.join(" | ") + " — run: npm install  (then commit package-lock.json)";
  }
  return true;
});

// Gate 4b: `npm ci --dry-run --ignore-scripts` — the EXACT command CI runs.
// This is the parity-by-construction gate: if it would fail in CI's
// `npm ci` step, it fails here too. We use --dry-run so node_modules
// is not touched, and --ignore-scripts so install hooks don't run.
step("Gate 4b: npm ci --dry-run (parity with CI install)", () => {
  const r = spawnSync("npm", ["ci", "--dry-run", "--ignore-scripts", "--no-audit", "--no-fund"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: 90 * 1000,
    shell: process.platform === "win32",
  });
  if (r.status === 0) return true;
  const out = (r.stdout || "") + "\n" + (r.stderr || "");
  // Surface the most informative lines (EUSAGE / not in sync / missing).
  const errLines = out.split("\n")
    .filter((l) => /npm error|EUSAGE|not in sync|missing|invalid|enoent/i.test(l))
    .slice(0, 6);
  return errLines.length > 0
    ? errLines.join(" | ").slice(0, 700)
    : ("npm ci dry-run exit " + r.status).slice(0, 200);
});

// Gate 5: node --check on every script
step("Gate 5: node-syntax-check scripts", () => {
  const targets = walk("scripts", (p) => p.endsWith(".mjs") || p.endsWith(".js"));
  const bad = [];
  for (const f of targets) {
    const r = spawnSync("node", ["--check", f], { encoding: "utf8" });
    if (r.status !== 0) {
      const first = (r.stderr || "").split("\n").filter(Boolean)[0] || "";
      bad.push(f + ": " + first.slice(0, 200));
    }
  }
  return bad.length === 0 || bad.join("; ");
});

// Gate 6: ESLint
step("Gate 6: ESLint on src/app/ (--max-warnings 1100)", () => {
  // R-20 cross-platform: shell: true on Windows so npx.cmd is resolved
  const r = spawnSync("npx", ["eslint", "src/app/", "--max-warnings", "1100"],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, shell: process.platform === "win32" });
  if (r.status === 0) return true;
  const out = (r.stdout || "") + "\n" + (r.stderr || "");
  const errLines = out.split("\n").filter((l) => /error|problem/.test(l)).slice(0, 6);
  return errLines.join(" | ").slice(0, 500);
});

// Gate 7: migration drift guard
step("Gate 7: migration drift guard", () => {
  const r = spawnSync("node", ["scripts/check-migration-drift.mjs", "--check"], { encoding: "utf8" });
  if (r.status === 0) return true;
  return (r.stdout || "").split("\n")
    .filter((l) => l.includes("drift") || l.includes("new migration") || l.includes("missing"))
    .slice(0, 5).join(" | ").slice(0, 400);
});

// Gate 8: Vitest full suite
step("Gate 8: Vitest full suite", () => {
  // R-20 cross-platform: shell: true on Windows so npx.cmd is resolved
  const r = spawnSync("npx", ["vitest", "run", "--reporter=dot"], {
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
    shell: process.platform === "win32",
  });
  if (r.status === 0) return true;
  const out = (r.stdout || "") + "\n" + (r.stderr || "");
  const sumMatch = out.match(/Test Files\s+[^\n]*/);
  const sum = sumMatch ? sumMatch[0] : "";
  const failMatch = out.match(/FAIL\s+[^\n]+/g);
  const fails = failMatch ? failMatch.slice(0, 5).join(" | ") : "";
  return (sum + " " + fails).slice(0, 500);
});

// Gate 9: npm audit — exact command from ci.yml Security Audit job.
// R-23: previously missing. Critical advisories in production deps were
// surfacing in CI but never locally → verify said clean while CI failed.
step("Gate 9: npm audit (critical, prod deps only — matches CI)", () => {
  const r = spawnSync("npm", ["audit", "--audit-level=critical", "--omit=dev"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60 * 1000,
    shell: process.platform === "win32",
  });
  if (r.status === 0) return true;
  const out = (r.stdout || "") + "\n" + (r.stderr || "");
  // npm audit prints a JSON-ish summary; surface the count line(s)
  const sevLine = out.split("\n").filter((l) => /critical|vulnerabilities/i.test(l)).slice(0, 4);
  return sevLine.length > 0
    ? sevLine.join(" | ").slice(0, 500)
    : ("npm audit exit " + r.status + " (no critical-related lines found)").slice(0, 200);
});

// Gate 10: vite build — exact command from ci.yml Vite Build job + APK
// build-apk.yml. R-23: previously missing. A broken import / TS error /
// missing env-shield assertion would fail CI's vite build, but verify
// would still report all-clean.
step("Gate 10: npx vite build (matches CI + APK build)", () => {
  const r = spawnSync("npx", ["vite", "build", "--logLevel", "warn"], {
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
    timeout: 4 * 60 * 1000,
    shell: process.platform === "win32",
  });
  if (r.status === 0) return true;
  const out = (r.stdout || "") + "\n" + (r.stderr || "");
  const errLines = out.split("\n").filter((l) => /error|failed|Cannot|Could not/i.test(l)).slice(0, 5);
  return errLines.length > 0
    ? errLines.join(" | ").slice(0, 600)
    : ("vite build exit " + r.status).slice(0, 200);
});

// Gate 11 (2026-06-03): tsc --noEmit — matches CI's "TypeScript + ESLint +
// Tests + Audit" job. Catches type-level errors that vite build silently
// accepts (esbuild's transpiler strips types without checking them) and
// that ESLint doesn't enforce. Two real CI failures today (investigations
// Investigation.timeline lacking `signed`, mfa-client passing "auth" to
// AuditCategory) made it through every other local gate and only surfaced
// on the round-trip CI typecheck. Closing the gap here.
step("Gate 11: tsc --noEmit (full project typecheck, matches CI)", () => {
  const r = spawnSync("npx", ["tsc", "--noEmit", "--skipLibCheck"], {
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
    timeout: 4 * 60 * 1000,
    shell: process.platform === "win32",
  });
  if (r.status === 0) return true;
  const out = (r.stdout || "") + "\n" + (r.stderr || "");
  // Surface up to 5 distinct TS error lines (TSxxxx: ...).
  const errLines = out
    .split("\n")
    .filter((l) => /\berror TS\d{4}:/i.test(l) || /Cannot find module/i.test(l))
    .slice(0, 5);
  return errLines.length > 0
    ? errLines.join(" | ").slice(0, 800)
    : ("tsc exit " + r.status).slice(0, 200);
});

console.log("\n[verify] === summary ===");
console.log("         passed: " + (stepsRun - failures.length) + "/" + stepsRun);
console.log("         warnings: " + warnings.length);
console.log("         failures: " + failures.length);
if (warnings.length > 0) {
  console.log("\n[verify] warnings:");
  for (const w of warnings) console.log("         - " + w.name + ": " + w.detail);
}
if (failures.length > 0) {
  console.log("\n[verify] FAILURES (fix BEFORE pushing):");
  for (const f of failures) {
    console.log("         - " + f.name);
    console.log("           " + f.detail);
  }
  console.log("\n[verify] EXIT 1");
  process.exit(1);
}
console.log("\n[verify] all clean - safe to push");
process.exit(0);
