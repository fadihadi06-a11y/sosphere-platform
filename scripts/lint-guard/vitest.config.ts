/**
 * Dedicated Vitest config for the lint-guard test suite.
 *
 * Kept separate from the repo-root `vitest.config.ts` so that:
 *   - lint-guard tests live under `scripts/`, not `src/`.
 *   - they can run independently in CI (`vitest --config scripts/lint-guard/vitest.config.ts`)
 *     even when the rest of the repo's tests are temporarily broken.
 *
 * Doctrine ref: PHASE_0_TESTING_PHILOSOPHY.md §5 (self-testing — the linter that
 * guards the rest of the repo must itself be testable in isolation).
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/lint-guard/__behavior_tests__/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    isolate: true,
    // Property-based tests with 200 runs can be slower than example tests; keep timeout generous.
    testTimeout: 30_000,
  },
});
