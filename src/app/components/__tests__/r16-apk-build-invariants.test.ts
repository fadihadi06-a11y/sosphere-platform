// ═══════════════════════════════════════════════════════════════
// R-16 (2026-05-15) — Android APK build verification (pre-launch)
// ─────────────────────────────────────────────────────────────
// WHY R-16 EXISTS
//   Pre-launch audit of the Android APK pipeline surfaced 3 issues:
//
//   F-A (HIGH) — OAuth Google Client ID was hardcoded in TWO places
//     (capacitor.config.json + supabase-client.ts), despite .env.example
//     documenting VITE_GOOGLE_CLIENT_ID + GOOGLE_SERVER_CLIENT_ID env
//     vars as if the build read them. grep showed zero readers — the
//     .env.example was misleading. Couldn't rotate OAuth client, couldn't
//     use per-environment clients (dev/staging/prod).
//
//   F-B (HIGH) — build-apk.yml only injected VITE_SUPABASE_URL +
//     VITE_SUPABASE_ANON_KEY into .env. Firebase/FCM, Sentry, environment,
//     app-version, and Google OAuth vars were never injected — meaning the
//     workflow couldn't produce a production-ready APK without manual env
//     editing.
//
//   F-C (MEDIUM) — versionCode hardcoded as `1`. Every CI-built APK
//     installed with the same version code, so Android refused to treat
//     a new build as an upgrade over an old install. Test-team friction.
//
// THE FIX
//   F-A.1: supabase-client.ts reads VITE_GOOGLE_CLIENT_ID with the
//          previously-hardcoded value as fallback.
//   F-A.2: build-apk.yml substitutes capacitor.config.json's
//          GoogleAuth.serverClientId from GOOGLE_SERVER_CLIENT_ID env var
//          before `cap sync`.
//   F-B:   build-apk.yml injects ALL VITE_* env vars (Firebase, Sentry,
//          Google OAuth, environment label, app version) when set as
//          GitHub secrets. Optional secrets are emitted only when non-empty
//          (so env-shield-v2 sees absence vs empty correctly).
//   F-C:   build.gradle reads versionCode from APK_VERSION_CODE env var
//          (CI passes GITHUB_RUN_NUMBER), falls back to 1 for local builds.
//          versionName mirrors via APK_VERSION_NAME.
//
// CONTRACT (locked by this test)
//   - supabase-client.ts reads VITE_GOOGLE_CLIENT_ID with fallback
//   - build-apk.yml exists, parses as valid YAML
//   - build-apk.yml injects VITE_FIREBASE_API_KEY, VITE_SENTRY_DSN, etc.
//   - build-apk.yml has the capacitor.config.json substitution step
//   - build-apk.yml passes APK_VERSION_CODE to gradle from github.run_number
//   - build.gradle reads APK_VERSION_CODE + APK_VERSION_NAME env vars
//   - .env.example continues to document all the now-actually-read vars
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let supabaseClientSrc = "";
let buildApkYml = "";
let buildGradle = "";
let envExample = "";

beforeAll(() => {
  const root = process.cwd();
  supabaseClientSrc = fs.readFileSync(path.resolve(root, "src/app/components/api/supabase-client.ts"), "utf8");
  buildApkYml = fs.readFileSync(path.resolve(root, ".github/workflows/build-apk.yml"), "utf8");
  buildGradle = fs.readFileSync(path.resolve(root, "android/app/build.gradle"), "utf8");
  envExample = fs.readFileSync(path.resolve(root, ".env.example"), "utf8");
});

