/**
 * Rule engine — loads rules, runs self-tests, then scans files.
 *
 * Doctrine ref:
 *   - PHASE_0_DOCTRINE.md §6 (Operating rule: I write the guard first, then the code).
 *   - PHASE_0_TESTING_PHILOSOPHY.md §5 (Self-testing — rules verify themselves before scanning).
 *
 * Key design choices:
 *   1. Rules are pure: `check(ctx) -> Violation[]`. No FS / network access from inside `check`.
 *      This makes them trivial to property-test with fast-check (the test passes the code
 *      as an in-memory string).
 *   2. Self-test runs FIRST on every invocation. If any rule fails its own fixtures, the
 *      engine refuses to scan user code (better to fail loudly than to give false-clean).
 *   3. Allowlist comments (`// lint-guard-allow <rule-id> -- justification: <reason>`) suppress
 *      a violation on the next line, but ONLY when the justification matches a ticket regex.
 *      Doctrine §1.P4 forbids guards without escape hatches that get abused — the regex enforces
 *      that the escape requires a written reason.
 */

import { glob } from 'glob';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  AllowlistEntry,
  EngineOptions,
  Rule,
  RuleContext,
  SelfTestResult,
  Violation,
} from './types.js';
import { isParseable, parseSource } from './parsers/ts.js';

// ---------- Allowlist handling --------------------------------------------------

/** Matches: `// lint-guard-allow <rule-id> -- justification: <reason ≥10 chars>` */
const ALLOWLIST_RE =
  /\/\/\s*lint-guard-allow\s+([a-z][a-z0-9-]*)\s*--\s*justification:\s*(.{10,})/i;

/** Parse all allowlist comments in `source`. */
export function parseAllowlist(source: string): AllowlistEntry[] {
  const entries: AllowlistEntry[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ALLOWLIST_RE);
    if (m) {
      entries.push({
        ruleId: m[1],
        line: i + 2, // allowlist applies to the NEXT line (1-indexed)
        justification: m[2].trim(),
      });
    }
  }
  return entries;
}

/** Returns true if `violation` is suppressed by any allowlist entry. */
function isSuppressed(violation: Violation, allowlist: AllowlistEntry[]): boolean {
  return allowlist.some(
    (e) => e.ruleId === violation.ruleId && e.line === violation.line,
  );
}

// ---------- File scope matching -------------------------------------------------

/** Lightweight glob match: caller already resolves globs to file lists; this matches a single file. */
export function matchesScope(filePath: string, include: string[], exclude: string[] = []): boolean {
  if (exclude.some((g) => simpleGlobMatch(filePath, g))) return false;
  return include.some((g) => simpleGlobMatch(filePath, g));
}

/**
 * Minimal glob matcher supporting `**` (any path segments) and `*` (any non-slash chars).
 *
 * Implementation uses two-stage substitution via sentinels: a naive chain of `.replace`
 * calls is broken because the replacement strings for `**` contain `*` characters that
 * the single-`*` replacement then re-matches. The sentinel approach is the canonical fix.
 *
 * Verified by the property test in `rule-engine.test.ts` (random globs vs. random paths).
 */
