/**
 * Human-readable reporter. Colored output for terminal; readable plain output when piped.
 */

import type { SelfTestResult, Violation } from '../types.js';

const isTTY = process.stdout.isTTY === true;
const c = {
  red: (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (isTTY ? `\x1b[36m${s}\x1b[0m` : s),
  dim: (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
};

export function reportViolations(violations: Violation[]): string {
  if (violations.length === 0) return c.green('  ✔ No violations.');
  const byFile = new Map<string, Violation[]>();
  for (const v of violations) {
    const arr = byFile.get(v.filePath) ?? [];
    arr.push(v);
    byFile.set(v.filePath, arr);
  }
  const out: string[] = [];
  for (const [file, list] of byFile) {
    out.push('');
    out.push(c.bold(file));
    for (const v of list) {
      const marker = v.severity === 'error' ? c.red('error') : c.yellow('warn');
      out.push(
        `  ${c.dim(`${v.line}:${v.column}`)}  ${marker}  ${c.cyan(v.ruleId)}`,
      );
      out.push(`    ${v.message}`);
      if (v.suggestedFix) out.push(c.dim(`    fix: ${v.suggestedFix}`));
      out.push(c.dim(`    doctrine: ${v.doctrineRef}`));
      out.push(
        c.dim(`    refs: ${v.worldClassRef.slice(0, 2).join(' | ')}${v.worldClassRef.length > 2 ? ' | …' : ''}`),
      );
    }
  }
  out.push('');
  out.push(
    `${c.red(`✗ ${violations.length} violation(s)`)} in ${byFile.size} file(s).`,
  );
  return out.join('\n');
}

export function reportSelfTests(results: SelfTestResult[]): string {
  const out: string[] = [];
  out.push(c.bold('Lint-Guard — Self-Test'));
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    if (r.pass) {
      passed++;
      out.push(`  ${c.green('✔')} ${r.ruleId}`);
    } else {
      failed++;
      out.push(`  ${c.red('✗')} ${r.ruleId}`);
      for (const f of r.failures) {
        out.push(c.dim(`      [${f.kind}] ${f.fixtureLabel}`));
        out.push(c.dim(`      ${f.detail}`));
      }
    }
  }
  out.push('');
  out.push(`  ${c.green(`${passed} passed`)}, ${failed > 0 ? c.red(`${failed} failed`) : `${failed} failed`}.`);
  return out.join('\n');
}
