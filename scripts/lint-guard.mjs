#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — Lint Guard
// ═════════════════════════════════════════════════════════════════════════
// Catches reintroduction of ALL patterns we've fixed across B-* and W3-*.
// Run as pre-commit hook OR standalone (CI):
//   node scripts/lint-guard.mjs
// Exit code 0 = clean; 1 = at least one violation found.
//
// Each rule has:
//   - id: short slug for grep / disable comment
//   - ref: which fix it protects (B-NN / G-NN / W3-NN)
//   - reason: 1-line user-facing explanation
//   - test: regex applied to file contents
//   - paths: glob-pattern allowlist (only check certain files)
//   - allowlist: per-file or per-line regex bypass when intent is correct
//
// To intentionally bypass for a specific line, add a trailing
//   // lint-guard-allow:<rule-id>
// comment. The guard skips matches on lines containing that marker.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep, relative } from "node:path";

const ROOT = process.cwd();

// ── Rules ─────────────────────────────────────────────────────────────
const RULES = [
  {
    id: "no-any-typing",
    ref: "G-42",
    reason: "Use SupabaseClient or unknown — `any` weakens type safety.",
    test: /:\s*any\b(?!\s*\/\*\s*allow)/,
    paths: ["src/app/components/api/storage-adapter.ts"],
  },
  {
    id: "no-math-random-token",
    ref: "W3-17 / B-05",
    reason: "Use crypto.getRandomValues for security-relevant tokens / IDs.",
    test: /Math\.random\(\)/,
    paths: [
      "src/app/components/company-register.tsx",
      "src/app/components/duress-service.ts",
      "src/app/components/dashboard-web-page.tsx",
      "supabase/functions",
    ],
    allowlist: [
      // it's fine inside ID generators that don't need cryptographic strength
      /AUD-.*Math\.random/,                // audit_log id, not security-relevant
      /CE-.*Math\.random/,                 // call_event id
      /Math\.random.*\.toString\(36\)/,    // human-readable suffix in IDs
    ],
  },
  {
    id: "no-legacy-schema-tables",
    ref: "G-43",
    reason: "These tables are deprecated (dead). See docs/AUDIT_G_43_SCHEMA_DUPLICATION_CATALOG.md.",
    test: /\.from\(['"](?:audit_logs|checkins|trip_checkins|sos_outbox|sos_timers|sos_dispatch_logs)['"]\)/,
    paths: ["src", "supabase/functions"],
  },
  {
    id: "no-direct-companies-upsert",
    ref: "W3-16",
    reason: "Use create_company_v2 RPC — direct upsert bypasses RLS + memberships.",
    test: /\.from\(['"]companies['"]\)\s*\.\s*upsert/,
    paths: ["src"],
  },
  {
    id: "no-deprecated-deactivation-pin-key",
    ref: "W3-10",
    reason: "Use isDeactivationPin() / isDeactivationPinSet() — direct localStorage read enables 1234 bypass.",
    test: /['"]sosphere_deactivation_pin['"]/,
    paths: ["src"],
    // duress-service.ts is the canonical owner of the migration logic
    allowlist: [
      /duress-service\.ts/,
    ],
  },
  {
    id: "no-dead-sync-data-key",
    ref: "W3-50",
    reason: "sosphere_sync_data is never written; use getLastEmployeeSync(employeeId) or getBatteryLevel().",
    test: /['"]sosphere_sync_data['"]/,
    paths: ["src"],
  },
  {
    id: "no-math-abs-timestamp",
    ref: "W3-7",
    reason: "Stripe-recommended check is one-sided: `now - t > 300` (not Math.abs).",
    test: /Math\.abs\([^)]*Date\.now/,
    paths: ["supabase/functions/stripe-webhook"],
  },
  {
    id: "missing-abort-signal-timeout",
    ref: "G-41",
    reason: "Outbound fetch in edge functions must have AbortSignal.timeout to prevent hung worker.",
    // Heuristic: any `await fetch(` in supabase/functions WITHOUT signal:
    // We check files that use fetch and verify they reference AbortSignal.timeout.
    paths: ["supabase/functions/sos-bridge-twiml", "supabase/functions/sos-alert"],
    fileLevelCheck: (content) => {
      const hasFetch = /await\s+fetch\s*\(/.test(content);
      const hasTimeout = /AbortSignal\.timeout/.test(content);
      // Ignore Twilio-API fetches that may not need timeout (rare); flag if fetch exists but no timeout
      return hasFetch && !hasTimeout;
    },
  },
  {
    id: "no-global-realtime-channel",
    ref: "W3-3",
    reason: "Realtime channels must be tenant-scoped (e.g., sos-live:${companyId}).",
    test: /channel\(['"`](sos-live|evidence-changes|missions)['"`]\)/,
    paths: ["src", "supabase/functions"],
  },
  {
    id: "no-prewarm-without-ownership-check",
    ref: "W3-30",
    reason: "PREWARM upsert must check existing emergencyId ownership.",
    paths: ["supabase/functions/sos-alert/index.ts"],
    fileLevelCheck: (content) => {
      // If the file has a PREWARM upsert, it must also check existing ownership
      const hasPrewarm = /action === ['"]prewarm['"]/.test(content);
      const hasOwnershipCheck = /emergencyId conflict|existing.*user_id/.test(content);
      return hasPrewarm && !hasOwnershipCheck;
    },
  },
  {
    id: "no-secdef-without-grant-revoke",
    ref: "W3-39",
    reason: "New SECURITY DEFINER functions must REVOKE EXECUTE from anon/authenticated.",
    // Match only actual `LANGUAGE ... SECURITY DEFINER` lines, not comments
    // mentioning the term. Skips lines starting with `--` or `//`.
    test: /^(?!\s*(?:--|\/\/|\*)).*SECURITY DEFINER/m,
    paths: ["supabase/migrations"],
    // The follow-up REVOKE / GRANT tightening is done in companion migrations
    // (W3-39, W3-36). This is a heuristic — warn, not fail.
    severity: "warn",
  },
];

// ── File walker ───────────────────────────────────────────────────────
function walk(dir, files = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git" || e === "dist" || e === ".next" ||
        e === "android" || e === "ios" || e === "build" || e === ".expo") continue;
    const full = join(dir, e);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, files);
    else if (/\.(ts|tsx|js|mjs|sql)$/.test(e)) files.push(full);
  }
  return files;
}

function pathMatchesAny(rel, prefixes) {
  return prefixes.some((p) => rel.split(sep).join("/").startsWith(p));
}

// ── Main ──────────────────────────────────────────────────────────────
const allFiles = walk(ROOT);
let totalViolations = 0;
let totalWarnings = 0;
const byRule = new Map();

for (const file of allFiles) {
  const rel = relative(ROOT, file);
  let content;
  try { content = readFileSync(file, "utf8"); } catch { continue; }

  for (const rule of RULES) {
    if (!pathMatchesAny(rel, rule.paths)) continue;

    // file-level check (no per-line regex)
    if (rule.fileLevelCheck) {
      if (rule.fileLevelCheck(content)) {
        const sev = rule.severity || "error";
        if (sev === "warn") totalWarnings++;
        else totalViolations++;
        byRule.set(rule.id, (byRule.get(rule.id) || 0) + 1);
        console.log(`${sev === "warn" ? "⚠" : "✖"}  ${rule.id} (${rule.ref})  ${rel}`);
        console.log(`     ${rule.reason}`);
      }
      continue;
    }

    // line-level regex check
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("lint-guard-allow:" + rule.id)) continue;
      if (rule.allowlist && rule.allowlist.some((a) => a.test(line) || a.test(rel))) continue;
      if (rule.test && rule.test.test(line)) {
        const sev = rule.severity || "error";
        if (sev === "warn") totalWarnings++;
        else totalViolations++;
        byRule.set(rule.id, (byRule.get(rule.id) || 0) + 1);
        console.log(`${sev === "warn" ? "⚠" : "✖"}  ${rule.id} (${rule.ref})  ${rel}:${i + 1}`);
        console.log(`     ${line.trim().slice(0, 120)}`);
        console.log(`     → ${rule.reason}`);
      }
    }
  }
}

console.log("");
if (totalViolations === 0 && totalWarnings === 0) {
  console.log("✅ Lint guard clean — no regressions detected.");
  process.exit(0);
}

console.log("Summary by rule:");
for (const [id, count] of [...byRule.entries()].sort()) {
  console.log(`  ${id}: ${count}`);
}
console.log("");
console.log(`Total: ${totalViolations} error(s), ${totalWarnings} warning(s)`);
process.exit(totalViolations > 0 ? 1 : 0);
