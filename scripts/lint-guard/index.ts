#!/usr/bin/env node
/**
 * Lint-Guard CLI entry.
 *
 * Modes:
 *   --self-test          Run every rule against its own fixtures. Exit 1 on any failure.
 *   --baseline           Scan repo, write violations to PHASE_0_GUARDS_BASELINE.{md,json}
 *                        (does NOT fail). Used once at P0-Z0 bootstrap.
 *   --diff               Scan repo, compare against PHASE_0_GUARDS_BASELINE.json. Exit 1
 *                        on any NEW violation (regression). Fixed violations are reported
 *                        but do not block. This is the CI per-PR mode.
 *   --staged             Scan only files staged for commit (pre-commit hook mode).
 *   --staged-range RANGE Scan files changed in a git ref range (pre-push hook mode).
 *   (default)            Full scan of the repo against all rules.
 *
 * Reporters: --reporter human | json
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — violations found (or self-test failed)
 *   2 — invalid invocation / internal error
 *
 * Doctrine ref: PHASE_0_DOCTRINE.md §2 L1 + L3.
 */

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { allRules } from './rules/index.js';
import {
  resolveFiles,
  runAllSelfTests,
  scan,
} from './rule-engine.js';
import { reportSelfTests, reportViolations } from './reporters/human.js';
import { reportSelfTestsJson, reportViolationsJson } from './reporters/json.js';
import type { EngineOptions } from './types.js';

