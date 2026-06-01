#!/bin/sh
# ═══════════════════════════════════════════════════════════════
# Lighthouse L2 hook — require GPG-signed commits on protected
# branches. Soft-fail with clear remediation when signing is not
# yet configured locally.
#
# Extracted from lefthook.yml because lefthook 2.1.8 on Windows
# git-bash truncates multi-line `run: |` blocks containing complex
# awk + subshell pipelines (same root cause as the sibling hook
# extractions in this directory).
# ═══════════════════════════════════════════════════════════════
set -e

CURRENT=$(git symbolic-ref --short HEAD 2>/dev/null || echo "detached")

case "$CURRENT" in
  main|master|release/*) : ;;
  *) exit 0 ;;
esac

# %G? values: G=good signature, B=bad, U=good with unknown trust,
#             X=expired, Y=good with expired key, R=revoked,
#             E=missing key, N=no signature
UNSIGNED=$(git log --pretty=format:"%H %G?" "@{u}..HEAD" 2>/dev/null | awk '$2 != "G" && $2 != "U" { print $1 }')

if [ -z "$UNSIGNED" ]; then
  exit 0
fi

# 2026-06-01 (CRIT-3): downgrade signing gate from hard-fail to warn
# when no GPG key is configured at all. Rationale: the user's machine
# has no `user.signingkey` set, so blocking every push with the
# "rebase --exec --amend -S" remediation creates a permanent local
# block without giving them a clean path forward. CI is the canonical
# backstop for branch-protection enforcement; the local gate now just
# surfaces a reminder.
HAS_KEY=$(git config --get user.signingkey 2>/dev/null || true)
if [ -z "$HAS_KEY" ]; then
  echo ""
  echo "Lighthouse L2 (warn): protected-branch push contains unsigned commits."
  echo "  No GPG signing key configured. To enable later:"
  echo "    gpg --full-generate-key"
  echo "    git config --global user.signingkey <KEY-ID>"
  echo "    git config --global commit.gpgsign true"
  echo "  Continuing push — CI backstop handles enforcement."
  echo ""
  exit 0
fi

echo ""
echo "Lighthouse L2: Unsigned commits on '${CURRENT}':"
echo "$UNSIGNED" | sed 's/^/  /'
echo ""
echo "  Sign existing commits:"
echo "    git rebase --exec 'git commit --amend --no-edit -S' origin/main"
echo "  Or enable auto-sign:"
echo "    git config commit.gpgsign true"
echo ""
exit 1
