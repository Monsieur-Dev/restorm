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
# Worktree-aware: this script runs identically from the main checkout and
# from any linked `git worktree`. Two paths matter and they are resolved
# differently on purpose:
#   - the per-run scratch log (live hook output) lives in the PER-WORKTREE
#     git dir, so two worktrees committing at once never interleave their
#     live output, and
#   - the flake-history journal lives ONCE at the MAIN repo (the git
#     common dir), so the whole history is answerable from a single file
#     no matter which worktree produced an entry. Concurrent writers
#     serialize on an flock and each entry is written exactly once at the
#     very end, so parallel-agent commits can't interleave or clobber.
#
# Exit codes:
#   0   commit succeeded
#   124 timeout hit (20 min) — investigate the hook output
#   *   git commit's own exit code (hook failure, conflict, etc.)

set -uo pipefail

# Wall-clock start — reported at the end + recorded in every journal entry
# so a reader can see how long each attempt actually took (and how close to
# the cap a "passing" run brushed).
START_TS=$(date +%s)

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TIMEOUT_SEC=1200

# Per-worktree git dir (resolves to `<repo>/.git` in the main checkout and
# to `<main>/.git/worktrees/<name>` in a linked worktree — always a real
# directory, never the `gitdir:` pointer FILE that `<worktree>/.git` is).
# The transient hook-output buffer lives here so concurrent commits from
# different worktrees write to distinct files (no interleaving).
GIT_DIR="$(git rev-parse --absolute-git-dir 2>/dev/null || echo "${REPO_ROOT}/.git")"
LOG_FILE="${GIT_DIR}/commit-timeout.log"

