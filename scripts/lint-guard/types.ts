/**
 * Lint-Guard — Type definitions
 *
 * Doctrine ref: PHASE_0_DOCTRINE.md §3 (Forbidden Patterns) + §2 (L1, L3 guard layers)
 * Testing philosophy: PHASE_0_TESTING_PHILOSOPHY.md §1 (Tier ladder), §5 (self-testing)
 *
 * Every rule MUST satisfy the contract defined here. Rules are loaded by `rule-engine.ts`
 * and each undergoes a self-test before any user code is scanned.
 */

import type ts from 'typescript';

/** Severity of a violation. Maps to CI exit-code behavior. */
export type Severity = 'error' | 'warning';

/** Where the rule applies. */
export interface FileScope {
  /** Glob patterns the rule applies to (e.g. `**\/*.test.ts`). */
  include: string[];
  /** Glob patterns the rule explicitly excludes. */
  exclude?: string[];
}

/** A single rule violation. */
export interface Violation {
  ruleId: string;
  severity: Severity;
  filePath: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  /** Human-readable explanation. MUST include why it's dangerous + link to doctrine. */
  message: string;
  /** Optional concrete fix suggestion. */
  suggestedFix?: string;
  /** World-class standard refs cited by this rule (OWASP/NIST/RFC/etc.). */
  worldClassRef: string[];
  /** Doctrine section reference. */
  doctrineRef: string;
}

/** Pre-parsed context passed to each rule. Avoids re-parsing per rule. */
export interface RuleContext {
  filePath: string;
  source: string;
  /** Pre-parsed TS AST. Present iff the file is .ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs. */
  ast?: ts.SourceFile;
  /** True if the file's path matches the rule's FileScope. */
  inScope: boolean;
}

/** A test fixture — a code sample with an expected outcome. */
export interface RuleFixture {
  /** Short label for the report. */
  label: string;
  /** The code sample. */
  code: string;
  /** File path to attribute the sample to (controls FileScope matching). */
  filePath: string;
  /** Why this fixture exists — what specific gap it covers. */
  reason: string;
}

/** Property-based test generator. Run via fast-check. */
export interface PropertyTest {
  description: string;
  /** Returns a fast-check arbitrary. We accept `unknown` to avoid forcing rules to import fast-check at the type level. */
  arbitrary: () => unknown;
  /**
   * Invariant the rule must satisfy on every generated input.
   * Throws (or returns false) when the invariant is violated.
   */
  invariant: (input: { code: string; filePath: string }, violations: Violation[]) => boolean;
}

/**
 * The rule contract. Every rule in `rules/` MUST export a `default` of this shape.
 * Doctrine §3 + Testing Philosophy §9 — rules without self-test fixtures are rejected by the engine.
 */
export interface Rule {
  /** Stable identifier — used in allowlist comments + CI reports. */
  id: string;
  /** One-sentence description for human readers. */
  description: string;
  /** Default severity. */
  severity: Severity;
  /** Scope. */
  scope: FileScope;
  /** Cited standards. Empty = "homegrown; requires senior review" per Doctrine §1.P2. */
  worldClassRef: string[];
  /** Doctrine section that authorizes this rule. */
  doctrineRef: string;

  /** Main check function. Pure — must not read FS or network. */
  check(ctx: RuleContext): Violation[];

  /** Self-test fixtures. Run by `lint-guard --self-test` before any scan. */
  fixtures: {
    /** Code samples that MUST produce ≥1 violation. */
    bad: Array<RuleFixture & { minViolations: number }>;
    /** Code samples that MUST produce 0 violations. */
    good: RuleFixture[];
    /** Property-based generators. ≥1 required per Testing Philosophy §9. */
    properties: PropertyTest[];
  };
}

/** A rule's self-test result. */
export interface SelfTestResult {
  ruleId: string;
  pass: boolean;
  failures: Array<{
    fixtureLabel: string;
    kind: 'bad-missed' | 'good-flagged' | 'property-violated';
    detail: string;
  }>;
}

/** Allowlist comment: `// lint-guard-allow <rule-id> -- justification: <reason>` */
export interface AllowlistEntry {
  ruleId: string;
  line: number;
  justification: string;
}

/** Engine run options. */
export interface EngineOptions {
  /** Mode: scan-files, self-test, baseline, diff-vs-baseline, staged-only. */
  mode: 'scan' | 'self-test' | 'baseline' | 'diff' | 'staged' | 'staged-range';
  /** When in scan/staged mode: paths to check. Empty = all eligible files. */
  paths?: string[];
  /** When in staged-range mode: git ref range, e.g. `origin/main..HEAD`. */
  range?: string;
  /** Reporter to use for output. */
  reporter: 'human' | 'json' | 'sarif';
  /** When non-empty: only run these rule IDs. */
  onlyRules?: string[];
  /** Treat warnings as errors for CI. */
  failOnWarning?: boolean;
}
