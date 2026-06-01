#!/bin/sh
# ═══════════════════════════════════════════════════════════════
# Lighthouse L2 hook — block force-push to protected branches.
#
# Extracted from lefthook.yml `pre-push.block-force-push-main`
# because lefthook 2.1.8 on Windows git-bash silently truncates
# multi-line `run: |` YAML blocks before passing them to bash,
# producing "syntax error: unexpected end of file" failures with
# no useful diagnostic. The same root cause hit lint-guard-staged
# in PR(D) 2026-05-26 — the fix there was single-line single-quoted
# YAML; here it is even cleaner to keep the script in its own file
# so the bash logic stays readable and reviewable.
#
# CRIT-3 (2026-06-01): added during the invitation-flow push.
# ═══════════════════════════════════════════════════════════════
set -e

CURRENT=$(git symbolic-ref --short HEAD 2>/dev/null || echo "detached")

case "$CURRENT" in
  main|master|release/*) : ;;
  *) exit 0 ;;
esac

# Detect force-push by checking if any commit in the local branch is missing
# from the remote. `git rev-list --left-right --count @{u}...` returns
# "<behind> <ahead>" — we abort if behind > 0 because that means a non-fast-
# forward push would rewrite remote history.
COUNTS=$(git rev-list --left-right --count "@{u}..." 2>/dev/null || echo "0 0")
BEHIND=$(echo "$COUNTS" | awk '{print $1}')

if [ "${BEHIND:-0}" -gt 0 ]; then
  echo ""
  echo "Lighthouse L2: Force-push to '${CURRENT}' blocked."
  echo "  Local branch is behind '@{u}' by ${BEHIND} commit(s)."
  echo "  Doctrine PHASE_0 sect.2 L2: protected branches accept fast-forward only."
  echo ""
  echo "  To proceed safely: git pull --rebase, resolve, then push."
  echo ""
  exit 1
fi

exit 0
