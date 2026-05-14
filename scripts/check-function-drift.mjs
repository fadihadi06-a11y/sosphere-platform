#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// SOSphere — R-6: deployed-vs-git edge function drift detector
// ─────────────────────────────────────────────────────────────────────────
// THE GAP THIS CLOSES
//   R-4 just discovered three latent SOS bugs by exercising end-to-end behavior.
//   But the deployment story has its own silent failure modes:
//     • A developer fixes a bug in git but forgets to `supabase functions deploy`
//     • A CLI deploy succeeds locally but a CI pipeline re-deploys an older
//       version (race / artifact mix-up)
//     • A function gets deployed from a SECOND repo by accident
//       (this project has 9 functions deployed from a 'sos-backend' repo —
//       discovered during R-6 design)
//     • Hot-fix deployed via Studio UI, never backported to git
//
//   None of those are visible from edge logs or static tests. The only way to
//   catch them is to compare deployed source against git source on a cadence.
//
// WHAT THIS SCRIPT DOES
//   1. Authenticates against Supabase Management API with SUPABASE_ACCESS_TOKEN
//      (a Personal Access Token, NOT the service_role key — different scope).
//   2. Lists every deployed edge function in the project.
//   3. For each function that ALSO lives locally in supabase/functions/*:
//        • Fetches deployed source via /v1/projects/{ref}/functions/{slug}/body
//        • Normalizes both deployed and local source (strip line comments +
//          trim trailing whitespace + collapse blank lines) so cosmetic
//          differences don't false-alarm.
//        • Hashes both with SHA-256. Mismatch → drift.
//   4. Categorizes:
//        ✓ in_sync             deployed == local (normalized)
//        ✗ drifted             deployed != local — REGRESSION SIGNAL
//        ℹ orphan_deployed     deployed but no local source — needs allowlist
//        ℹ orphan_local        local but no deployment — usually a new function
//        ⚠ foreign_entrypoint  entrypoint_path is from a non-canonical repo
//   5. Exits 1 if ANY drift is detected (or any non-allowlisted orphan).
//
// ALLOWLIST
//   supabase/functions/.deploy-drift-allowlist.json
//   Lists functions intentionally deployed from a different repo (e.g. legacy
//   sos-backend). Entries: { "slug": string, "reason": string }.
//
// USAGE
//   SUPABASE_ACCESS_TOKEN=sbp_xxx \
//   SUPABASE_PROJECT_REF=rtfhkbskgrasamhjraul \
//   node scripts/check-function-drift.mjs
//
// GitHub Action env vars (set as repo secrets):
//   SUPABASE_ACCESS_TOKEN — Personal Access Token, https://supabase.com/dashboard/account/tokens
//   SUPABASE_PROJECT_REF   — project ref (rtfhkbskgrasamhjraul for sosphere)
// ═══════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Parser as EszipParser } from "@deno/eszip";

const ROOT = path.resolve(process.cwd());
const FUNCTIONS_DIR = path.join(ROOT, "supabase", "functions");
const ALLOWLIST_FILE = path.join(FUNCTIONS_DIR, ".deploy-drift-allowlist.json");

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;

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

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Normalize source for hashing.
 *  Strips single-line comments, collapses runs of blank lines, trims line
 *  endings. Block comments and string literals are preserved (we don't try
 *  to be a real parser — this is best-effort drift detection, not a security
 *  review). The same normalization is applied to BOTH sides so the comparison
 *  is symmetric. */
function normalize(src) {
  return src
    .replace(/\r\n/g, "\n")               // unify line endings
    .split("\n")
    .map((line) => line.replace(/\s+$/, "")) // trim trailing whitespace
    .filter((line) => !/^\s*\/\/[^\n]*$/.test(line)) // drop full-line // comments
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")           // collapse 3+ blank lines to 2
    .trim();
}

