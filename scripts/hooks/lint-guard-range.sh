#!/bin/sh
# ═══════════════════════════════════════════════════════════════
# Lighthouse L2 hook — re-run lint-guard against the full push
# range so a `git commit --no-verify` cannot escape the L1 gate.
#
# Extracted from lefthook.yml because lefthook 2.1.8 on Windows
# git-bash truncates multi-line `run: |` blocks before passing
# to bash (same root cause as block-force-push-main.sh).
# ═══════════════════════════════════════════════════════════════
set -e

REMOTE_REF="${LEFTHOOK_REMOTE_REF:-origin/main}"

if [ ! -f scripts/lint-guard/dist/index.js ]; then
  # If dist/ is not built locally, fall back to a non-blocking warn — CI
  # L3 always re-runs lint-guard as the hard gate, so we trade local
  # strictness for developer-experience parity with lint-guard-staged.
  echo "Lighthouse: scripts/lint-guard/dist/ not built locally — relying on CI L3 backstop."
  echo "  To enable the local hard gate: npx tsc -p scripts/lint-guard/tsconfig.json"
  exit 0
fi

node scripts/lint-guard/dist/index.js --staged-range "${REMOTE_REF}..HEAD"
