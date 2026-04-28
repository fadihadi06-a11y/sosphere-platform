// ═══════════════════════════════════════════════════════════════
// SOSphere — Android deep-link intent-filter source-pinning (BLOCKER #21)
// ─────────────────────────────────────────────────────────────
// Pins the AndroidManifest.xml intent-filters that route deep links
// from notifications, emails, and external pages into the app instead
// of the system browser.
//
// Without these, every Supabase auth callback (password reset, email
// verify, magic link) and every Stripe payment redirect bounces the
// user out to Chrome — breaking the auth flow and silently corrupting
// the subscription state.
//
// If a future refactor:
//   • drops the custom `sosphere://` scheme (notification taps stop working)
//   • drops a HTTPS pathPrefix (auth callback degrades to browser)
//   • removes autoVerify (Universal Links never get the chooser-free path)
//   • removes DEFAULT or BROWSABLE category (filter becomes inert)
// …this test fails and the regression is caught.
//
// IMPORTANT: AndroidManifest.xml uses CRLF line endings (Windows).
// We read it as UTF-8 and rely on substring matches (not regex).
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let manifestSrc = "";

beforeAll(() => {
  const cwd = process.cwd();
  manifestSrc = fs.readFileSync(
    path.resolve(cwd, "android/app/src/main/AndroidManifest.xml"),
    "utf8",
  );
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #21 / MainActivity intent-filters present", () => {
  it("MainActivity is declared and exported", () => {
    expect(manifestSrc).toContain('android:name=".MainActivity"');
    expect(manifestSrc).toContain('android:exported="true"');
  });

  it("the original LAUNCHER intent-filter is preserved", () => {
    expect(manifestSrc).toContain("android.intent.action.MAIN");
    expect(manifestSrc).toContain("android.intent.category.LAUNCHER");
  });

  it("at least 6 intent-filters declared (1 launcher + 5 deep-link)", () => {
    const count = (manifestSrc.match(/<intent-filter/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(6);
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #21 / Custom scheme — sosphere://", () => {
  it("sosphere:// scheme registered (for notification navigation)", () => {
    expect(manifestSrc).toContain('android:scheme="sosphere"');
  });

  it("custom-scheme filter has DEFAULT + BROWSABLE categories", () => {
    // Without DEFAULT, implicit Intents won't match.
    // Without BROWSABLE, links from external apps (notifications,
    // mail, browser) can't launch us.
    expect(manifestSrc).toContain("android.intent.category.DEFAULT");
    expect(manifestSrc).toContain("android.intent.category.BROWSABLE");
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #21 / HTTPS App Links — sosphere-platform.vercel.app", () => {
  it("/auth/* path prefix registered (Supabase auth callbacks)", () => {
    expect(manifestSrc).toContain('android:pathPrefix="/auth"');
  });

  it("/reset-password path prefix registered", () => {
    expect(manifestSrc).toContain('android:pathPrefix="/reset-password"');
  });

  it("/payment-success path prefix registered (Stripe return)", () => {
    expect(manifestSrc).toContain('android:pathPrefix="/payment-success"');
  });

  it("/payment-cancelled path prefix registered (Stripe return)", () => {
    expect(manifestSrc).toContain('android:pathPrefix="/payment-cancelled"');
  });

  it("/shared-sos path prefix registered (web-viewer SOS link)", () => {
    expect(manifestSrc).toContain('android:pathPrefix="/shared-sos"');
  });

  it("HTTPS host is sosphere-platform.vercel.app", () => {
    expect(manifestSrc).toContain('android:host="sosphere-platform.vercel.app"');
  });

  it("autoVerify enabled on every HTTPS app-link filter", () => {
    // autoVerify="true" + a properly-served /.well-known/assetlinks.json
    // on the domain = Universal Link with no browser chooser.
    // Removing it forces the chooser dialog every time.
    const autoVerifyCount = (manifestSrc.match(/android:autoVerify="true"/g) || []).length;
    // 4 HTTPS filters × 1 autoVerify each = 4
    expect(autoVerifyCount).toBeGreaterThanOrEqual(4);
  });
});

// ─────────────────────────────────────────────────────────────
describe("BLOCKER #21 / regressions guarded", () => {
  it("custom-scheme uses scheme-only data (no host required)", () => {
    // sosphere://anything should match; specifying a host would
    // narrow the match unintentionally.
    // Pin: at least one <data android:scheme="sosphere" /> with no
    // android:host on the same line.
    const lines = manifestSrc.split(/\r?\n/);
    const customSchemeLine = lines.find((l) =>
      l.includes('android:scheme="sosphere"'),
    );
    expect(customSchemeLine).toBeDefined();
    expect(customSchemeLine!).not.toContain("android:host");
  });

  it("no http (insecure) scheme — only https for app links", () => {
    // App Links MUST be https. Allowing http:// here would let any
    // network attacker on a coffee-shop wifi forge an auth callback.
    expect(manifestSrc).not.toMatch(/android:scheme="http"\s/);
  });

  it("BLOCKER #21 marker present (helps grep for context)", () => {
    expect(manifestSrc).toContain("BLOCKER #21");
  });

  it("XML still parses (no broken tags from the edit)", () => {
    // Quick structural check: matched <activity ... </activity>,
    // matched <application ... </application>, manifest closes.
    const openActivity = (manifestSrc.match(/<activity/g) || []).length;
    const closeActivity = (manifestSrc.match(/<\/activity>/g) || []).length;
    expect(openActivity).toBe(closeActivity);
    expect(manifestSrc).toContain("</application>");
    expect(manifestSrc).toContain("</manifest>");
  });
});
