/**
 * Rule: no-or-company-id-null
 *
 * Rationale (Wave 8 finding R-1600 / R-1606 / R-920 / R-1611, MASTER P0-A1/P0-A3):
 * The most common cross-tenant RLS leak in this codebase comes from policy expressions
 * shaped like:
 *
 *   USING (company_id = current_company_id() OR company_id IS NULL)
 *
 * The `OR company_id IS NULL` short-circuit was likely added to "fix" a NULL-row edge
 * case during initial development, but it makes EVERY null-company-id row visible to
 * EVERY tenant. The correct fix is to make `company_id` NOT NULL with a backfill
 * migration, then drop the OR-NULL clause.
 *
 * Sibling forbidden patterns covered by this rule:
 *   - `USING (true)` / `USING(TRUE)`            — R-1611: unrestricted SELECT
 *   - `WITH CHECK (true)` / `WITH CHECK(TRUE)`  — R-920:  unrestricted INSERT/UPDATE
 *   - `WITH CHECK (TRUE)` on audit_log          — R-920 + R-1374: forensic chain bypass
 *
 * Detection strategy: we mask SQL comments and string literals first, then run regex
 * against the cleaned source. This eliminates false positives from `-- comment OR
 * company_id IS NULL`, `'WITH CHECK (TRUE)'` (a string literal in a doc), etc.
 *
 * World-class refs:
 *   - PostgreSQL RLS docs — "Row Security Policies"
 *   - Supabase RLS best practices — "Always restrict by auth.uid() or scoped claim"
 *   - OWASP API3:2023 — Broken Object Property Level Authorization
 *   - CWE-639 — Authorization Bypass Through User-Controlled Key
 *   - PHASE_0_DOCTRINE.md §3 [RLS / DB]
 */

import type { Rule, RuleContext, Violation } from '../types.js';
import { findAll, maskCommentsAndStrings } from '../parsers/sql.js';

const RULE_ID = 'no-or-company-id-null';

// Each pattern carries: regex, severity, human-readable category, fix direction.
interface SqlPattern {
  re: RegExp;
  category: string;
  audit: string;
  fix: string;
}

const PATTERNS: SqlPattern[] = [
  {
    re: /\bOR\s+company_id\s+IS\s+NULL\b/gi,
    category: 'cross-tenant leak — `OR company_id IS NULL` short-circuit',
    audit: 'R-1600 / R-1606',
    fix:
      'Drop the `OR company_id IS NULL` clause. Make `company_id NOT NULL` ' +
      'with a backfill migration; reject null-tenant rows at INSERT time.',
  },
  {
    re: /\bUSING\s*\(\s*true\s*\)/gi,
    category: 'unrestricted RLS USING(true) — every tenant reads every row',
    audit: 'R-1611',
    fix:
      'Replace with a scoped expression, e.g. `USING (company_id = (SELECT company_id FROM ' +
      'profiles WHERE id = auth.uid()))` or use a SECURITY DEFINER helper.',
  },
  {
    re: /\bWITH\s+CHECK\s*\(\s*true\s*\)/gi,
    category: 'unrestricted RLS WITH CHECK(true) — every tenant writes any row',
    audit: 'R-920',
    fix:
      'Replace with a tenant-scoped WITH CHECK clause that ties the new row\'s ' +
      'company_id to the caller\'s claim. For audit_log specifically: WITH CHECK ' +
      '(actor_id = auth.uid()).',
  },
  {
    re: /\bUSING\s*\(\s*1\s*=\s*1\s*\)/gi,
    category: 'unrestricted USING(1=1) — same as USING(true), obfuscated',
    audit: 'R-1611-variant',
    fix: 'Same fix as USING(true): scope by tenant claim.',
  },
];

function check(ctx: RuleContext): Violation[] {
  if (!ctx.inScope) return [];
  const masked = maskCommentsAndStrings(ctx.source);
  const violations: Violation[] = [];

  for (const p of PATTERNS) {
    for (const hit of findAll(masked, new RegExp(p.re.source, p.re.flags))) {
      violations.push({
        ruleId: RULE_ID,
        severity: 'error',
        filePath: ctx.filePath,
        line: hit.line,
        column: hit.column,
        endLine: hit.line,
        endColumn: hit.column + hit.match.length,
        message:
          `Cross-tenant RLS pattern detected (${p.category}). Match: \`${hit.match.trim()}\`. ` +
          `This pattern leaks data across tenants — see audit ${p.audit}. ` +
          `Phase 0 ticket: MASTER_AUDIT P0-A1/P0-A3. ` +
          `Doctrine: PHASE_0_DOCTRINE.md §3 [RLS / DB].`,
        suggestedFix: p.fix,
        worldClassRef: [
          'PostgreSQL — Row Security Policies (RLS) docs',
          'Supabase — RLS best practices (scope by auth.uid())',
          'OWASP API3:2023 — Broken Object Property Level Authorization',
          'CWE-639 — Authorization Bypass Through User-Controlled Key',
        ],
        doctrineRef: 'PHASE_0_DOCTRINE.md §3 [RLS / DB] + MASTER_AUDIT P0-A1/P0-A3',
      });
    }
  }
  return violations;
}

// ---------- rule export ----------