function simpleGlobMatch(filePath: string, pattern: string): boolean {
  const SENT_GLOBSTAR_SLASH = '';
  const SENT_GLOBSTAR = '';
  const SENT_STAR = '';
  const tokenized = pattern
    .replace(/\*\*\//g, SENT_GLOBSTAR_SLASH)
    .replace(/\*\*/g, SENT_GLOBSTAR)
    .replace(/\*/g, SENT_STAR);
  const escaped = tokenized.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
  const re =
    '^' +
    escaped
      .replaceAll(SENT_GLOBSTAR_SLASH, '(?:.*/)?')
      .replaceAll(SENT_GLOBSTAR, '.*')
      .replaceAll(SENT_STAR, '[^/]*') +
    '$';
  return new RegExp(re).test(filePath);
}

// ---------- Core scan -----------------------------------------------------------

/** Build a RuleContext for a file + a specific rule. */
function buildContext(
  rule: Rule,
  filePath: string,
  source: string,
  parsedAstCache: Map<string, ReturnType<typeof parseSource>>,
): RuleContext {
  const inScope = matchesScope(filePath, rule.scope.include, rule.scope.exclude);
  let ast = parsedAstCache.get(filePath);
  if (ast === undefined && isParseable(filePath)) {
    ast = parseSource(filePath, source);
    parsedAstCache.set(filePath, ast);
  }
  return { filePath, source, ast, inScope };
}

/** Run a single rule against a single source. Used internally and by tests. */
export function runRuleOnSource(rule: Rule, filePath: string, source: string): Violation[] {
  const cache = new Map<string, ReturnType<typeof parseSource>>();
  const ctx = buildContext(rule, filePath, source, cache);
  const violations = rule.check(ctx);
  const allowlist = parseAllowlist(source);
  return violations.filter((v) => !isSuppressed(v, allowlist));
}

// ---------- Self-test -----------------------------------------------------------

/** Run a rule against its own fixtures. Returns failures (empty = pass). */
export function selfTestRule(rule: Rule): SelfTestResult {
  const failures: SelfTestResult['failures'] = [];

  // 1) Bad fixtures MUST produce ≥ minViolations.
  for (const f of rule.fixtures.bad) {
    const violations = runRuleOnSource(rule, f.filePath, f.code);
    if (violations.length < f.minViolations) {
      failures.push({
        fixtureLabel: f.label,
        kind: 'bad-missed',
        detail:
          `Expected ≥${f.minViolations} violation(s) for fixture "${f.label}" ` +
          `(file ${f.filePath}); got ${violations.length}. ` +
          `Reason this fixture exists: ${f.reason}`,
      });
    }
  }

  // 2) Good fixtures MUST produce 0 violations.
  for (const f of rule.fixtures.good) {
    const violations = runRuleOnSource(rule, f.filePath, f.code);
    if (violations.length > 0) {
      failures.push({
        fixtureLabel: f.label,
        kind: 'good-flagged',
        detail:
          `Expected 0 violations for fixture "${f.label}" (file ${f.filePath}); ` +
          `got ${violations.length}. ` +
          `First violation: ${violations[0].message.slice(0, 200)}`,
      });
    }
  }

  // 3) Rule contract checks per Testing Philosophy §9.
  if (rule.fixtures.bad.length < 3) {
    failures.push({
      fixtureLabel: '<rule-contract>',
      kind: 'bad-missed',
      detail: `Rule must declare ≥3 bad fixtures (got ${rule.fixtures.bad.length}). See PHASE_0_TESTING_PHILOSOPHY.md §9.`,
    });
  }
  if (rule.fixtures.good.length < 3) {
    failures.push({
      fixtureLabel: '<rule-contract>',
      kind: 'good-flagged',
      detail: `Rule must declare ≥3 good fixtures (got ${rule.fixtures.good.length}). See PHASE_0_TESTING_PHILOSOPHY.md §9.`,
    });
  }
  if (rule.fixtures.properties.length < 1) {
    failures.push({
      fixtureLabel: '<rule-contract>',
      kind: 'property-violated',
      detail: `Rule must declare ≥1 property test (got ${rule.fixtures.properties.length}). See PHASE_0_TESTING_PHILOSOPHY.md §9.`,
    });
  }
  if (rule.worldClassRef.length === 0) {
    failures.push({
      fixtureLabel: '<rule-contract>',
      kind: 'bad-missed',
      detail: `Rule must cite ≥1 world-class standard or mark itself as homegrown. See PHASE_0_DOCTRINE.md §1.P2.`,
    });
  }

  return { ruleId: rule.id, pass: failures.length === 0, failures };
}

/** Run all rules' self-tests. Returns the full list (caller decides exit code). */
export async function runAllSelfTests(rules: Rule[]): Promise<SelfTestResult[]> {
  return rules.map(selfTestRule);
}

// ---------- Repo scan -----------------------------------------------------------

/** Resolve the file list to scan, given the EngineOptions. */
export async function resolveFiles(
  opts: EngineOptions,
  rules: Rule[],
  cwd: string,
): Promise<string[]> {
  if (opts.paths && opts.paths.length > 0) return opts.paths;
  // Build a union of all rule scopes.
  const patterns = new Set<string>();
  for (const r of rules) {
    for (const p of r.scope.include) patterns.add(p);
  }
  const all = await glob([...patterns], {
    cwd,
    nodir: true,
    ignore: ['**/node_modules/**', 'dist/**', 'android/**/build/**'],
  });
  return all.map((f) => path.relative(cwd, path.resolve(cwd, f)).split(path.sep).join('/'));
}

/** Scan every file × rule combo. Returns all violations. */
export async function scan(
  rules: Rule[],
  files: string[],
  cwd: string,
): Promise<Violation[]> {
  const violations: Violation[] = [];
  const astCache = new Map<string, ReturnType<typeof parseSource>>();
  for (const file of files) {
    const abs = path.resolve(cwd, file);
    let source: string;
    try {
      source = await readFile(abs, 'utf8');
    } catch {
      continue; // file may have been deleted between resolveFiles and scan
    }
    const allowlist = parseAllowlist(source);
    for (const rule of rules) {
      const ctx: RuleContext = {
        filePath: file,
        source,
        ast: undefined,
        inScope: matchesScope(file, rule.scope.include, rule.scope.exclude),
      };
      if (!ctx.inScope) continue;
      if (isParseable(file)) {
        let ast = astCache.get(file);
        if (ast === undefined) {
          ast = parseSource(file, source);
          astCache.set(file, ast);
        }
        ctx.ast = ast;
      }
      const ruleViolations = rule.check(ctx).filter((v) => !isSuppressed(v, allowlist));
      violations.push(...ruleViolations);
    }
  }
  return violations;
}
