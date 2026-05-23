/**
 * Rule: no-source-pin
 *
 * Rationale (Wave 9 finding R-2166): ~80% of the existing test suite reads its own
 * source file via `readFileSync` and then asserts string patterns against it. These
 * tests pass even when the implementation is removed, as long as the magic string
 * survives. This is "false coverage" — the lighthouse against this anti-pattern is
 * the difference between real safety and theatre.
 *
 * Detection strategy: AST analysis (NOT regex), in two stages.
 *
 *   Stage 1 — "source intake binding". An identifier becomes a source-intake binding
 *   when ANY of these shapes occur in the file:
 *     (a) `const X = readFileSync(...)`   (declaration with intake initializer)
 *     (b) `let X = ""; ... X = readFileSync(...)`   (re-assignment in a setup callback)
 *     (c) `const helper = (rel) => readFileSync(...); const X = helper(...)`
 *
 *   Stage 2 — "string assertion on intake binding":
 *     `expect(X).toMatch(...)` / `.toContain(...)` / `.toMatchSnapshot(...)` /
 *     `.toMatchInlineSnapshot(...)` where X is a Stage-1 binding.
 *
 * Both stages must be present to flag the file — this keeps false positives at zero
 * for legitimate `readFileSync` use (fixture loading) or legitimate `.toMatch` use
 * (against real function output).
 *
 * World-class refs:
 *   - Google Testing Blog — "Test Behavior, Not Implementation"
 *   - Kent C. Dodds — "Testing Implementation Details"
 *   - PHASE_0_TESTING_PHILOSOPHY.md §1 (Tier 0 — banned)
 *   - PHASE_0_DOCTRINE.md §3 ([TESTS] forbidden patterns)
 */

import ts from 'typescript';
import type { Rule, RuleContext, Violation } from '../types.js';
import { callChain, firstStringArg, nodePosition, walk } from '../parsers/ts.js';

const RULE_ID = 'no-source-pin';

const INTAKE_CALL_TAILS = new Set(['readFileSync', 'readFile']);
const STRING_ASSERT_METHODS = new Set([
  'toMatch',
  'toContain',
  'toMatchSnapshot',
  'toMatchInlineSnapshot',
]);

function check(ctx: RuleContext): Violation[] {
  if (!ctx.inScope || !ctx.ast) return [];
  const ast = ctx.ast;

  // Stage 1 — collect intake bindings.
  const intakeBindings = new Map<string, { line: number; column: number }>();
  const intakeHelpers = new Set<string>();

  walk(ast, (node) => {
    // (a) const/let with intake initializer.
    if (ts.isVariableDeclaration(node) && node.initializer && node.name) {
      if (ts.isIdentifier(node.name)) {
        if (isSourceIntakeExpression(node.initializer)) {
          const pos = nodePosition(ast, node);
          if (!intakeBindings.has(node.name.text)) {
            intakeBindings.set(node.name.text, { line: pos.line, column: pos.column });
          }
        } else if (isIntakeHelperDeclaration(node.initializer)) {
          intakeHelpers.add(node.name.text);
        }
      }
    }

    // (b) re-assignment: `sql = readFileSync(...)`
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      isSourceIntakeExpression(node.right)
    ) {
      const pos = nodePosition(ast, node);
      if (!intakeBindings.has(node.left.text)) {
        intakeBindings.set(node.left.text, { line: pos.line, column: pos.column });
      }
    }
  });

  // (c) Second pass — `const X = helper("...")` where helper is in intakeHelpers.
  if (intakeHelpers.size > 0) {
    walk(ast, (node) => {
      if (!ts.isVariableDeclaration(node) || !node.initializer || !node.name) return;
      if (!ts.isIdentifier(node.name)) return;
      const init = unwrap(node.initializer);
      if (!ts.isCallExpression(init)) return;
      const chain = callChain(init);
      if (chain.length === 1 && intakeHelpers.has(chain[0])) {
        const pos = nodePosition(ast, node);
        if (!intakeBindings.has(node.name.text)) {
          intakeBindings.set(node.name.text, { line: pos.line, column: pos.column });
        }
      }
    });
  }

  if (intakeBindings.size === 0) return [];

  // Stage 2 — flag `expect(<intake-id>).<string-assert>(...)`.
  const violations: Violation[] = [];
  walk(ast, (node) => {
    if (!ts.isCallExpression(node)) return;
    const chain = callChain(node);
    if (chain.length < 2) return;
    const lastMethod = chain[chain.length - 1];
    if (!STRING_ASSERT_METHODS.has(lastMethod)) return;
    if (chain[0] !== 'expect') return;

    const outerAccess = node.expression;
    if (!ts.isPropertyAccessExpression(outerAccess)) return;
    const innerCall = outerAccess.expression;
    if (!ts.isCallExpression(innerCall)) return;
    const expectArg = innerCall.arguments[0];
    if (!expectArg || !ts.isIdentifier(expectArg)) return;
    const intake = intakeBindings.get(expectArg.text);
    if (!intake) return;

    const pos = nodePosition(ast, node);
    violations.push({
      ruleId: RULE_ID,
      severity: 'error',
      filePath: ctx.filePath,
      line: pos.line,
      column: pos.column,
      endLine: pos.endLine,
      endColumn: pos.endColumn,
      message:
        `Source-pinning test detected: \`${expectArg.text}\` was bound from a source-intake call at ` +
        `line ${intake.line}, and is now asserted with \`${lastMethod}\`. This test passes even when ` +
        `the implementation is removed (the magic string survives). Replace with a behavior test that ` +
        `invokes the unit under test and asserts its observable output. ` +
        `See PHASE_0_TESTING_PHILOSOPHY.md §1 (Tier 0 — banned).`,
      suggestedFix:
        `Replace with: \`import { theFunction } from "../path"; const result = theFunction(input); expect(result).toEqual(...)\`.`,
      worldClassRef: [
        'Google Testing Blog — Test Behavior, Not Implementation',
        'Kent C. Dodds — Testing Implementation Details',
        'PHASE_0_TESTING_PHILOSOPHY.md §1 (Tier ladder)',
      ],
      doctrineRef: 'PHASE_0_DOCTRINE.md §3 [TESTS] no-source-pin',
    });
  });
  return violations;
}

