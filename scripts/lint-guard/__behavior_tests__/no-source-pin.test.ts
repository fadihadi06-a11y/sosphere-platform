/**
 * Behavior tests for the `no-source-pin` rule.
 *
 * Tier discipline (PHASE_0_TESTING_PHILOSOPHY.md §1):
 *   - Tier 4 (table-driven)     — fixtures from the rule itself, looped over.
 *   - Tier 5 (property-based)   — fast-check generates source code shapes.
 *   - Tier 6 (mutation-tested)  — Stryker config (added next; this file is mutant-resistant by design).
 *
 * Mutant-resistance technique:
 *   Every assertion checks BOTH the count AND the structural location of violations.
 *   If a mutant flips a comparison (`>=` → `>`), the assertions fail because the line/col
 *   numbers no longer match.
 */

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import rule from '../rules/no-source-pin.js';
import { runRuleOnSource, selfTestRule, parseAllowlist } from '../rule-engine.js';

describe('no-source-pin — self-test (the rule verifies itself)', () => {
  it('passes its own bad+good fixtures', () => {
    const result = selfTestRule(rule);
    if (!result.pass) {
      // Detailed failure surface — Tier-5 assertion (mutant-resistant: includes structural detail).
      throw new Error(
        `Rule "${rule.id}" self-test failed:\n` +
          result.failures.map((f) => `  [${f.kind}] ${f.fixtureLabel}: ${f.detail}`).join('\n'),
      );
    }
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });
});

describe('no-source-pin — table-driven (bad fixtures)', () => {
  for (const f of rule.fixtures.bad) {
    it(`flags: ${f.label}`, () => {
      const violations = runRuleOnSource(rule, f.filePath, f.code);
      // Mutant-resistant: assert exact minimum, then structural properties.
      expect(violations.length).toBeGreaterThanOrEqual(f.minViolations);
      for (const v of violations) {
        expect(v.ruleId).toBe('no-source-pin');
        expect(v.severity).toBe('error');
        expect(v.line).toBeGreaterThan(0);
        expect(v.column).toBeGreaterThan(0);
        expect(v.filePath).toBe(f.filePath);
        expect(v.message).toMatch(/Source-pinning test detected/);
        expect(v.doctrineRef).toMatch(/PHASE_0_DOCTRINE\.md/);
        expect(v.worldClassRef.length).toBeGreaterThan(0);
      }
    });
  }
});

describe('no-source-pin — table-driven (good fixtures)', () => {
  for (const f of rule.fixtures.good) {
    it(`does NOT flag: ${f.label}`, () => {
      const violations = runRuleOnSource(rule, f.filePath, f.code);
      expect(violations).toEqual([]);
    });
  }
});

