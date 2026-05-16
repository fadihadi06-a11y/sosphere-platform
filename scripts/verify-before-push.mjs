#!/usr/bin/env node
// SOSphere — pre-push verification gate (R-7)
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

function step(name, fn) {
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

// Gate 4: package.json and package-lock.json in sync
step("Gate 4: package.json and lockfile are in sync", () => {
  const pkg = readJsonOrThrow("package.json");
  const lock = readJsonOrThrow("package-lock.json");
  const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
  const lockRoot = lock.packages && lock.packages[""];
  const lockDeps = Object.assign({}, (lockRoot && lockRoot.dependencies) || {}, (lockRoot && lockRoot.devDependencies) || {});
  const missing = [];
  for (const name of Object.keys(deps)) {
    if (!(name in lockDeps)) missing.push(name);
  }
  if (missing.length > 0) {
    return "lockfile missing: " + missing.join(", ") + " (run: npm install --package-lock-only)";
  }
  return true;
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

console.log("\n[verify] === summary ===");
console.log("         passed: " + (8 - failures.length) + "/8");
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