function sha256(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

async function mgmt(pathSuffix) {
  const res = await fetch(`${MGMT_BASE}${pathSuffix}`, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase Management API ${pathSuffix} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Fetch deployed source for a function slug by decoding the ESZIP bundle.
 *  Supabase's /v1/projects/{ref}/functions/{slug}/body endpoint returns the
 *  function's source as a binary ESZIP archive (Deno's bundled-module format),
 *  NOT plain JSON. The MCP get_edge_function tool decodes ESZIP server-side
 *  before returning JSON; the raw Management API leaves it as bytes, so we
 *  decode locally via @deno/eszip.
 *
 *  Returns: the text content of the index.ts entrypoint, or null + a reason
 *  for skipping if the bundle is malformed / has no detectable entrypoint. */
async function fetchDeployedIndexSource(slug) {
  const url = `${MGMT_BASE}/projects/${PROJECT_REF}/functions/${slug}/body`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { source: null, error: `body_http_${res.status}`, detail: body.slice(0, 200) };
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 8) {
    return { source: null, error: "body_too_short", detail: `len=${bytes.length}` };
  }
  // Sanity: ESZIP files start with "ESZIP" magic. Other shapes mean Supabase
  // changed the API or returned an error envelope without a 4xx/5xx code.
  const magic = new TextDecoder().decode(bytes.slice(0, 5));
  if (magic !== "ESZIP") {
    return { source: null, error: "not_eszip", detail: `magic=${JSON.stringify(magic)}` };
  }

  let parser;
  try {
    parser = await EszipParser.createInstance();
  } catch (e) {
    return { source: null, error: "eszip_init_failed", detail: String(e).slice(0, 200) };
  }
  try {
    await parser.parseBytes(bytes);
    const specifiers = await parser.load();
    if (!Array.isArray(specifiers) || specifiers.length === 0) {
      return { source: null, error: "no_specifiers_in_eszip", detail: "" };
    }
    // Find the index.ts entrypoint. Supabase deployments have a variety of
    // prefix paths depending on the upload method:
    //   /tmp/user_fn_<id>_<ver>/source/index.ts
    //   /tmp/user_fn_<id>_<ver>/source/supabase/functions/<slug>/index.ts
    //   /tmp/user_fn_<id>_<ver>/source/functions/<slug>/index.ts
    //   file:///Users/.../sos-backend/supabase/functions/<slug>/index.ts
    // Strategy: prefer a specifier whose basename is exactly "index.ts" AND
    // contains the slug in its path. Fall back to any "index.ts" if the slug
    // isn't in any path (some legacy deployments don't include the slug).
    const indexCandidates = specifiers.filter(
      (s) => typeof s === "string" && /\/index\.ts$/.test(s),
    );
    const slugMatch = indexCandidates.find((s) => s.includes(`/${slug}/`));
    const chosen = slugMatch || indexCandidates[0] || null;
    if (!chosen) {
      return {
        source: null,
        error: "no_index_ts_in_eszip",
        detail: `specifiers=${specifiers.slice(0, 5).join(", ")}`,
      };
    }
    const src = await parser.getModuleSource(chosen);
    if (typeof src !== "string" || src.length === 0) {
      return { source: null, error: "empty_source", detail: `specifier=${chosen}` };
    }
    return { source: src, specifier: chosen, error: null };
  } catch (e) {
    return { source: null, error: "eszip_parse_failed", detail: String(e).slice(0, 200) };
  }
}

/** Read the allowlist file if present. Returns a Map<slug, reason>. */
function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_FILE)) return new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, "utf8"));
    if (!Array.isArray(raw?.entries)) return new Map();
    return new Map(raw.entries.map((e) => [e.slug, e.reason || "(no reason given)"]));
  } catch (e) {
    console.warn(`[drift] warning: could not parse ${ALLOWLIST_FILE}: ${e.message}`);
    return new Map();
  }
}

/** List local function slugs (any subdir of supabase/functions/ that contains index.ts). */
function listLocalFunctions() {
  if (!fs.existsSync(FUNCTIONS_DIR)) return [];
  return fs.readdirSync(FUNCTIONS_DIR)
    .filter((name) => !name.startsWith(".") && !name.startsWith("_"))
    .filter((name) => fs.statSync(path.join(FUNCTIONS_DIR, name)).isDirectory())
    .filter((name) => fs.existsSync(path.join(FUNCTIONS_DIR, name, "index.ts")));
}

/** Heuristic: is the deployed entrypoint_path from a non-canonical repo?
 *  Canonical paths look like /tmp/user_fn_... (the supabase build sandbox).
 *  Foreign paths look like file:///Users/.../GitHub/sos-backend/... (a
 *  different developer machine + different repo). */