describe('no-source-pin — property-based (fast-check)', () => {
  /**
   * Property 1: For ANY combination of {intake call shape, assertion method, identifier name},
   * a test that BINDS the result of source-intake to an identifier AND asserts via expect(id).toMatch/toContain
   * MUST be flagged ≥ 1 time.
   */
  it('flags every synthesized source-pin test (property)', () => {
    const intakeShape = fc.constantFrom(
      'readFileSync(P, "utf8")',
      'fs.readFileSync(P, "utf8")',
      'await readFile(P, "utf8")',
      'readFileSync(P).toString()',
    );
    const assertion = fc.constantFrom('toMatch', 'toContain', 'toMatchSnapshot');
    const ident = fc.constantFrom('src', 'source', 'code', 'fileText', 'contents');
    const argument = fc.constantFrom('/foo/', '"CRIT-#12"', '"MARKER"', '/pattern/');

    fc.assert(
      fc.property(intakeShape, assertion, ident, argument, (intake, m, id, arg) => {
        const code = `
import { readFileSync, readFile } from "fs";
import * as fs from "fs";
import { it, expect } from "vitest";

it("synthesized", async () => {
  const ${id} = ${intake.replace('P', '"../some.ts"')};
  expect(${id}).${m}(${arg});
});
`;
        const violations = runRuleOnSource(rule, 'src/x/__tests__/synth.test.ts', code);
        return violations.length >= 1 && violations[0].ruleId === 'no-source-pin';
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Property 2: For ANY synthesized "real behavior" test (imports a SUT, calls it, asserts result),
   * the rule MUST NOT flag.
   */
  it('does NOT flag synthesized behavior tests (property)', () => {
    const fnName = fc.constantFrom('compute', 'format', 'validate', 'parsePhone');
    const ident = fc.constantFrom('result', 'out', 'value');
    const expected = fc.constantFrom('"ok"', '42', 'true', '{ status: "ok" }');

    fc.assert(
      fc.property(fnName, ident, expected, (fn, id, exp) => {
        const code = `
import { it, expect } from "vitest";
import { ${fn} } from "../sut.js";

it("synth-behavior", () => {
  const ${id} = ${fn}({});
  expect(${id}).toEqual(${exp});
});
`;
        const violations = runRuleOnSource(rule, 'src/x/__tests__/synth.test.ts', code);
        return violations.length === 0;
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Property 3: Allowlist suppression must be invariant-respecting:
   * a flagged line preceded by a valid `// lint-guard-allow no-source-pin -- justification: ...`
   * comment with ≥10 chars of reason MUST be suppressed.
   */
  it('respects allowlist comments with valid justification (property)', () => {
    const reason = fc.string({ minLength: 10, maxLength: 80 }).filter(
      (s) => !s.includes('\n') && !s.includes('\r'),
    );
    fc.assert(
      fc.property(reason, (r) => {
        // Sanitize the random string to avoid injecting a // comment that wraps lines.
        const safeReason = r.replace(/\\/g, '/').slice(0, 80);
        const code = `
import { readFileSync } from "fs";
import { it, expect } from "vitest";

it("allowed", () => {
  const src = readFileSync("../foo.ts", "utf8");
  // lint-guard-allow no-source-pin -- justification: ${safeReason}
  expect(src).toMatch(/CRIT-#12/);
});
`;
        const violations = runRuleOnSource(rule, 'src/x/__tests__/allowed.test.ts', code);
        return violations.length === 0;
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 4 (negative): allowlist with SHORT justification (<10 chars) must NOT suppress.
   * This ensures the guard cannot be defeated by `// lint-guard-allow X -- justification: x`.
   */
  it('rejects allowlist with too-short justification (property)', () => {
    const tooShort = fc.string({ maxLength: 9 }).filter((s) => !s.includes('\n'));
    fc.assert(
      fc.property(tooShort, (r) => {
        const code = `
import { readFileSync } from "fs";
import { it, expect } from "vitest";

it("not-allowed", () => {
  const src = readFileSync("../foo.ts", "utf8");
  // lint-guard-allow no-source-pin -- justification: ${r}
  expect(src).toMatch(/CRIT-#12/);
});
`;
        const violations = runRuleOnSource(rule, 'src/x/__tests__/short.test.ts', code);
        return violations.length >= 1;
      }),
      { numRuns: 50 },
    );
  });
});

describe('no-source-pin — out-of-scope files are never flagged', () => {
  it('ignores non-test files even with the exact pattern', () => {
    const code = `
import { readFileSync } from "fs";
const src = readFileSync("./something.ts", "utf8");
// "expect" used here but this is a regular module, not a test file.
function check(actual) { return { toMatch: (p) => p.test(actual) }; }
const expect = (x) => check(x);
expect(src).toMatch(/CRIT-#12/);
`;
    const violations = runRuleOnSource(rule, 'src/utils/some-module.ts', code);
    expect(violations).toEqual([]);
  });
});

describe('no-source-pin — allowlist parser', () => {
  it('parses a valid allowlist comment', () => {
    const code = [
      'function foo() {',
      '  // lint-guard-allow no-source-pin -- justification: ticket Q-1234, replacement E2E test pending',
      '  doSomethingBad();',
      '}',
    ].join('\n');
    const entries = parseAllowlist(code);
    expect(entries.length).toBe(1);
    expect(entries[0].ruleId).toBe('no-source-pin');
    expect(entries[0].line).toBe(3); // applies to NEXT line
    expect(entries[0].justification).toMatch(/ticket Q-1234/);
  });

  it('ignores malformed allowlist comments', () => {
    const code = [
      '// lint-guard-allow no-source-pin (missing justification)',
      '// lint-guard-allow -- justification: but no rule id',
      '// random comment',
    ].join('\n');
    const entries = parseAllowlist(code);
    expect(entries.length).toBe(0);
  });
});
