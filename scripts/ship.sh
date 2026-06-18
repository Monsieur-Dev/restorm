#!/usr/bin/env bash
# Ship a feature branch: rebase → push (e2e gate) → wait CI → merge.
#
# This is the orchestrator for the new "commit fast / ship gates e2e" flow.
# The full Playwright e2e suite no longer runs at commit time (the pre-commit
# hook keeps only the fast checks: forbidden-patterns, lint, typecheck,
# depcheck, build, unit tests). The heavy e2e gate moved to PUSH time: the
# `.husky/pre-push` hook runs `pnpm --filter restorm test:e2e` (xvfb-wrapped)
# and aborts the push on failure. So commits are fast and parallelizable, and
# the e2e is still impossible to forget.
#
# `ship.sh` drives the whole "land this branch" sequence, in order:
#   1. fetch + rebase the current branch onto origin/<base> (never ship behind)
#   2. push  → the pre-push hook runs the FULL e2e under xvfb; a failure aborts
#              here, nothing is merged
#   3. wait for the PR's CI checks to go green (the CI runs lint/type/unit/
#      integration/build — NOT the e2e, which is the local push gate)
#   4. merge the PR with a real merge commit (`gh pr merge --merge`) + delete
#      the branch
#
# It runs only AFTER the human's "go" (their VS Code manual-test + PR review IS
# the approval), so the auto-merge-after-green at the end is intentional.
#
# Gating: only ONE ship runs at a time on this RAM-bound host (an flock on the
# shared git common dir serializes concurrent ships). The push step is wrapped
# in the same 20-minute hard timeout as scripts/git-commit-timeout.sh so a hung
# Monaco/e2e flake can't pin an agent for an hour, and every attempt is recorded
# in the shared `.commit-flake-history.log` journal (stamped SHIP) so a flaky
# ship is attributable and answerable from one file.
#
# Re-runnable: each step is idempotent. If a previous ship pushed but CI was
# red, fix + re-run — the rebase no-ops when up to date, the push fast-forwards
# (or is skipped when already pushed), and the wait/merge resume from where they
# stopped. A merge that already happened makes gh report the PR merged and ship
# exits 0.
#
# Usage:
#   scripts/ship.sh                 # base = main (default)
#   scripts/ship.sh --base <branch> # ship onto a different base (e.g. an epic)
#   scripts/ship.sh --no-merge      # rebase → push (e2e) → wait CI, but STOP
#                                   # before merge (hand back to a human)
#
# Exit codes:
#   0    shipped (or already merged / merge skipped with --no-merge after green)
#   124  the push step hit the 20-min timeout — investigate flakiness
#   *    the failing step's exit code (rebase conflict, e2e fail, CI red, …)

set -uo pipefail

START_TS=$(date +%s)

# ── Args ───────────────────────────────────────────────────────────────
BASE="main"
DO_MERGE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="${2:?--base needs a branch}"; shift 2 ;;
    --no-merge) DO_MERGE=0; shift ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "ship.sh: unknown argument: $1" >&2; exit 2 ;;
  esac
done

# ── Repo / worktree resolution (mirrors git-commit-timeout.sh) ─────────
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
GIT_DIR="$(git rev-parse --absolute-git-dir 2>/dev/null || echo "${REPO_ROOT}/.git")"
LOG_FILE="${GIT_DIR}/ship.log"
TIMEOUT_SEC=1200

# The flake-history journal + its lock live ONCE at the main working-tree root
# (shared across every worktree), exactly like git-commit-timeout.sh — so ships
# and commits land in the same answerable history. Resolve the main root
# robustly (submodule git dirs are relocated; core.worktree points back).
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
FLAKE_LOCK="${COMMON_DIR}/commit-flake-history.lock"
# 1-ship-at-a-time lock (separate from the journal lock so journal writes never
# block on a long-running ship). Lives in the git common dir → shared by all
# worktrees, never a stray untracked file.
SHIP_LOCK="${COMMON_DIR}/ship.lock"

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
AGENT="${RESTORM_COMMIT_AGENT:-(local)}"
WORKTREE="$(basename "${REPO_ROOT}")"

die() { echo "ship.sh: $*" >&2; exit 1; }
[ "${BRANCH}" != "unknown" ] || die "could not resolve current branch."
[ "${BRANCH}" != "${BASE}" ] || die "refusing to ship the base branch (${BASE}) onto itself."
command -v gh >/dev/null 2>&1 || die "the GitHub CLI 'gh' is required (rebase/push/CI-wait/merge)."

