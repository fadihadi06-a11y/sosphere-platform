#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — R-6: deployed-vs-git edge function drift detector
// ─────────────────────────────────────────────────────────────────────────
// DESIGN (post-live-run-3 pivot, 2026-05-14)
//   The first two live runs revealed that byte-by-byte source comparison is
//   not possible for Supabase Edge Functions:
//     - Supabase's CLI deploy runs the source through esbuild + TS→JS
//       transformation before packaging the eszip
//     - The eszip bundle's entrypoint module is the TRANSPILED output, not
//       the raw .ts source
//     - Inlined imports may also live in the same module
//   Net: byte-hash of deployed source NEVER matches byte-hash of local
//   .ts source. Falsely reports drift on every function.
//
//   The correct primitive is `ezbr_sha256` — a hash Supabase publishes on
//   every function (returned by GET /v1/projects/{ref}/functions). It is
//   the canonical fingerprint of WHAT WAS DEPLOYED. If we pin this value
//   into git after each deploy, R-6 can ask "is the live ezbr equal to the
//   pinned one?" and detect ANY change (including Studio UI hot-fixes).
//
//   The manifest file (supabase/functions/.deploy-manifest.json) records:
//     { "<slug>": { "ezbr": "<sha256>", "version": <n>, "pinned_at": "..." } }
//
// MODES
//   node scripts/check-function-drift.mjs           # default: --check
//   node scripts/check-function-drift.mjs --check   # explicit
//     For each deployed function: compare live ezbr to manifest entry.
//     in_sync = match. drifted = mismatch. orphan_deployed = not in manifest
//     and not in allowlist. Exits 1 on any FAIL.
//
//   node scripts/check-function-drift.mjs --update-manifest
//     Updates .deploy-manifest.json with the current live ezbr values for
//     all deployed functions (skipping allowlisted ones). Run after every
//     legitimate deploy and commit the updated manifest.
//
// AUTH
//   SUPABASE_ACCESS_TOKEN — Personal Access Token (not service_role)
//   SUPABASE_PROJECT_REF  — project ref (rtfhkbskgrasamhjraul)
//
// ALLOWLIST (supabase/functions/.deploy-drift-allowlist.json)
//   Same as before: lists legacy / foreign-repo functions that should NOT
//   be tracked in this manifest. These never trigger drift.
// ═══════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const FUNCTIONS_DIR = path.join(ROOT, "supabase", "functions");
const ALLOWLIST_FILE = path.join(FUNCTIONS_DIR, ".deploy-drift-allowlist.json");
const MANIFEST_FILE = path.join(FUNCTIONS_DIR, ".deploy-manifest.json");

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const MODE = process.argv.includes("--update-manifest") ? "update" : "check";

if (!ACCESS_TOKEN) {
  console.error("ERROR: SUPABASE_ACCESS_TOKEN env var is required.");
  console.error("Create one at https://supabase.com/dashboard/account/tokens");
  process.exit(2);
}
if (!PROJECT_REF) {
  console.error("ERROR: SUPABASE_PROJECT_REF env var is required.");
  process.exit(2);
}

const MGMT_BASE = "https://api.supabase.com/v1";