function classifyEntrypoint(entrypointPath) {
  if (!entrypointPath) return "unknown";
  if (entrypointPath.includes("/tmp/user_fn_")) return "canonical";
  if (entrypointPath.includes("file:///Users/") || entrypointPath.includes("file:///C:")) return "foreign";
  return "unknown";
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const allowlist = readAllowlist();
  const localSlugs = new Set(listLocalFunctions());

  console.log(`[drift] project=${PROJECT_REF} local_functions=${localSlugs.size} allowlist=${allowlist.size}`);

  const deployed = await mgmt(`/projects/${PROJECT_REF}/functions`);
  console.log(`[drift] deployed_functions=${deployed.length}`);

  const report = {
    in_sync: [],
    drifted: [],
    orphan_deployed: [],
    orphan_local: [],
    foreign_entrypoint: [],
  };

  for (const fn of deployed) {
    const slug = fn.slug;
    const isLocal = localSlugs.has(slug);
    const entrypointClass = classifyEntrypoint(fn.entrypoint_path);

    if (entrypointClass === "foreign") {
      report.foreign_entrypoint.push({
        slug,
        version: fn.version,
        entrypoint_path: fn.entrypoint_path,
        allowlisted: allowlist.has(slug),
        allow_reason: allowlist.get(slug) || null,
      });
    }

    if (!isLocal) {
      // Function is deployed but no local source — either intentional (allowlist)
      // or accidental (different repo, forgot to migrate).
      report.orphan_deployed.push({
        slug,
        version: fn.version,
        entrypoint_path: fn.entrypoint_path,
        allowlisted: allowlist.has(slug),
        allow_reason: allowlist.get(slug) || null,
      });
      continue;
    }

    // Fetch + decode deployed ESZIP. The /body endpoint returns a binary
    // ESZIP archive (not JSON); fetchDeployedIndexSource handles the decode
    // and surfaces the entrypoint source.
    const fetched = await fetchDeployedIndexSource(slug);
    if (fetched.error) {
      console.warn(`[drift] could not extract index.ts for ${slug}: ${fetched.error} (${fetched.detail})`);
      report.drifted.push({
        slug, version: fn.version,
        reason: fetched.error,
        detail: fetched.detail,
      });
      continue;
    }

    const localSrc = fs.readFileSync(path.join(FUNCTIONS_DIR, slug, "index.ts"), "utf8");
    const deployedNorm = normalize(fetched.source);
    const localNorm    = normalize(localSrc);
    const deployedHash = sha256(deployedNorm);
    const localHash    = sha256(localNorm);

    if (deployedHash === localHash) {
      report.in_sync.push({ slug, version: fn.version, hash: deployedHash.slice(0, 12) });
    } else {
      // Compute size + line diff signal so the report is actionable.
      const deployedLines = deployedNorm.split("\n").length;
      const localLines    = localNorm.split("\n").length;
      report.drifted.push({
        slug,
        version: fn.version,
        deployed_hash: deployedHash.slice(0, 12),
        local_hash:    localHash.slice(0, 12),
        deployed_lines: deployedLines,
        local_lines:    localLines,
        line_delta:     localLines - deployedLines,
        entrypoint_path: fn.entrypoint_path,
      });
    }
  }

  // Local-but-not-deployed: rare but real. Flag for visibility but don't fail.
  const deployedSlugs = new Set(deployed.map((f) => f.slug));
  for (const slug of localSlugs) {
    if (!deployedSlugs.has(slug)) {
      report.orphan_local.push({ slug });
    }
  }

  // ─── Render report ─────────────────────────────────────────────────────────
  const summary = {
    in_sync_count:           report.in_sync.length,
    drifted_count:           report.drifted.length,
    orphan_deployed_count:   report.orphan_deployed.length,
    orphan_deployed_allowed: report.orphan_deployed.filter((o) => o.allowlisted).length,
    orphan_local_count:      report.orphan_local.length,
    foreign_entrypoint_count: report.foreign_entrypoint.filter((o) => !o.allowlisted).length,
  };

  console.log("\n[drift] ═══════════ summary ═══════════");
  console.log(JSON.stringify(summary, null, 2));

  if (report.drifted.length > 0) {
    console.log("\n[drift] ✗ DRIFTED FUNCTIONS:");
    console.log(JSON.stringify(report.drifted, null, 2));
  }
  const unallowedForeign = report.foreign_entrypoint.filter((o) => !o.allowlisted);
  if (unallowedForeign.length > 0) {
    console.log("\n[drift] ⚠ FOREIGN ENTRYPOINTS (not allowlisted):");
    console.log(JSON.stringify(unallowedForeign, null, 2));
  }
  const unallowedOrphans = report.orphan_deployed.filter((o) => !o.allowlisted);
  if (unallowedOrphans.length > 0) {
    console.log("\n[drift] ℹ ORPHAN DEPLOYED (not allowlisted):");
    console.log(JSON.stringify(unallowedOrphans, null, 2));
  }
  if (report.orphan_local.length > 0) {
    console.log("\n[drift] ℹ ORPHAN LOCAL (not deployed yet):");
    console.log(JSON.stringify(report.orphan_local, null, 2));
  }
  if (report.in_sync.length > 0) {
    console.log("\n[drift] ✓ IN-SYNC FUNCTIONS:");
    for (const f of report.in_sync) {
      console.log(`  ${f.slug.padEnd(28)} v${f.version}  hash=${f.hash}`);
    }
  }

  // Exit code policy:
  //   drifted > 0                            → FAIL (1)
  //   non-allowlisted foreign_entrypoint > 0 → FAIL (1)
  //   non-allowlisted orphan_deployed > 0    → FAIL (1)
  //   orphan_local > 0                       → WARN (still exit 0)
  const fail = report.drifted.length > 0 || unallowedForeign.length > 0 || unallowedOrphans.length > 0;
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("[drift] fatal:", e);
  process.exit(2);
});