# ── Journal helper (shared format with git-commit-timeout.sh) ──────────
SEP="________________________________________________________________"
journal() {
  # journal <STATUS-LINE> [optional log tail file]
  local status_line="$1"; local tail_file="${2:-}"
  local block
  if [ -n "${tail_file}" ] && [ -f "${tail_file}" ]; then
    block="$(printf '%s\n\n%s\n\n%s\n' "${status_line}" "$(tail -n 200 "${tail_file}" 2>/dev/null)" "${SEP}")"
  else
    block="$(printf '%s\n%s\n' "${status_line}" "${SEP}")"
  fi
  (
    flock 9
    local tmp; tmp="$(mktemp "${FLAKE_LOG}.XXXXXX")" || exit 1
    { printf '%s\n' "${block}"; cat "${FLAKE_LOG}" 2>/dev/null || true; } > "${tmp}" || { rm -f "${tmp}"; exit 1; }
    mv -f "${tmp}" "${FLAKE_LOG}"
  ) 9>"${FLAKE_LOCK}" || echo "ship.sh: warning — could not update flake journal at ${FLAKE_LOG}." >&2
}
elapsed() { local s=$(( $(date +%s) - START_TS )); printf '%dm%02ds' $((s / 60)) $((s % 60)); }

# Single FAIL journal entry on any early exit (rebase conflict, CI red, merge
# refusal, …). The push step writes its own richer entry (with the hook tail)
# and clears this trap first so we never double-log it. Capture $? as the very
# first thing in the trap — any command inside (including the `[ ]` test) would
# otherwise overwrite it before record_fail reads it.
record_fail() {
  local code="$1"
  journal "FAIL ${code} at $(date -Is) — SHIP — agent ${AGENT} — branch ${BRANCH} → ${BASE} — worktree ${WORKTREE} — took $(elapsed)"
}
trap 'rc=$?; [ "${rc}" -eq 0 ] || record_fail "${rc}"' EXIT

# ── Serialize: only one ship at a time ─────────────────────────────────
exec 8>"${SHIP_LOCK}"
if ! flock -n 8; then
  echo "ship.sh: another ship is already running (host is RAM-bound; 1 ship at a time). Waiting for it to finish…" >&2
  flock 8
fi

echo "🚢 Shipping ${BRANCH} → ${BASE} (agent: ${AGENT})"

# Re-runnable: if a previous ship already merged this branch's PR, stop early
# with success instead of trying to rebase/push a landed branch.
PR_STATE="$(gh pr view "${BRANCH}" --json state --jq .state 2>/dev/null || true)"
if [ "${PR_STATE}" = "MERGED" ]; then
  trap - EXIT
  echo "🎉 PR for ${BRANCH} is already MERGED — nothing to do. Tear down the worktree."
  exit 0
fi

# ── 1. Rebase onto origin/<base> (never ship a branch that's behind) ───
echo "📥 git fetch origin…"
git fetch origin || die "git fetch failed."
BEHIND="$(git rev-list --count "HEAD..origin/${BASE}" 2>/dev/null || echo 0)"
if [ "${BEHIND}" -ne 0 ]; then
  echo "🔀 ${BRANCH} is ${BEHIND} commit(s) behind origin/${BASE} — rebasing…"
  if ! git rebase "origin/${BASE}"; then
    git rebase --abort 2>/dev/null || true
    die "rebase onto origin/${BASE} hit conflicts — resolve them manually, then re-run ship.sh."
  fi
else
  echo "✅ ${BRANCH} already up to date with origin/${BASE}."
fi

# ── 2. Push → the pre-push hook runs the FULL e2e under xvfb ────────────
# Wrap in the same 20-min hard timeout + journal mechanics as the commit
# wrapper. `--force-with-lease` is safe + required after a rebase. The hook's
# e2e output is captured to LOG_FILE for the journal tail.
#
# Skip the push entirely when there's nothing to push (local HEAD already
# equals the remote branch tip) — this is what makes a re-run cheap: a
# previous ship that pushed (paid the e2e) but stopped at a red CI re-runs
# straight to the CI-wait below, without re-paying the ~15-min e2e. A push
# only fires (and the hook re-runs e2e) when the commits actually changed.
LOCAL_SHA="$(git rev-parse HEAD 2>/dev/null || echo local)"
REMOTE_SHA="$(git rev-parse "origin/${BRANCH}" 2>/dev/null || echo none)"
PUSH_CODE=0
if [ "${LOCAL_SHA}" = "${REMOTE_SHA}" ]; then
  echo "✅ origin/${BRANCH} already matches local HEAD — nothing to push (e2e already paid); skipping to CI."