# Flake-history journal, SHARED across all worktrees and newest-on-top.
# It must live in ONE place — the MAIN working-tree root — so every
# worktree (main checkout + every linked worktree) appends to the SAME
# file and "since when / on which agent did this flake?" is answerable
# from one `head .commit-flake-history.log`. Gitignored.
#
# Resolving the main working-tree root robustly is the subtle part: the
# git COMMON dir points at the shared `.git` from every linked worktree,
# but `dirname(common-dir)` only equals the working-tree root for a plain
# repo. When the repo is itself a SUBMODULE, its git dir is relocated to
# `<super>/.git/modules/<name>`, so dirname lands in git plumbing, not the
# checkout. In that case the common config records `core.worktree` (a path
# relative to the git dir) pointing back at the real working tree — use it
# when present, else fall back to dirname.
COMMON_DIR="$(git rev-parse --git-common-dir 2>/dev/null || echo "${REPO_ROOT}/.git")"
COMMON_DIR="$(cd "${COMMON_DIR}" 2>/dev/null && pwd || echo "${REPO_ROOT}/.git")"
CORE_WORKTREE="$(git config -f "${COMMON_DIR}/config" --get core.worktree 2>/dev/null || true)"
case "${CORE_WORKTREE}" in
  '')  MAIN_ROOT="$(dirname "${COMMON_DIR}")" ;;
  /*)  MAIN_ROOT="$(cd "${CORE_WORKTREE}" 2>/dev/null && pwd || echo "${CORE_WORKTREE}")" ;;
  *)   MAIN_ROOT="$(cd "${COMMON_DIR}/${CORE_WORKTREE}" 2>/dev/null && pwd || dirname "${COMMON_DIR}")" ;;
esac
[ -d "${MAIN_ROOT}" ] || MAIN_ROOT="${REPO_ROOT}"
FLAKE_LOG="${MAIN_ROOT}/.commit-flake-history.log"
# The lock lives in the git common dir (never a checked-out working tree),
# so it's shared by all worktrees yet never shows up as a stray untracked
# file in anyone's `git status`.
FLAKE_LOCK="${COMMON_DIR}/commit-flake-history.lock"

# ── Make sure the pre-commit hook will ACTUALLY run ────────────────────
# git silently runs NO hook when `core.hooksPath` points at a directory
# that doesn't exist — which is exactly the state of a freshly-created
# worktree: husky's hook wrappers live in `.husky/_` (gitignored, generated
# by `pnpm install` → the `prepare` script → `husky`), so they're absent
# until the worktree is set up. A commit that silently skips the entire
# suite must NEVER look green, so self-heal here: regenerate the wrappers
# (cheap when deps are present), falling back to a one-time `pnpm install`
# when node_modules is missing. If hooks still can't be activated, the run
# continues but every journal entry is stamped HOOKS SKIPPED (below) so a
# 0s "PASS" is never mistaken for a validated build.
HOOKS_REL="$(git rev-parse --git-path hooks 2>/dev/null || echo .git/hooks)"
case "${HOOKS_REL}" in
  /*) HOOKS_DIR="${HOOKS_REL}" ;;
  *)  HOOKS_DIR="${REPO_ROOT}/${HOOKS_REL}" ;;
esac
# Only self-heal when this repo INTENDS to have hooks — i.e. it points
# `core.hooksPath` somewhere (the husky pattern) or ships a `.husky/`
# directory. A plain repo with neither simply has no pre-commit hook, and
# a missing one there is normal — never trigger an install for it.
HOOKS_EXPECTED=0
if git config --get core.hooksPath >/dev/null 2>&1 || [ -d "${REPO_ROOT}/.husky" ]; then
  HOOKS_EXPECTED=1
fi
HOOKS_ACTIVE=1
if [ "${HOOKS_EXPECTED}" -eq 1 ] && [ ! -x "${HOOKS_DIR}/pre-commit" ]; then
  HOOKS_ACTIVE=0
  echo "git-commit-timeout: no active pre-commit hook in this worktree (${HOOKS_DIR}); activating…" >&2
  if [ -x "${REPO_ROOT}/node_modules/.bin/husky" ]; then
    ( cd "${REPO_ROOT}" && ./node_modules/.bin/husky ) >&2 2>&1 || true
  elif command -v pnpm >/dev/null 2>&1; then
    echo "git-commit-timeout: dependencies missing — running a one-time 'pnpm install' to set up hooks…" >&2
    ( cd "${REPO_ROOT}" && pnpm install ) >&2 2>&1 || true
  fi
  [ -x "${HOOKS_DIR}/pre-commit" ] && HOOKS_ACTIVE=1
fi
if [ "${HOOKS_ACTIVE}" -ne 1 ]; then
  echo "git-commit-timeout: WARNING — could not activate the pre-commit hook; the test suite will NOT run for this commit. The journal entry will be marked HOOKS SKIPPED." >&2
fi

# Mirror everything to the per-worktree scratch log via process substitution
# so the script's own `$?` reflects git commit's exit (a `| tee` pipeline
# would lose that under some bash configurations even with pipefail).
# `timeout --foreground` keeps the controlling terminal so the hook's
# `tput`/colour output renders correctly. SIGTERM first, SIGKILL after
# 30s grace if the process refuses to exit.
#
# Save the real terminal fds first (3/4) so that AFTER the commit we can
# restore them, close the tee's stdin, and `wait` for tee to fully flush
# the scratch log before we read it back — otherwise the async tee could
# still be draining its buffer when we tail it for the journal entry.
exec 3>&1 4>&2
exec > >(tee "${LOG_FILE}") 2>&1
TEE_PID=$!
timeout --foreground --kill-after=30 "${TIMEOUT_SEC}" git commit "$@"
EXIT_CODE=$?
# Restore the terminal (closes the tee's pipe → tee sees EOF) then wait for
# it to finish writing the scratch log. Journal bookkeeping below prints to
# the terminal only, keeping the scratch buffer = pure hook output.
exec 1>&3 2>&4
exec 3>&- 4>&-
# Guard the wait: on the rare bash build where `$!` didn't capture the
# process-substitution PID, an empty TEE_PID would `wait` for *all* jobs.
# Closing the fds above already sent the tee EOF; the wait just ensures the
# scratch log is fully flushed before we tail it for the journal entry.
[ -n "${TEE_PID:-}" ] && wait "${TEE_PID}" 2>/dev/null || true

# Elapsed wall-clock, formatted `<m>m<ss>s` — woven into the journal headers
# below and echoed at the end.
ELAPSED=$(( $(date +%s) - START_TS ))
DURATION="$(printf '%dm%02ds' $((ELAPSED / 60)) $((ELAPSED % 60)))"

# Headers always carry: ISO-8601 timestamp, the committing AGENT identity,
# branch, worktree, HEAD-at-attempt short-sha, exit code. The agent is the
# delegated worktree agent's full ticket name (it exports RESTORM_COMMIT_AGENT
# before committing); a human committing on the main checkout leaves it unset,
# so we fall back to `(local)`. The worktree label disambiguates which
# checkout produced the entry in the shared journal.
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
HEAD_AT_ATTEMPT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
TS="$(date -Is)"
AGENT="${RESTORM_COMMIT_AGENT:-(local)}"
WORKTREE="$(basename "${REPO_ROOT}")"
# When the pre-commit hook never ran (couldn't be activated), tag the entry
# so a fast "PASS" is never read as a validated build.
HOOKS_TAG=""
[ "${HOOKS_ACTIVE}" -eq 1 ] || HOOKS_TAG=" — HOOKS SKIPPED"

# Build the new journal block in memory first, then write the journal ONCE,
# at the very end, under an flock. Newest-on-top: prepend the new block to
# the existing file via a tmp + atomic rename. The flock serializes the
# whole read-modify-write so two worktrees committing at the same instant
# can neither interleave their blocks nor lose one to a last-writer-wins
# clobber. Cost is O(file_size) per commit, but a typical entry is ~200
# lines / ~20 KB on a fail and a single line on a pass, so even a year of
# commits stays well under a megabyte — the cat is fine.
SEP="________________________________________________________________"
if [ "${EXIT_CODE}" -eq 0 ]; then
  # `HEAD` already moved to the brand-new commit by the time we get here,
  # so logging it captures the resulting commit id — useful for later
  # "when did this flake stop?" / "when did this regression land?" forensics.
  NEW_HEAD="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  NEW_BLOCK="$(
    echo "PASS at ${TS} — agent ${AGENT} — branch ${BRANCH} — worktree ${WORKTREE} — commit ${NEW_HEAD} — took ${DURATION}${HOOKS_TAG}"
    echo "${SEP}"
  )"
else
  NEW_BLOCK="$(
    echo "FAIL ${EXIT_CODE} at ${TS} — agent ${AGENT} — branch ${BRANCH} — worktree ${WORKTREE} — HEAD ${HEAD_AT_ATTEMPT} — took ${DURATION}${HOOKS_TAG}"
    echo
    tail -n 200 "${LOG_FILE}" 2>/dev/null || true
    echo
    echo "${SEP}"
  )"
fi

# Single, serialized, atomic journal write. The subshell holds the lock on
# fd 9 for the whole prepend; flock auto-releases when the subshell exits.
# A journal-write failure (e.g. read-only MAIN_ROOT) must never change the
# commit result — it only costs us one history entry — so we warn and move
# on rather than letting it affect ${EXIT_CODE}.
if ! (
  flock 9
  TMP_LOG="$(mktemp "${FLAKE_LOG}.XXXXXX")" || exit 1
  {
    printf '%s\n' "${NEW_BLOCK}"
    cat "${FLAKE_LOG}" 2>/dev/null || true
  } > "${TMP_LOG}" || { rm -f "${TMP_LOG}"; exit 1; }
  mv -f "${TMP_LOG}" "${FLAKE_LOG}"
) 9>"${FLAKE_LOCK}"; then
  echo "git-commit-timeout: warning — could not update flake journal at ${FLAKE_LOG} (commit result unaffected)." >&2
fi

if [ "${EXIT_CODE}" -eq 124 ]; then
  echo
  echo "git-commit-timeout: hit ${TIMEOUT_SEC}s deadline. Hook output saved to ${LOG_FILE}; appended to ${FLAKE_LOG}." >&2
  echo "git-commit-timeout: this is unusual — investigate flakiness or genuine perf regression before retrying." >&2
elif [ "${EXIT_CODE}" -ne 0 ]; then
  echo
  echo "git-commit-timeout: git commit failed with exit code ${EXIT_CODE} (likely pre-commit hook). Hook output saved to ${LOG_FILE}; appended to ${FLAKE_LOG}." >&2
fi

echo "git-commit-timeout: finished in ${DURATION} (exit ${EXIT_CODE})." >&2

exit "${EXIT_CODE}"
