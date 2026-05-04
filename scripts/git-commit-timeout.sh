#!/usr/bin/env bash
# Wrap `git commit` with a hard 15-minute timeout.
#
# The repo's pre-commit hook runs the full e2e suite (roughly 5–6
# minutes on a healthy host). On a slow / loaded machine, a single
# Monaco timing flake can extend the run well past 15 minutes — at
# which point we'd rather kill the commit and let the human investigate
# than let an automated agent block for an hour.
#
# Usage: scripts/git-commit-timeout.sh <git commit args>
#   e.g. scripts/git-commit-timeout.sh -m "feat: ..."
#
# Exit codes:
#   0   commit succeeded
#   124 timeout hit (15 min) — investigate the hook output
#   *   git commit's own exit code (hook failure, conflict, etc.)

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TIMEOUT_SEC=900
LOG_FILE="${REPO_ROOT}/.git/commit-timeout.log"

# Mirror everything to the log file via process substitution so the
# script's own `$?` reflects git commit's exit (a `| tee` pipeline
# would lose that under some bash configurations even with pipefail).
# `timeout --foreground` keeps the controlling terminal so the hook's
# `tput`/colour output renders correctly. SIGTERM first, SIGKILL after
# 30s grace if the process refuses to exit.
exec > >(tee "${LOG_FILE}") 2>&1
timeout --foreground --kill-after=30 "${TIMEOUT_SEC}" git commit "$@"
EXIT_CODE=$?

if [ "${EXIT_CODE}" -eq 124 ]; then
  echo
  echo "git-commit-timeout: hit ${TIMEOUT_SEC}s deadline. Hook output saved to ${LOG_FILE}." >&2
  echo "git-commit-timeout: this is unusual — investigate flakiness or genuine perf regression before retrying." >&2
elif [ "${EXIT_CODE}" -ne 0 ]; then
  echo
  echo "git-commit-timeout: git commit failed with exit code ${EXIT_CODE} (likely pre-commit hook). Hook output saved to ${LOG_FILE}." >&2
fi

exit "${EXIT_CODE}"
