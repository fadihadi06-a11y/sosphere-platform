#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// R-64 (MOBILE_AUDIT_FINDINGS, 2026-05-19) — regenerate assetlinks.json
// ─────────────────────────────────────────────────────────────────────────
// Re-extracts the SHA-256 fingerprint from the release keystore and writes
// it into public/.well-known/assetlinks.json. Run this whenever the
// release keystore is rotated.
//
// USAGE:
//   node scripts/regenerate-assetlinks.mjs
//
// PREREQ:
//   • Java keytool on PATH
//   • android/app/sosphere-release.jks present
//   • android/app/keystore.properties present (storePassword + keyAlias)
//
// VERIFICATION (after Vercel deploy):
//   curl -i https://sosphere-platform.vercel.app/.well-known/assetlinks.json
//   adb shell pm verify-app-links --re-verify com.sosphere.app
//   adb shell pm get-app-links com.sosphere.app
//   → should show domains as "verified"
// ═══════════════════════════════════════════════════════════════════════════

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const KEYSTORE = resolve(REPO_ROOT, "android/app/sosphere-release.jks");
const PROPS    = resolve(REPO_ROOT, "android/app/keystore.properties");
const OUTPUT   = resolve(REPO_ROOT, "public/.well-known/assetlinks.json");
const PACKAGE  = "com.sosphere.app";

if (!existsSync(KEYSTORE)) {
  console.error("[regenerate-assetlinks] missing keystore:", KEYSTORE);
  console.error("  run scripts/release-signing.ps1 first to generate it.");
  process.exit(1);
}
if (!existsSync(PROPS)) {
  console.error("[regenerate-assetlinks] missing keystore.properties:", PROPS);
  process.exit(1);
}

const props = Object.fromEntries(
  readFileSync(PROPS, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("=").map((s) => s.trim()))
);
if (!props.storePassword || !props.keyAlias) {
  console.error("[regenerate-assetlinks] keystore.properties missing storePassword or keyAlias");
  process.exit(1);
}

const keytoolCmd = `keytool -list -v -keystore "${KEYSTORE}" -storepass "${props.storePassword}" -alias "${props.keyAlias}"`;
let raw;
try {
  raw = execSync(keytoolCmd, { encoding: "utf8" });
} catch (err) {
  console.error("[regenerate-assetlinks] keytool failed:", err.message);
  process.exit(1);
}

const match = raw.match(/SHA256:\s*([0-9A-F:]+)/i);
if (!match) {
  console.error("[regenerate-assetlinks] could not parse SHA256 from keytool output");
  console.error(raw);
  process.exit(1);
}
const sha256 = match[1].toUpperCase();

const assetlinks = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: PACKAGE,
      sha256_cert_fingerprints: [sha256],
    },
  },
];

writeFileSync(OUTPUT, JSON.stringify(assetlinks, null, 2) + "\n", "utf8");
console.log(`[regenerate-assetlinks] wrote ${OUTPUT}`);
console.log(`  package:  ${PACKAGE}`);
console.log(`  sha256:   ${sha256}`);
console.log("");
console.log("Next steps:");
console.log("  1. Commit and push public/.well-known/assetlinks.json");
console.log("  2. Wait for Vercel to redeploy");
console.log("  3. curl -i https://sosphere-platform.vercel.app/.well-known/assetlinks.json");
console.log("  4. On test device: adb shell pm verify-app-links --re-verify com.sosphere.app");
