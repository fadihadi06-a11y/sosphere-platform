/**
 * JSON reporter — for machine consumption (CI baseline diffs, dashboards).
 */

import type { SelfTestResult, Violation } from '../types.js';

export function reportViolationsJson(violations: Violation[]): string {
  return JSON.stringify({ violations, summary: { count: violations.length } }, null, 2);
}

export function reportSelfTestsJson(results: SelfTestResult[]): string {
  const failed = results.filter((r) => !r.pass);
  return JSON.stringify(
    {
      results,
      summary: { total: results.length, passed: results.length - failed.length, failed: failed.length },
    },
    null,
    2,
  );
}