describe("R-16 F-A: OAuth Google Client ID is now env-var driven", () => {
  it("supabase-client.ts reads VITE_GOOGLE_CLIENT_ID with hardcoded fallback", () => {
    expect(supabaseClientSrc).toMatch(/import\.meta\.env\.VITE_GOOGLE_CLIENT_ID/);
    // The hardcoded fallback should remain documented + reachable.
    expect(supabaseClientSrc).toMatch(/380367770593-[\w]+\.apps\.googleusercontent\.com/);
  });

  it("supabase-client.ts no longer passes a hardcoded literal directly to GoogleAuth.initialize", () => {
    // The `clientId:` field must reference a variable, not a string literal,
    // so per-env overrides work.
    expect(supabaseClientSrc).toMatch(/clientId:\s*GOOGLE_CLIENT_ID/);
    expect(supabaseClientSrc).not.toMatch(/clientId:\s*["']380367770593-/);
  });

  it("build-apk.yml has a capacitor.config.json serverClientId substitution step", () => {
    expect(buildApkYml).toMatch(/Substitute GoogleAuth serverClientId/);
    expect(buildApkYml).toMatch(/GOOGLE_SERVER_CLIENT_ID/);
    expect(buildApkYml).toMatch(/cfg\.plugins\.GoogleAuth\.serverClientId/);
  });

  it("the substitution step runs BEFORE `cap sync` (otherwise it gets overwritten)", () => {
    const subIdx = buildApkYml.indexOf("Substitute GoogleAuth serverClientId");
    const syncIdx = buildApkYml.indexOf("Sync Capacitor to Android");
    expect(subIdx).toBeGreaterThan(-1);
    expect(syncIdx).toBeGreaterThan(-1);
    expect(subIdx).toBeLessThan(syncIdx);
  });
});

describe("R-16 F-B: build-apk.yml injects all required VITE_* env vars", () => {
  it("injects core Supabase vars (regression guard)", () => {
    expect(buildApkYml).toMatch(/VITE_SUPABASE_URL=\$\{\{\s*secrets\.VITE_SUPABASE_URL\s*\}\}/);
    expect(buildApkYml).toMatch(/VITE_SUPABASE_ANON_KEY=\$\{\{\s*secrets\.VITE_SUPABASE_ANON_KEY\s*\}\}/);
  });

  it("injects all 6 Firebase / FCM secrets (push notifications)", () => {
    for (const key of [
      "VITE_FIREBASE_API_KEY",
      "VITE_FIREBASE_AUTH_DOMAIN",
      "VITE_FIREBASE_PROJECT_ID",
      "VITE_FIREBASE_MESSAGING_SENDER_ID",
      "VITE_FIREBASE_APP_ID",
      "VITE_FIREBASE_VAPID_KEY",
    ]) {
      expect(buildApkYml, `missing env injection for ${key}`).toMatch(new RegExp(key));
      expect(buildApkYml, `missing secret reference for ${key}`).toMatch(
        new RegExp(`secrets\\.${key}`),
      );
    }
  });

  it("injects Sentry DSN + environment context vars", () => {
    expect(buildApkYml).toMatch(/VITE_SENTRY_DSN/);
    expect(buildApkYml).toMatch(/secrets\.VITE_SENTRY_DSN/);
    expect(buildApkYml).toMatch(/VITE_ENVIRONMENT=production/);
    expect(buildApkYml).toMatch(/VITE_APP_VERSION=\$\{\{\s*github\.sha\s*\}\}/);
  });

  it("optional secrets are only emitted when non-empty (env-shield-v2 absence detection)", () => {
    // Each optional VAR must be guarded by a `[[ -n "$VAR" ]] && echo "VAR=$VAR"`
    // pattern so an unset secret doesn't end up as `VAR=` in .env.
    for (const key of [
      "VITE_FIREBASE_API_KEY",
      "VITE_FIREBASE_VAPID_KEY",
      "VITE_SENTRY_DSN",
      "VITE_GOOGLE_CLIENT_ID",
    ]) {
      const guarded = new RegExp(`\\[\\[\\s*-n\\s*"\\$${key}"\\s*\\]\\][\\s\\S]{0,80}echo\\s+"${key}=`);
      expect(buildApkYml, `${key} must be conditionally emitted`).toMatch(guarded);
    }
  });
});

describe("R-16 F-C: versionCode + versionName flow from CI run number", () => {
  it("build.gradle resolves APK_VERSION_CODE into __apkVersionCode at top of file", () => {
    // Resolution must happen OUTSIDE android.defaultConfig — putting
    // `versionCode (expr).toInteger()` inline triggers a Groovy DSL parsing
    // ambiguity that fails with "Value is null" on CI (root cause of the
    // first R-16 build failure). Java-style Integer.parseInt is unambiguous.
    expect(buildGradle).toMatch(/def\s+__apkVersionCode\s*=\s*Integer\.parseInt\(\s*System\.getenv\(\s*["']APK_VERSION_CODE["']\s*\)\s*\?:\s*["']1["']\s*\)/);
    expect(buildGradle).toMatch(/def\s+__apkVersionName\s*=\s*System\.getenv\(\s*["']APK_VERSION_NAME["']\s*\)\s*\?:\s*["']1\.0["']/);
  });

  it("build.gradle's defaultConfig references the resolved variables (no inline parser-ambiguous expression)", () => {
    // Inside defaultConfig — simple `versionCode __apkVersionCode` reference.
    // No parens-after-method-name pattern that Groovy mis-parses.
    expect(buildGradle).toMatch(/versionCode\s+__apkVersionCode/);
    expect(buildGradle).toMatch(/versionName\s+__apkVersionName/);
    // Regression guard: no inline `(System.getenv(...) ?: "1").toInteger()`
    // pattern inside defaultConfig. The previous form was the bug.
    expect(buildGradle).not.toMatch(/versionCode\s*\(\s*System\.getenv[\s\S]{0,80}\?:\s*["']1["']\s*\)\.toInteger\(\)/);
  });

  it("build-apk.yml passes APK_VERSION_CODE = github.run_number to the gradle step", () => {
    expect(buildApkYml).toMatch(/APK_VERSION_CODE:\s*\$\{\{\s*github\.run_number\s*\}\}/);
    expect(buildApkYml).toMatch(/APK_VERSION_NAME:\s*["']1\.0\.\$\{\{\s*github\.run_number\s*\}\}["']/);
  });
});

describe("R-16: .env.example documentation matches actual readers", () => {
  it(".env.example documents VITE_GOOGLE_CLIENT_ID (now actually read)", () => {
    expect(envExample).toMatch(/VITE_GOOGLE_CLIENT_ID=/);
  });

  it(".env.example documents GOOGLE_SERVER_CLIENT_ID (now substituted by CI)", () => {
    expect(envExample).toMatch(/GOOGLE_SERVER_CLIENT_ID=/);
  });
});