async function mgmt(pathSuffix) {
  const res = await fetch(`${MGMT_BASE}${pathSuffix}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase Management API ${pathSuffix} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function readJsonOr(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) {
    console.warn(`[drift] warning: could not parse ${p}: ${e.message}`);
    return fallback;
  }
}

function readAllowlist() {
  const raw = readJsonOr(ALLOWLIST_FILE, { entries: [] });
  return new Map((raw.entries || []).map((e) => [e.slug, e.reason || "(no reason)"]));
}

function readManifest() {
  return readJsonOr(MANIFEST_FILE, { _doc: "", entries: {} });
}

function listLocalFunctions() {
  if (!fs.existsSync(FUNCTIONS_DIR)) return [];
  return fs.readdirSync(FUNCTIONS_DIR)
    .filter((n) => !n.startsWith(".") && !n.startsWith("_"))
    .filter((n) => fs.statSync(path.join(FUNCTIONS_DIR, n)).isDirectory())
    .filter((n) => fs.existsSync(path.join(FUNCTIONS_DIR, n, "index.ts")));
}

function classifyEntrypoint(entrypointPath) {
  if (!entrypointPath) return "unknown";
  if (entrypointPath.includes("/tmp/user_fn_")) return "canonical";
  if (entrypointPath.includes("file:///Users/") || entrypointPath.includes("file:///C:")) return "foreign";
  return "unknown";
}

async function main() {
  const allowlist = readAllowlist();
  const localSlugs = new Set(listLocalFunctions());
  const deployed = await mgmt(`/projects/${PROJECT_REF}/functions`);

  if (MODE === "update") {
    // --update-manifest: write current live ezbr values for all deployed
    // functions that are NOT in the allowlist.
    const entries = {};
    const now = new Date().toISOString();
    for (const fn of deployed) {
      if (allowlist.has(fn.slug)) continue;
      entries[fn.slug] = {
        ezbr:      fn.ezbr_sha256,
        version:   fn.version,
        pinned_at: now,
      };
    }
    const doc = [
      "R-6 (2026-05-14): pinned ezbr_sha256 values for every deployed edge function.",
      "Supabase publishes this hash on every deploy as the canonical bundle fingerprint.",
      "Update this file after each legitimate `supabase functions deploy` by running:",
      "  npm run drift:update    (or: node scripts/check-function-drift.mjs --update-manifest)",
      "Then commit the updated file. R-6's --check mode compares live ezbr to these pins.",
      "If they diverge, someone deployed without updating the manifest (or via Studio UI).",
    ];
    const out = { _doc: doc, entries };
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(out, null, 2) + "\n");
    console.log(`[drift] wrote ${Object.keys(entries).length} entries to ${path.relative(ROOT, MANIFEST_FILE)}`);
    console.log(`[drift] commit this file to pin the current deployed state.`);
    // R-17 fix: avoid `process.exit()` here. Calling exit() while undici
    // keep-alive sockets are mid-close hits a libuv assertion on Windows
    // (uv__async.c:76 — UV_HANDLE_CLOSING). Setting exitCode + returning
    // lets the event loop drain those handles, then Node exits naturally.
    process.exitCode = 0;
    return;
  }

  // --check mode
  const manifest = readManifest();
  const manifestEntries = manifest.entries || {};

  const report = {
    in_sync: [],
    drifted: [],
    orphan_deployed: [],
    orphan_local: [],
    foreign_entrypoint: [],
    missing_from_manifest: [],
  };

  for (const fn of deployed) {
    const slug = fn.slug;
    const entrypointClass = classifyEntrypoint(fn.entrypoint_path);
    if (entrypointClass === "foreign") {
      report.foreign_entrypoint.push({
        slug, version: fn.version,
        entrypoint_path: fn.entrypoint_path,
        allowlisted: allowlist.has(slug),
        allow_reason: allowlist.get(slug) || null,
      });
    }

    if (allowlist.has(slug)) {
      // Legacy / foreign-repo function — not tracked
      report.orphan_deployed.push({
        slug, version: fn.version, allowlisted: true,
        allow_reason: allowlist.get(slug),
      });
      continue;
    }

    const pinned = manifestEntries[slug];
    if (!pinned) {
      // Not in manifest AND not allowlisted
      report.missing_from_manifest.push({
        slug, version: fn.version, live_ezbr: (fn.ezbr_sha256 || "").slice(0, 12),
      });
      continue;
    }

    if (pinned.ezbr === fn.ezbr_sha256) {
      report.in_sync.push({ slug, version: fn.version, ezbr: fn.ezbr_sha256.slice(0, 12) });
    } else {
      report.drifted.push({
        slug, version: fn.version,
        pinned_ezbr: (pinned.ezbr || "").slice(0, 12),
        live_ezbr:   (fn.ezbr_sha256 || "").slice(0, 12),
        pinned_version: pinned.version,
        live_version:   fn.version,
        pinned_at: pinned.pinned_at,
      });
    }
  }

  const deployedSlugs = new Set(deployed.map((f) => f.slug));
  for (const slug of localSlugs) {
    if (!deployedSlugs.has(slug)) report.orphan_local.push({ slug });
  }

  const summary = {
    in_sync_count:               report.in_sync.length,
    drifted_count:               report.drifted.length,
    missing_from_manifest_count: report.missing_from_manifest.length,
    orphan_deployed_allowed:     report.orphan_deployed.filter((o) => o.allowlisted).length,
    orphan_local_count:          report.orphan_local.length,
    foreign_entrypoint_not_allowlisted: report.foreign_entrypoint.filter((o) => !o.allowlisted).length,
  };

  console.log("\n[drift] ═══════════ summary ═══════════");
  console.log(JSON.stringify(summary, null, 2));

  if (report.drifted.length > 0) {
    console.log("\n[drift] ✗ DRIFTED (pinned ezbr ≠ live ezbr — someone deployed without updating the manifest):");
    console.log(JSON.stringify(report.drifted, null, 2));
  }
  if (report.missing_from_manifest.length > 0) {
    console.log("\n[drift] ✗ MISSING FROM MANIFEST (deployed but no pin):");
    console.log(JSON.stringify(report.missing_from_manifest, null, 2));
    console.log("\n[drift]   FIX: run `node scripts/check-function-drift.mjs --update-manifest` and commit");
  }
  const unallowedForeign = report.foreign_entrypoint.filter((o) => !o.allowlisted);
  if (unallowedForeign.length > 0) {
    console.log("\n[drift] ⚠ FOREIGN ENTRYPOINTS (not allowlisted):");
    console.log(JSON.stringify(unallowedForeign, null, 2));
  }
  if (report.orphan_local.length > 0) {
    console.log("\n[drift] ℹ ORPHAN LOCAL (in repo but not deployed yet):");
    console.log(JSON.stringify(report.orphan_local, null, 2));
  }
  if (report.in_sync.length > 0) {
    console.log("\n[drift] ✓ IN-SYNC:");
    for (const f of report.in_sync) {
      console.log(`  ${f.slug.padEnd(28)} v${f.version}  ezbr=${f.ezbr}`);
    }
  }

  const fail =
    report.drifted.length > 0 ||
    report.missing_from_manifest.length > 0 ||
    unallowedForeign.length > 0;
  // R-17 fix: see above — set exitCode and let the event loop drain.
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error("[drift] fatal:", e); process.exit(2); });
