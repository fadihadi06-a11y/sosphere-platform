/**
 * PIN GATE behavioral test (audit 2026-05-01)
 *
 * After commit 7eefa9b, doLogin() refuses to setStep('dashboard') unless
 * pinVerifiedRef.current === true. Static source analysis of the contracts
 * — vitest doesn't render React in this CI but the contracts are
 * sufficient because the gate logic is purely synchronous + side-effect-free
 * at the source-code level.
 *
 * If any assertion fails in CI, the bypass is back. NEVER skip-or-relax.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "..", "dashboard-web-page.tsx"),
  "utf8",
);

describe("PIN gate (root-cause fix for 6 historical bypass paths)", () => {
  it("declares pinVerifiedRef as useRef(false)", () => {
    expect(SRC).toMatch(/const\s+pinVerifiedRef\s*=\s*useRef\(false\)/);
  });

  it("doLogin() checks pinVerifiedRef before setStep(welcome)", () => {
    const m = SRC.match(/const\s+doLogin\s*=\s*useCallback\([\s\S]*?\}\s*,\s*\[\]\s*\)/);
    expect(m).not.toBeNull();
    const body = m![0];
    const gate = body.indexOf("pinVerifiedRef.current");
    const welcome = body.indexOf('setStep("welcome")');
    expect(gate).toBeGreaterThan(-1);
    expect(welcome).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(welcome);
  });

  it("doLogin() redirects to BOTH pin-setup and pin-verify when gate is closed", () => {
    const m = SRC.match(/const\s+doLogin\s*=\s*useCallback\([\s\S]*?\}\s*,\s*\[\]\s*\)/);
    const body = m![0];
    expect(body).toMatch(/setStep\("pin-verify"\)/);
    expect(body).toMatch(/setStep\("pin-setup"\)/);
  });

  it("only ONE setStep('dashboard') in entire file (inside doLogin)", () => {
    const matches = SRC.match(/setStep\(["']dashboard["']\)/g) || [];
    expect(matches.length).toBe(1);
  });

  it("pin-verify success opens gate before doLogin", () => {
    const i1 = SRC.indexOf("const valid = await checkPin(next)");
    const i2 = SRC.indexOf("pinVerifiedRef.current = true", i1);
    const i3 = SRC.indexOf("doLogin(pending.name", i2);
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(i3 - i1).toBeLessThan(800);
  });

  it("pin-setup confirm success opens gate before doLogin", () => {
    const i1 = SRC.indexOf("if (next === pinInput)");
    const i2 = SRC.indexOf("pinVerifiedRef.current = true", i1);
    const i3 = SRC.indexOf("doLogin(pending.name", i2);
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(i3 - i1).toBeLessThan(1000);
  });

  it("SIGNED_OUT handler closes gate", () => {
    const m = SRC.match(/if\s*\(\s*event\s*===\s*"SIGNED_OUT"\s*\)\s*\{[\s\S]{0,400}?\}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain("pinVerifiedRef.current = false");
  });

  it("dashboard onLogout closes gate before completeLogout()", () => {
    const oIdx = SRC.indexOf("onLogout={async");
    expect(oIdx).toBeGreaterThan(-1);
    const callIdx = SRC.indexOf("await completeLogout()", oIdx);
    const gateIdx = SRC.indexOf("pinVerifiedRef.current = false", oIdx);
    expect(gateIdx).toBeGreaterThan(oIdx);
    expect(gateIdx).toBeLessThan(callIdx);
  });

  it("'Sign in with different account' button closes gate", () => {
    // The label appears twice (once in a comment, once as rendered text);
    // assert against the LAST occurrence which is the rendered label.
    const occurrences: number[] = [];
    let i = 0;
    while ((i = SRC.indexOf("Sign in with different account", i)) !== -1) {
      occurrences.push(i);
      i += 1;
    }
    expect(occurrences.length).toBeGreaterThan(0);
    const labelIdx = occurrences[occurrences.length - 1];
    const btnIdx = SRC.lastIndexOf("<button onClick={async () => {", labelIdx);
    expect(btnIdx).toBeGreaterThan(-1);
    const gateIdx = SRC.indexOf("pinVerifiedRef.current = false", btnIdx);
    expect(gateIdx).toBeGreaterThan(btnIdx);
    expect(gateIdx).toBeLessThan(labelIdx);
  });

  it("does NOT persist pinVerified to localStorage (would defeat re-auth on reload)", () => {
    expect(SRC).not.toMatch(/localStorage\.setItem\([^,]*pinVerified/i);
    expect(SRC).not.toMatch(/localStorage\.setItem\([^,]*pin_verified/i);
  });
});