const rule: Rule = {
  id: RULE_ID,
  description:
    'Forbid cross-tenant RLS short-circuits: `OR company_id IS NULL`, `USING(true)`, `WITH CHECK(true)` (R-1600/R-1611/R-920).',
  severity: 'error',
  scope: {
    include: [
      'supabase/migrations/**/*.sql',
      'supabase/*.sql',
      '*.sql',
      'supabase-*.sql',
    ],
    exclude: [
      // Skip the canonical fixture file (we ship it as reference).
      'supabase/migrations/_fixtures/**',
    ],
  },
  worldClassRef: [
    'PostgreSQL — Row Security Policies (RLS) docs',
    'Supabase — RLS best practices (scope by auth.uid())',
    'OWASP API3:2023 — Broken Object Property Level Authorization',
    'CWE-639 — Authorization Bypass Through User-Controlled Key',
  ],
  doctrineRef: 'PHASE_0_DOCTRINE.md §3 [RLS / DB] + MASTER_AUDIT P0-A1/P0-A3',
  check,
  fixtures: {
    bad: [
      {
        label: 'OR company_id IS NULL in USING clause',
        filePath: 'supabase/migrations/20260101_bad_rls.sql',
        reason: 'Canonical R-1600 pattern — every null-tenant row leaks.',
        minViolations: 1,
        code:
          'CREATE POLICY p ON public.evidence FOR SELECT\n' +
          '  USING (company_id = current_company_id() OR company_id IS NULL);\n',
      },
      {
        label: 'USING (true) on sensitive table',
        filePath: 'supabase/migrations/20260102_using_true.sql',
        reason: 'R-1611 — unrestricted SELECT for every authenticated user.',
        minViolations: 1,
        code: 'CREATE POLICY p ON public.geofences FOR SELECT USING (true);\n',
      },
      {
        label: 'WITH CHECK (TRUE) — audit-log forensic bypass',
        filePath: 'supabase/migrations/20260103_with_check_true.sql',
        reason: 'R-920 — anyone can forge audit_log entries.',
        minViolations: 1,
        code:
          'CREATE POLICY audit_open ON public.audit_log FOR INSERT\n' +
          '  WITH CHECK (TRUE);\n',
      },
      {
        label: 'USING(1=1) obfuscation',
        filePath: 'supabase/migrations/20260104_one_equals_one.sql',
        reason: 'R-1611-variant — same vulnerability as USING(true) but harder to grep.',
        minViolations: 1,
        code: 'CREATE POLICY p ON public.sensor_events FOR SELECT USING (1=1);\n',
      },
      {
        label: 'OR company_id IS NULL across multiple lines',
        filePath: 'supabase/migrations/20260105_multiline.sql',
        reason: 'Real migrations split the clause across lines; rule must handle whitespace.',
        minViolations: 1,
        code:
          'CREATE POLICY p ON public.incidents FOR SELECT USING (\n' +
          '  company_id = current_company_id()\n' +
          '  OR\n' +
          '  company_id IS NULL\n' +
          ');\n',
      },
      {
        label: 'WITH CHECK (true) on UPDATE policy',
        filePath: 'supabase/migrations/20260106_update_open.sql',
        reason: 'Covers WITH CHECK on UPDATE/INSERT, not just INSERT.',
        minViolations: 1,
        code:
          'CREATE POLICY u ON public.evidence FOR UPDATE\n' +
          '  USING (company_id = current_company_id())\n' +
          '  WITH CHECK (true);\n',
      },
    ],
    good: [
      {
        label: 'tenant-scoped USING',
        filePath: 'supabase/migrations/20260201_good_scoped.sql',
        reason: 'The canonical correct pattern.',
        code:
          'CREATE POLICY p ON public.evidence FOR SELECT\n' +
          '  USING (company_id = (SELECT company_id FROM profiles WHERE id = auth.uid()));\n',
      },
      {
        label: 'WITH CHECK with actor binding (audit_log)',
        filePath: 'supabase/migrations/20260202_audit_actor.sql',
        reason: 'Correct audit_log INSERT policy — actor_id forced from auth.uid().',
        code:
          'CREATE POLICY ins ON public.audit_log FOR INSERT\n' +
          '  WITH CHECK (actor_id = auth.uid());\n',
      },
      {
        label: 'comment mentions the bad pattern but it is a comment',
        filePath: 'supabase/migrations/20260203_comment.sql',
        reason: 'Mask comments — text inside `--` must not flag.',
        code:
          '-- WARNING: do NOT use OR company_id IS NULL — see R-1600\n' +
          'CREATE POLICY p ON public.t FOR SELECT USING (company_id = auth.uid());\n',
      },
      {
        label: 'string literal contains the pattern but is a string',
        filePath: 'supabase/migrations/20260204_string.sql',
        reason: 'Mask strings — text inside string literals must not flag.',
        code:
          'INSERT INTO public.audit_log (action, detail) VALUES\n' +
          '  (\'banned_pattern_check\', \'rule blocks: USING (true)\');\n',
      },
    ],
    properties: [
      {
        description: 'Any synthesized USING(true) MUST flag.',
        arbitrary: () => null,
        invariant: (_input, violations) => violations.length >= 1,
      },
      {
        description: 'Tenant-scoped USING (auth.uid() / current_company_id()) MUST NOT flag.',
        arbitrary: () => null,
        invariant: (_input, violations) => violations.length === 0,
      },
    ],
  },
};

export default rule;
