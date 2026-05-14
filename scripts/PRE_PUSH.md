# Pre-push verification (R-7)

## How to use

Before `git push`, run:

```bash
npm run verify
```

This runs the same 8 gates that GHA CI runs, locally, in ~60 seconds.
If everything passes, the push will not be red-lit in CI.
If anything fails, the script prints the exact reason — fix locally first.

## What it catches

| Gate | What it catches | CI job it mirrors |
|------|-----------------|-------------------|
| 1. JSON files parse | Corrupted package.json, lockfile, allowlist | Every `npm ci` job |
| 2. YAML files parse | Broken workflow files (truncated, bad indent) | All workflow jobs |
| 3. No NUL bytes | Files truncated by editor artifacts | All build steps |
| 4. package.json ↔ lockfile sync | Forgot to regenerate lockfile after dep edit | Every `npm ci` job |
| 5. Node script syntax | Broken scripts/*.mjs | Migration Drift Guard |
| 6. ESLint --max-warnings 1100 | Unused vars, empty blocks, parse errors | ESLint Check |
| 7. Migration drift guard | New migration on disk not in lock | Migration Drift Guard |
| 8. Vitest full suite | Test regressions | Vitest Test Suite |

## Why we have this

Every CI failure in this repo's history (as of R-6 live runs) falls into
one of those 8 categories. Running them locally adds ~1 minute and
saves a 5-10 minute CI cycle per attempt. It also stops the pattern
of "fix CI" commits cluttering history.

## When to skip

Never. If a gate is too slow for your iteration loop, fix the gate —
don't bypass it. The whole point is that the gate is in band, not out.
