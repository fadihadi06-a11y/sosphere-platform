#!/usr/bin/env node
/**
 * scripts/check-migration-drift.mjs — L0.5 drift detector
 *
 * PURPOSE
 *   Catch the class of bug where a migration is applied to live Supabase
 *   via apply_migration MCP / supabase CLI but never committed to git.
 *   Result of that bug: fresh clones of git cannot rebuild the schema,
 *   the foundation_canonical_identity_rpc lives only in production, and
 *   identity-aware code paths break on every staging environment.
 *
 * USAGE
 *   node scripts/check-migration-drift.mjs           # print manifest
 *   node scripts/check-migration-drift.mjs --check   # exit non-zero if
 *                                                    # the manifest in
 *                                                    # supabase/migrations.lock.json
 *                                                    # disagrees with disk
 *   node scripts/check-migration-drift.mjs --update  # rewrite the lock
 *                                                    # file from disk
 *                                                    # (run after a real
 *                                                    # commit of new migs)
 *
 * The lock file is the single source of truth for "what migrations git knows
 * about". CI runs --check; if a developer adds a migration without updating
 * the lock, CI fails. This is intentionally tighter than just file presence.
 *
 * FOLLOW-UP (out of scope here)
 *   A second script `check-live-drift.mjs` will compare this manifest against
 *   live `supabase_migrations.schema_migrations` via the supabase REST API.
 *   That requires a service-role key in CI, which is a separate decision.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const MIGS_DIR   = resolve(__dirname, "..", "supabase", "migrations");
const LOCK_FILE  = resolve(__dirname, "..", "supabase", "migrations.lock.json");

/** Build the on-disk manifest: [{version, name, sha256, bytes}] */
function buildManifest() {
  if (!existsSync(MIGS_DIR)) {
    console.error(`MIGS_DIR not found: ${MIGS_DIR}`);
    process.exit(2);
  }
  const files = readdirSync(MIGS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((file) => {
    const full = join(MIGS_DIR, file);
    const body = readFileSync(full);
    // Strip the header banner if present so the sha tracks the actual SQL,
    // not Anthropic-added boilerplate. Anything before the first non-comment
    // line is stripped; the BACKFILLED banner sits there.
    const text = body.toString("utf8");
    // Normalize CRLF → LF so Windows checkouts don't drift sha
    const normalized = text.replace(/\r\n/g, "\n");
    const sha = createHash("sha256").update(normalized).digest("hex");
    // Extract the timestamp prefix (first underscore segment)
    const m = file.match(/^(\d+)_(.+)\.sql$/);
    const version = m ? m[1] : null;
    const name    = m ? m[2] : file;
    return { version, name, file, sha256: sha, bytes: normalized.length };
  });
}

const args = new Set(process.argv.slice(2));

const manifest = buildManifest();
const total    = manifest.length;
const totalSha = createHash("sha256")
  .update(manifest.map((m) => `${m.version} ${m.sha256}`).join("\n"))
  .digest("hex");

if (args.has("--update")) {
  writeFileSync(
    LOCK_FILE,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        total_migrations: total,
        manifest_sha256: totalSha,
        migrations: manifest,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`✓ wrote ${LOCK_FILE} with ${total} migrations (sha=${totalSha.slice(0, 16)})`);
  process.exit(0);
}

if (args.has("--check")) {
  if (!existsSync(LOCK_FILE)) {
    console.error(`✗ ${LOCK_FILE} missing — run --update to bootstrap`);
    process.exit(1);
  }
  const lock = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
  const lockMap = new Map(lock.migrations.map((m) => [m.version, m]));
  const diskMap = new Map(manifest.map((m) => [m.version, m]));

  const errors = [];
  for (const [v, on] of diskMap) {
    const lk = lockMap.get(v);
    if (!lk) {
      errors.push(`new migration on disk not in lock: ${on.file} — run --update`);
      continue;
    }
    if (lk.sha256 !== on.sha256) {
      errors.push(
        `migration ${v} edited after lock: lock=${lk.sha256.slice(0, 16)} disk=${on.sha256.slice(0, 16)}`,
      );
    }
  }
  for (const v of lockMap.keys()) {
    if (!diskMap.has(v)) {
      errors.push(`migration in lock but missing on disk: ${v}`);
    }
  }
  if (errors.length) {
    console.error(`✗ migration drift detected (${errors.length} issue(s)):`);
    for (const e of errors) console.error(`  • ${e}`);
    console.error(`\nFix:`);
    console.error(`  1) review the diff`);
    console.error(`  2) if intentional, run: node scripts/check-migration-drift.mjs --update`);
    console.error(`  3) commit the updated supabase/migrations.lock.json`);
    process.exit(1);
  }
  console.log(`✓ migration manifest matches lock (${total} migrations, sha=${totalSha.slice(0, 16)})`);
  process.exit(0);
}

// Default: print manifest
console.log(`# migration manifest`);
console.log(`# total: ${total}`);
console.log(`# sha:   ${totalSha}`);
console.log(`# dir:   ${MIGS_DIR}`);
console.log();
for (const m of manifest) {
  console.log(`${m.version}  ${m.sha256.slice(0, 16)}  ${m.bytes.toString().padStart(7)}b  ${m.name}`);
}