// ---------- helpers ----------

function isSourceIntakeExpression(expr: ts.Expression): boolean {
  const e = unwrap(expr);
  if (!ts.isCallExpression(e)) return false;
  const chain = callChain(e);
  if (chain.length === 0) return false;
  const tail = chain[chain.length - 1];
  if (!INTAKE_CALL_TAILS.has(tail)) return false;
  return e.arguments.length >= 1;
}

function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (true) {
    if (ts.isAwaitExpression(e)) {
      e = e.expression;
      continue;
    }
    if (ts.isParenthesizedExpression(e)) {
      e = e.expression;
      continue;
    }
    if (ts.isAsExpression(e) || ts.isTypeAssertionExpression(e)) {
      e = e.expression;
      continue;
    }
    if (
      ts.isCallExpression(e) &&
      ts.isPropertyAccessExpression(e.expression) &&
      e.expression.name.text === 'toString'
    ) {
      e = e.expression.expression;
      continue;
    }
    break;
  }
  return e;
}

function isIntakeHelperDeclaration(expr: ts.Expression): boolean {
  const e = unwrap(expr);
  if (ts.isArrowFunction(e)) {
    if (ts.isBlock(e.body)) {
      let found = false;
      walk(e.body, (n) => {
        if (ts.isReturnStatement(n) && n.expression && isSourceIntakeExpression(n.expression)) {
          found = true;
        }
      });
      return found;
    }
    return isSourceIntakeExpression(e.body);
  }
  if (ts.isFunctionExpression(e) && e.body) {
    let found = false;
    walk(e.body, (n) => {
      if (ts.isReturnStatement(n) && n.expression && isSourceIntakeExpression(n.expression)) {
        found = true;
      }
    });
    return found;
  }
  return false;
}

// suppress unused-import on `firstStringArg` if it ever stops being used in the future.
void firstStringArg;


// suppress unused-import on firstStringArg if it ever stops being used.
void firstStringArg;

// ---------- rule export ----------