else
  echo "⬆️  git push (pre-push hook runs the full e2e under xvfb — this is the slow part)…"
  exec 3>&1 4>&2
  exec > >(tee "${LOG_FILE}") 2>&1
  TEE_PID=$!
  timeout --foreground --kill-after=30 "${TIMEOUT_SEC}" \
    git push --force-with-lease --set-upstream origin "${BRANCH}"
  PUSH_CODE=$?
  exec 1>&3 2>&4
  exec 3>&- 4>&-
  [ -n "${TEE_PID:-}" ] && wait "${TEE_PID}" 2>/dev/null || true
fi

if [ "${PUSH_CODE}" -ne 0 ]; then
  # The push (hence the e2e gate) failed or timed out. Log the rich entry
  # with the hook tail, then bail — nothing was merged.
  trap - EXIT
  journal "FAIL ${PUSH_CODE} at $(date -Is) — SHIP/push at e2e gate — agent ${AGENT} — branch ${BRANCH} → ${BASE} — worktree ${WORKTREE} — took $(elapsed)" "${LOG_FILE}"
  if [ "${PUSH_CODE}" -eq 124 ]; then
    echo "ship.sh: push hit the ${TIMEOUT_SEC}s deadline (likely an e2e/Monaco hang). Output: ${LOG_FILE}; journal: ${FLAKE_LOG}." >&2
  else
    echo "ship.sh: push failed (exit ${PUSH_CODE}) — the pre-push e2e gate or the push itself. Output: ${LOG_FILE}; journal: ${FLAKE_LOG}." >&2
  fi
  exit "${PUSH_CODE}"
fi
echo "✅ Pushed (e2e gate passed)."

# ── 3. Wait for CI to go green on the PR ───────────────────────────────
# `gh pr checks --watch` blocks until every required check finishes, then
# exits non-zero if any failed. It needs a PR to exist; the agent opens the
# PR (AGENT_WORKFLOW) before ship. If none exists yet, stop with a clear ask
# rather than merging an unreviewed branch.
if ! gh pr view "${BRANCH}" --json number >/dev/null 2>&1; then
  die "no PR found for ${BRANCH}. Open it first (gh pr create --base ${BASE}), then re-run ship.sh."
fi
echo "⏳ Waiting for CI to go green…"
if ! gh pr checks "${BRANCH}" --watch --interval 30; then
  die "CI is not green for ${BRANCH} — not merging. Inspect 'gh pr checks ${BRANCH}', fix, re-push, re-run ship.sh."
fi
echo "✅ CI green."

# ── 4. Merge (real merge commit) + delete the branch ───────────────────
if [ "${DO_MERGE}" -ne 1 ]; then
  trap - EXIT
  journal "PASS at $(date -Is) — SHIP/no-merge (e2e+CI green, merge skipped) — agent ${AGENT} — branch ${BRANCH} → ${BASE} — worktree ${WORKTREE} — took $(elapsed)"
  echo "🟢 ${BRANCH} is e2e-gated, pushed, and CI-green. --no-merge set → stopping before merge. Merge with: gh pr merge ${BRANCH} --merge --delete-branch"
  exit 0
fi

echo "🔀 Merging PR (merge commit)…"
# NOTE: no --delete-branch. gh's local cleanup tries to switch the checkout to the
# base branch, which is held by another worktree (we ship from linked worktrees),
# failing with "'main' is already used by worktree". The repo is configured to
# auto-delete the remote branch on merge, and the lead's teardown removes the local
# branch + worktree — so --delete-branch is both unnecessary and harmful here.
if ! gh pr merge "${BRANCH}" --merge; then
  die "gh pr merge failed — the PR may need a human merge (branch protection / conflict). CI was green; check 'gh pr view ${BRANCH}'."
fi

trap - EXIT
journal "PASS at $(date -Is) — SHIP merged — agent ${AGENT} — branch ${BRANCH} → ${BASE} — worktree ${WORKTREE} — took $(elapsed)"
echo "🎉 Shipped: ${BRANCH} merged into ${BASE} (took $(elapsed)). Remote branch auto-deleted; tear down the worktree."
exit 0