function parseArgs(argv: string[]): EngineOptions {
  const opts: EngineOptions = {
    mode: 'scan',
    reporter: 'human',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--self-test') opts.mode = 'self-test';
    else if (a === '--baseline') opts.mode = 'baseline';
    else if (a === '--diff') opts.mode = 'diff';
    else if (a === '--staged') opts.mode = 'staged';
    else if (a === '--staged-range') {
      opts.mode = 'staged-range';
      opts.range = argv[++i];
    } else if (a === '--reporter') {
      const r = argv[++i];
      if (r !== 'human' && r !== 'json') {
        die(`Unknown reporter: ${r}`);
      }
      opts.reporter = r as EngineOptions['reporter'];
    } else if (a === '--only') {
      opts.onlyRules = argv[++i].split(',');
    } else if (a === '--fail-on-warning') {
      opts.failOnWarning = true;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (a.startsWith('--')) {
      die(`Unknown flag: ${a}`);
    } else {
      (opts.paths ??= []).push(a);
    }
  }
  return opts;
}

function printHelp(): void {
  process.stdout.write(
    [
      'lint-guard — Phase 0 Lighthouse linter (Doctrine §3, Testing Philosophy §5)',
      '',
      'Usage:',
      '  lint-guard [files...]                Scan files (default: all eligible).',
      '  lint-guard --self-test               Verify every rule against its fixtures.',
      '  lint-guard --baseline                Write starting violations to PHASE_0_GUARDS_BASELINE.md.',
      '  lint-guard --staged                  Scan only files staged for commit.',
      '  lint-guard --staged-range RANGE      Scan files changed in a git ref range.',
      '',
      'Flags:',
      '  --reporter human|json                Output format (default: human).',
      '  --only id1,id2                       Only run these rule IDs.',
      '  --fail-on-warning                    Treat warnings as errors for exit code.',
      '',
    ].join('\n'),
  );
}

function die(msg: string): never {
  process.stderr.write(`lint-guard: ${msg}\n`);
  process.exit(2);
}

async function listStagedFiles(): Promise<string[]> {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

async function listRangeFiles(range: string): Promise<string[]> {
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', range], {
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  let rules = allRules;
  if (opts.onlyRules) {
    const set = new Set(opts.onlyRules);
    rules = rules.filter((r) => set.has(r.id));
    if (rules.length === 0) die(`No rules matched --only filter: ${opts.onlyRules.join(',')}`);
  }

  // ALWAYS run self-test first. A failing self-test means the linter is lying.
  const selfResults = await runAllSelfTests(rules);
  const selfFailed = selfResults.some((r) => !r.pass);
  if (opts.mode === 'self-test' || selfFailed) {
    process.stdout.write(
      opts.reporter === 'json' ? reportSelfTestsJson(selfResults) : reportSelfTests(selfResults),
    );
    process.stdout.write('\n');
    process.exit(selfFailed ? 1 : 0);
  }

  // Resolve files to scan.
  let files: string[];
  if (opts.mode === 'staged') {
    files = await listStagedFiles();
  } else if (opts.mode === 'staged-range') {
    if (!opts.range) die('--staged-range requires a RANGE argument');
    files = await listRangeFiles(opts.range);
  } else {
    files = await resolveFiles(opts, rules, cwd);
  }

  if (files.length === 0) {
    process.stdout.write(opts.reporter === 'json' ? '[]\n' : '(no files in scope)\n');
    process.exit(0);
  }

  const violations = await scan(rules, files, cwd);

  if (opts.mode === 'baseline') {
    const out = renderBaselineMarkdown(violations, files.length, rules.length);
    const mdPath = path.join(cwd, 'PHASE_0_GUARDS_BASELINE.md');
    const jsonPath = path.join(cwd, 'PHASE_0_GUARDS_BASELINE.json');
    await writeFile(mdPath, out, 'utf8');
    await writeFile(jsonPath, JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      summary: { files: files.length, rules: rules.length, count: violations.length },
      keys: violations.map((v) => `${v.ruleId}|${v.filePath}|${v.line}`),
    }, null, 2), 'utf8');
    process.stdout.write(
      `Wrote ${mdPath} + ${jsonPath} (${violations.length} violations in ${files.length} files)\n`,
    );
    process.exit(0); // baseline mode never fails CI
  }

  if (opts.mode === 'diff') {
    const jsonPath = path.join(cwd, 'PHASE_0_GUARDS_BASELINE.json');
    let baselineKeys: Set<string>;
    try {
      const raw = await readFile(jsonPath, 'utf8');
      const j = JSON.parse(raw) as { keys?: string[] };
      baselineKeys = new Set(j.keys ?? []);
    } catch {
      process.stderr.write(
        `lint-guard --diff: no baseline at ${jsonPath}. Run --baseline first.\n`,
      );
      process.exit(2);
    }

    const currentByKey = new Map<string, (typeof violations)[number]>();
    for (const v of violations) {
      currentByKey.set(`${v.ruleId}|${v.filePath}|${v.line}`, v);
    }

    const newViolations = [...currentByKey.entries()]
      .filter(([k]) => !baselineKeys.has(k))
      .map(([, v]) => v);

    const fixedCount = [...baselineKeys].filter((k) => !currentByKey.has(k)).length;

    // Report
    if (newViolations.length === 0) {
      process.stdout.write(
        opts.reporter === 'json'
          ? JSON.stringify({ new: [], fixedCount, baselineCount: baselineKeys.size, currentCount: currentByKey.size }, null, 2) + '\n'
          : `\n✔ No new violations vs baseline.\n` +
            `  baseline: ${baselineKeys.size}  current: ${currentByKey.size}  fixed in this PR: ${fixedCount}\n`,
      );
      process.exit(0);
    }

    if (opts.reporter === 'json') {
      process.stdout.write(
        JSON.stringify({
          new: newViolations,
          fixedCount,
          baselineCount: baselineKeys.size,
          currentCount: currentByKey.size,
        }, null, 2) + '\n',
      );
    } else {
      process.stdout.write(
        `\n✗ ${newViolations.length} NEW violation(s) vs baseline (regression):\n` +
        reportViolations(newViolations) + '\n' +
        `\n  baseline: ${baselineKeys.size}  current: ${currentByKey.size}  fixed in this PR: ${fixedCount}\n` +
        `  Action: either remove the new violation, or — only if intentional and reviewed —\n` +
        `  regenerate the baseline with \`node scripts/lint-guard/dist/index.js --baseline\`.\n`,
      );
    }
    process.exit(1);
  }

  process.stdout.write(
    opts.reporter === 'json' ? reportViolationsJson(violations) : reportViolations(violations),
  );
  process.stdout.write('\n');
  const hasError =
    violations.some((v) => v.severity === 'error') ||
    (opts.failOnWarning === true && violations.length > 0);
  process.exit(hasError ? 1 : 0);
}

function renderBaselineMarkdown(violations: unknown[], fileCount: number, ruleCount: number): string {
  const v = violations as Array<{ ruleId: string; filePath: string; line: number; message: string }>;
  const byRule = new Map<string, typeof v>();
  for (const x of v) {
    const arr = byRule.get(x.ruleId) ?? [];
    arr.push(x);
    byRule.set(x.ruleId, arr);
  }
  const lines: string[] = [];
  lines.push('# PHASE 0 — Guards Baseline');
  lines.push('');
  lines.push(
    '> Snapshot of all violations existing at the moment Lighthouse Network was installed.',
  );
  lines.push(
    '> Reduced to **zero** before exiting Layer -1 (per `PHASE_0_STEP_PLAN.md` exit gate).',
  );
  lines.push('');
  lines.push(`**Scanned:** ${fileCount} files against ${ruleCount} rule(s).`);
  lines.push(`**Total violations:** ${v.length}`);
  lines.push('');
  for (const [ruleId, list] of byRule) {
    lines.push(`## ${ruleId} (${list.length})`);
    lines.push('');
    for (const x of list) {
      lines.push(`- \`${x.filePath}:${x.line}\` — ${x.message.split('. ')[0]}.`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

main().catch((err) => {
  process.stderr.write(`lint-guard: internal error: ${(err as Error).stack ?? String(err)}\n`);
  process.exit(2);
});