const rule: Rule = {
  id: RULE_ID,
  description: 'Forbid tests that read their own source file and string-assert it (R-2166).',
  severity: 'error',
  scope: {
    include: [
      'src/**/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.test.tsx',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'scripts/**/__behavior_tests__/**/*.test.ts',
    ],
  },
  worldClassRef: [
    'Google Testing Blog — Test Behavior, Not Implementation',
    'Kent C. Dodds — Testing Implementation Details',
    'PHASE_0_TESTING_PHILOSOPHY.md §1 (Tier 0 banned)',
  ],
  doctrineRef: 'PHASE_0_DOCTRINE.md §3 [TESTS]',
  check,
  fixtures: {
    bad: [
      {
        label: 'const + readFileSync + toMatch',
        filePath: 'src/foo/__tests__/a.test.ts',
        reason: 'Canonical R-2166 pattern.',
        minViolations: 1,
        code:
          'import { readFileSync } from "fs";\n' +
          'import { it, expect } from "vitest";\n' +
          'it("p", () => {\n' +
          '  const src = readFileSync("../foo.ts", "utf8");\n' +
          '  expect(src).toMatch(/CRIT-#12/);\n' +
          '});\n',
      },
      {
        label: 'fs.readFileSync + toContain',
        filePath: 'src/bar/__tests__/b.test.ts',
        reason: 'Namespace fs import + toContain.',
        minViolations: 1,
        code:
          'import * as fs from "fs";\n' +
          'import { it, expect } from "vitest";\n' +
          'it("p", () => {\n' +
          '  const code = fs.readFileSync("../bar.ts", "utf8");\n' +
          '  expect(code).toContain("MAGIC_FLAG");\n' +
          '});\n',
      },
      {
        label: 'await readFile (promises) + toMatch',
        filePath: 'src/baz/__tests__/c.test.ts',
        reason: 'Async readFile from node:fs/promises.',
        minViolations: 1,
        code:
          'import { readFile } from "node:fs/promises";\n' +
          'import { it, expect } from "vitest";\n' +
          'it("p", async () => {\n' +
          '  const src = await readFile("../baz.ts", "utf8");\n' +
          '  expect(src).toMatch(/exported function baz/);\n' +
          '});\n',
      },
      {
        label: 'readFileSync(...).toString()',
        filePath: 'src/qux/__tests__/d.test.ts',
        reason: 'Legacy two-arg style with explicit toString.',
        minViolations: 1,
        code:
          'import { readFileSync } from "fs";\n' +
          'import { it, expect } from "vitest";\n' +
          'it("p", () => {\n' +
          '  const text = readFileSync("../qux.ts").toString();\n' +
          '  expect(text).toContain("class Qux");\n' +
          '});\n',
      },
      {
        label: 'let X reassigned in beforeAll (real repo pattern)',
        filePath: 'src/quux/__tests__/e.test.ts',
        reason: 'Most common shape in the actual repo (R-2166).',
        minViolations: 1,
        code:
          'import { it, expect, beforeAll } from "vitest";\n' +
          'import * as fs from "node:fs";\n' +
          'let sql = "";\n' +
          'beforeAll(() => { sql = fs.readFileSync("x.sql", "utf8"); });\n' +
          'it("p", () => { expect(sql).toMatch(/REVOKE INSERT/); });\n',
      },
      {
        label: 'helper-function intake alias',
        filePath: 'src/zap/__tests__/f.test.ts',
        reason: 'Tests alias through a readFileSync helper.',
        minViolations: 1,
        code:
          'import * as fs from "node:fs";\n' +
          'import { it, expect } from "vitest";\n' +
          'const readSrc = (rel: string) => fs.readFileSync(rel, "utf8");\n' +
          'it("p", () => {\n' +
          '  const src = readSrc("../zap.ts");\n' +
          '  expect(src).toContain("class Zap");\n' +
          '});\n',
      },
    ],
    good: [
      {
        label: 'behavior test (gold standard)',
        filePath: 'src/foo/__tests__/behavior.test.ts',
        reason: 'Invokes SUT and asserts return value.',
        code:
          'import { it, expect } from "vitest";\n' +
          'import { computeSosTier } from "../sos-tier.js";\n' +
          'it("p", () => { expect(computeSosTier({ battery: 0.05 })).toBe("critical"); });\n',
      },
      {
        label: 'fixture load + parser assertion',
        filePath: 'src/parser/__tests__/parser.test.ts',
        reason: 'Legitimate fixture load; assertion on parser output, not file text.',
        code:
          'import { readFileSync } from "fs";\n' +
          'import { it, expect } from "vitest";\n' +
          'import { parsePayload } from "../parser.js";\n' +
          'it("p", () => {\n' +
          '  const xml = readFileSync("./fixtures/twiml.xml", "utf8");\n' +
          '  expect(parsePayload(xml)).toEqual({ callSid: "CA0", status: "ok" });\n' +
          '});\n',
      },
      {
        label: 'toMatch on function output',
        filePath: 'src/utils/__tests__/format.test.ts',
        reason: 'toMatch on real function return value.',
        code:
          'import { it, expect } from "vitest";\n' +
          'import { formatPhone } from "../format.js";\n' +
          'it("p", () => { expect(formatPhone("0501234567")).toMatch(/^\\+9665/); });\n',
      },
      {
        label: 'empty file',
        filePath: 'src/sos/__tests__/empty.test.ts',
        reason: 'Edge case.',
        code: 'import { describe } from "vitest";\ndescribe("x", () => {});\n',
      },
    ],
    properties: [
      {
        description: 'synthesized source-pin tests MUST flag >= 1',
        arbitrary: () => null,
        invariant: (_input, violations) => violations.length >= 1,
      },
      {
        description: 'synthesized behavior tests MUST NOT flag',
        arbitrary: () => null,
        invariant: (_input, violations) => violations.length === 0,
      },
    ],
  },
};

export default rule;
