#!/usr/bin/env bash
# Wrap `git commit` with a hard 20-minute timeout.
#
# The repo's pre-commit hook runs the full e2e suite. On a healthy host
# the unit + e2e pass in well under the cap; on a loaded machine (a
# concurrent VM / Docker / video on a 16-thread box with modest RAM) the
# 33-test e2e suite alone can take 12–14 minutes and the whole run
# brushes the cap. Past it we'd rather kill the commit and let the human
# investigate than let an automated agent block for an hour. A single
# Monaco timing flake hanging the run is the other case this guards.
#
# Usage: scripts/git-commit-timeout.sh <git commit args>
#   e.g. scripts/git-commit-timeout.sh -m "feat: ..."
#
# Exit codes:
#   0   commit succeeded
#   124 timeout hit (20 min) — investigate the hook output
#   *   git commit's own exit code (hook failure, conflict, etc.)

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TIMEOUT_SEC=1200
LOG_FILE="${REPO_ROOT}/.git/commit-timeout.log"
# Commit-attempt journal, newest-on-top — every invocation prepends one
# entry (success = single PASS line, failure = header + tail of hook
# output). Newest-on-top so `head` answers "when did this flake last
# hit me?" without scrolling through a year of history. Lives at the
# repo root, gitignored.
FLAKE_LOG="${REPO_ROOT}/.commit-flake-history.log"

# Mirror everything to the log file via process substitution so the
# script's own `$?` reflects git commit's exit (a `| tee` pipeline
# would lose that under some bash configurations even with pipefail).
# `timeout --foreground` keeps the controlling terminal so the hook's
# `tput`/colour output renders correctly. SIGTERM first, SIGKILL after
# 30s grace if the process refuses to exit.
exec > >(tee "${LOG_FILE}") 2>&1
timeout --foreground --kill-after=30 "${TIMEOUT_SEC}" git commit "$@"
EXIT_CODE=$?

# Append one line per invocation to the journal so a reader can compute
# a flake rate over any date range (success vs fail counts). Headers
# always carry: ISO-8601 timestamp, branch, HEAD-at-attempt short-sha,
# exit code. On failure we also dump the last 200 lines of the hook log
# below the header so the failing test + its trace land in the journal
# (no need to chase test-results/ later).
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
HEAD_AT_ATTEMPT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
TS="$(date -Is)"

# Prepend instead of append so the newest entry is always on top — a
# reader can `head` the file to see "when did this flake last hit me"
# without scrolling to the bottom of a year-old journal. Implementation:
# write the new block + the existing file to a tmp, then atomic-rename.
# Cost is O(file_size) per commit, but a typical entry is ~200 lines /
# ~20 KB on a fail and a single line on a pass, so even a year of
# commits stays well under a megabyte — the cat is fine.
TMP_LOG="$(mktemp "${FLAKE_LOG}.XXXXXX")"
# Underscore divider between entries — readable separator the user can
# scroll/grep past, while still letting `head` show the freshest entry
# in full. Lives at the bottom of the new entry so the very first line
# is always the header (timestamp + outcome).
SEP="________________________________________________________________"
if [ "${EXIT_CODE}" -eq 0 ]; then
  # `HEAD` already moved to the brand-new commit by the time we get
  # here, so logging it captures the resulting commit id — useful for
  # later "when did this flake stop?" / "when did this regression
  # land?" forensics.
  NEW_HEAD="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  {
    echo "PASS at ${TS} — branch ${BRANCH} — commit ${NEW_HEAD}"
    echo "${SEP}"
    cat "${FLAKE_LOG}" 2>/dev/null || true
  } > "${TMP_LOG}"
else
  {
    echo "FAIL ${EXIT_CODE} at ${TS} — branch ${BRANCH} — HEAD ${HEAD_AT_ATTEMPT}"
    echo
    tail -n 200 "${LOG_FILE}" 2>/dev/null || true
    echo
    echo "${SEP}"
    cat "${FLAKE_LOG}" 2>/dev/null || true
  } > "${TMP_LOG}"
fi
mv -f "${TMP_LOG}" "${FLAKE_LOG}"

if [ "${EXIT_CODE}" -eq 124 ]; then
  echo
  echo "git-commit-timeout: hit ${TIMEOUT_SEC}s deadline. Hook output saved to ${LOG_FILE}; appended to ${FLAKE_LOG}." >&2
  echo "git-commit-timeout: this is unusual — investigate flakiness or genuine perf regression before retrying." >&2
elif [ "${EXIT_CODE}" -ne 0 ]; then
  echo
  echo "git-commit-timeout: git commit failed with exit code ${EXIT_CODE} (likely pre-commit hook). Hook output saved to ${LOG_FILE}; appended to ${FLAKE_LOG}." >&2
fi

exit "${EXIT_CODE}"
