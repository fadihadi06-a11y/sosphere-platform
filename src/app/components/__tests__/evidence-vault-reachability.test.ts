// ═══════════════════════════════════════════════════════════════
// SOSphere — evidence-vault-service reachability test
// (CRIT-#9 false-positive guard, 2026-04-27)
// ─────────────────────────────────────────────────────────────
// The deep-audit pass on 2026-04-27 marked evidence-vault-service.ts
// as "dead code (zero importers)" based on a static `grep "from
// './evidence-vault-service'"` sweep. The grep missed three
// dynamic-import call sites:
//
//   1. sos-emergency.tsx:1903       — createVault() on SOS end
//   2. mobile-app.tsx:1053          — syncPendingVaults +
//                                     autoLockExpiredVaults on app
//                                     resume / 30-min timer
//   3. emergency-response-record.tsx — vault lookup for PDF render
//
// All three use `await import("./evidence-vault-service")` which
// `grep "from './evidence-vault-service'"` does NOT match.
//
// This test pins the importer chain so a future audit cannot reopen
// the same false positive — and so a refactor that drops one of
// these dynamic imports gets caught at test time, not in production.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let sosEmergencySrc = "";
let mobileAppSrc = "";
let emergencyResponseRecordSrc = "";
let vaultModuleSrc = "";

beforeAll(() => {
  const cwd = process.cwd();
  sosEmergencySrc = fs.readFileSync(
    path.resolve(cwd, "src/app/components/sos-emergency.tsx"), "utf8");
  mobileAppSrc = fs.readFileSync(
    path.resolve(cwd, "src/app/components/mobile-app.tsx"), "utf8");
  emergencyResponseRecordSrc = fs.readFileSync(
    path.resolve(cwd, "src/app/components/emergency-response-record.tsx"), "utf8");
  vaultModuleSrc = fs.readFileSync(
    path.resolve(cwd, "src/app/components/evidence-vault-service.ts"), "utf8");
});

describe("CRIT-#9 — evidence-vault-service reachability (false-positive guard)", () => {
  it("sos-emergency.tsx dynamically imports evidence-vault-service.createVault on SOS end", () => {
    expect(sosEmergencySrc).toMatch(
      /const\s*\{\s*createVault\s*\}\s*=\s*await\s+import\(\s*["']\.\/evidence-vault-service["']\s*\)/,
    );
    // And actually CALLS it (not just imports).
    expect(sosEmergencySrc).toMatch(/await\s+createVault\s*\(/);
  });

  it("mobile-app.tsx dynamically imports the vault sync + auto-lock helpers", () => {
    expect(mobileAppSrc).toMatch(
      /const\s*\{[^}]*syncPendingVaults[^}]*autoLockExpiredVaults[^}]*\}\s*=\s*await\s+import\(\s*["']\.\/evidence-vault-service["']\s*\)/,
    );
  });

  it("emergency-response-record.tsx dynamically imports the vault module for PDF lookup", () => {
    expect(emergencyResponseRecordSrc).toMatch(
      /await\s+import\(\s*["']\.\/evidence-vault-service["']\s*\)/,
    );
  });

  it("evidence-vault-service exports the symbols its callers depend on", () => {
    // If any of these export-names disappears, the dynamic imports above
    // would 'undefined' silently — pin the public surface.
    expect(vaultModuleSrc).toMatch(/export\s+async\s+function\s+createVault\s*\(/);
    expect(vaultModuleSrc).toMatch(/export\s+async\s+function\s+syncPendingVaults\s*\(/);
    expect(vaultModuleSrc).toMatch(/export\s+async\s+function\s+autoLockExpiredVaults\s*\(/);
    expect(vaultModuleSrc).toMatch(/export\s+function\s+getVaultForEmergency\s*\(/);
    expect(vaultModuleSrc).toMatch(/export\s+async\s+function\s+verifyVaultIntegrity\s*\(/);
  });

  it("createVault populates an integrityHash (the 'tamper-evident' PDF claim is backed)", () => {
    // Look for the line that computes a SHA-256 hash and assigns it to
    // vault.integrityHash — this is what the PDF + audit chain rely on.
    expect(vaultModuleSrc).toMatch(/vault\.integrityHash\s*=\s*await\s+computeHash\(/);
    // And there is a verifier the PDF / audit log can call.
    expect(vaultModuleSrc).toMatch(/export\s+async\s+function\s+verifyVaultIntegrity/);
  });

  it("vault uses SOSphere offline storage (sosphere_evidence_vaults), distinct from evidence-store", () => {
    // Make sure we have not collapsed the two stores into one and broken
    // either the live capture path (evidence-store) or the locked package
    // path (evidence-vault-service). Two distinct keys, two distinct
    // concerns, both legitimate.
    expect(vaultModuleSrc).toContain('"sosphere_evidence_vaults"');           // plural — vault packages
    const storeSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/components/evidence-store.ts"), "utf8");
    expect(storeSrc).toContain('"sosphere_evidence_vault"');                  // singular — live entries
  });
});
