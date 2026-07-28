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
# in the same 60-minute hard timeout as scripts/git-commit-timeout.sh so a hung
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
#   scripts/ship.sh --auto          # single-invocation mode: push → auto-create
#                                   # PR if missing → watch CI → merge on green.
#                                   # Default (no --auto) stops at the no-PR
#                                   # step so the lead can open the PR manually.
#   scripts/ship.sh --release <patch|minor|major>
#                                   # after a successful merge, cut a release:
#                                   # bump+tag (manual-release.yml) then build
#                                   # (release.yml). Rejected with --no-merge.
#
# --auto safety contract:
#   • PR is created with `gh pr create --base <BASE> --fill` (title+body from
#     branch name + RESTORM_COMMIT_AGENT). Falls through into the normal
#     CI-watch + merge path — no second invocation needed.
#   • Merge is STRICTLY GREEN-ONLY: every required check must conclude
#     "success". On failure / cancelled / timed_out / action_required the script
#     exits non-zero, does NOT merge, and prints the failing check(s) + run URL.
#   • A transient "no checks reported yet" right after PR creation is treated as
#     "keep waiting" (poll loop) — never as "bail early".
#   • All existing safeguards still apply: flock one-at-a-time, NEVER
#     --no-verify, merge-commit only (no ff/squash/rebase), no --delete-branch.
#
# Exit codes:
#   0    shipped (or already merged / merge skipped with --no-merge after green)
#   1    CI not green or merge refused — details printed to stderr
#   2    bad arguments
#   124  the push step hit the 60-min timeout — investigate flakiness
#   *    the failing step's exit code (rebase conflict, e2e fail, CI red, …)

set -uo pipefail

START_TS=$(date +%s)

# ── Args ───────────────────────────────────────────────────────────────
BASE="main"
DO_MERGE=1
AUTO=0
RELEASE_TYPE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="${2:?--base needs a branch}"; shift 2 ;;
    --no-merge) DO_MERGE=0; shift ;;
    --auto) AUTO=1; shift ;;
    --release)
      RELEASE_TYPE="${2:?--release needs patch|minor|major}"
      case "${RELEASE_TYPE}" in patch|minor|major) ;; *) echo "ship.sh: --release must be patch|minor|major (got '${RELEASE_TYPE}')" >&2; exit 2 ;; esac
      shift 2 ;;
    -h|--help) sed -n '2,56p' "$0"; exit 0 ;;
    *) echo "ship.sh: unknown argument: $1" >&2; exit 2 ;;
  esac
done

# --release only makes sense when we actually merge — it cuts the release right
# after. Refuse the contradictory combination up front.
if [ -n "${RELEASE_TYPE}" ] && [ "${DO_MERGE}" -eq 0 ]; then
  echo "ship.sh: --release requires a merge; drop --no-merge." >&2
  exit 2
fi

# ── Repo / worktree resolution (mirrors git-commit-timeout.sh) ─────────
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
GIT_DIR="$(git rev-parse --absolute-git-dir 2>/dev/null || echo "${REPO_ROOT}/.git")"
LOG_FILE="${GIT_DIR}/ship.log"
TIMEOUT_SEC=3600

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

# ── 1b. Rebuild dist so the e2e gate tests the REBASED source ───────────
# The pre-push e2e launches the built dist/, produced only by the pre-commit
# hook — a rebase doesn't rebuild it, so a branch rebased onto a moved main
# would otherwise run the e2e against a STALE bundle. Install first (the
# rebase may have pulled new deps into the lockfile), then build.
echo "🔧 pnpm install --frozen-lockfile (rebase may have pulled new deps)…"
pnpm install --frozen-lockfile || die "pnpm install failed after rebase."
echo "🏗️  pnpm build (rebuild dist from the rebased source)…"
pnpm run build:core-ui || die "build:core-ui failed after rebase."
pnpm run build:restorm || die "build:restorm failed after rebase."

# ── 2. Push → the pre-push hook runs the FULL e2e under xvfb ────────────
# Wrap in the same 60-min hard timeout + journal mechanics as the commit
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

# ── 3. Ensure a PR exists; auto-create it when --auto is set ───────────
# Default (no --auto): stop with a clear ask so the lead can open the PR and
# review it before ship resumes. This preserves the existing "human in the
# loop" checkpoint.
# With --auto: create the PR from branch+RESTORM_COMMIT_AGENT metadata and
# fall through directly into the CI-watch + merge path — no second invocation.
#
# A CLOSED (not merged) PR is treated as absent under --auto: gh would resolve
# it via "number" but it can't be merged. We read both number and state so the
# message is unambiguous and a new OPEN PR is created instead.
PR_NUMBER="$(gh pr view "${BRANCH}" --json number,state --jq .number 2>/dev/null || true)"
PR_STATE_CUR="$(gh pr view "${BRANCH}" --json number,state --jq .state 2>/dev/null || true)"
# Treat a CLOSED PR as absent for the purpose of this check: it can't be
# merged, so under --auto we need to open a fresh one.
if [ "${PR_STATE_CUR}" = "CLOSED" ]; then
  if [ "${AUTO}" -ne 1 ]; then
    die "PR for ${BRANCH} is CLOSED (not merged). Reopen or create a new one, then re-run ship.sh."
  fi
  echo "📋 Existing PR for ${BRANCH} is CLOSED — creating a fresh one (--auto)…"
  PR_NUMBER=""
fi
if [ -z "${PR_NUMBER}" ]; then
  if [ "${AUTO}" -ne 1 ]; then
    die "no PR found for ${BRANCH}. Open it first (gh pr create --base ${BASE}), then re-run ship.sh."
  fi
  echo "📋 No open PR found for ${BRANCH} — creating one (--auto)…"
  # --fill derives title + body from the branch's commits. The RESTORM_COMMIT_AGENT
  # value (set by the lead before calling ship.sh) is already baked into those
  # commit messages, so --fill captures it without extra plumbing.
  if ! gh pr create --base "${BASE}" --fill; then
    die "gh pr create failed — check 'gh auth status' and branch-protection rules."
  fi
  PR_NUMBER="$(gh pr view "${BRANCH}" --json number --jq .number 2>/dev/null || true)"
  [ -n "${PR_NUMBER}" ] || die "PR was created but could not be resolved — inspect 'gh pr view ${BRANCH}'."
  echo "✅ PR #${PR_NUMBER} created."
fi

# ── 4. Wait for CI to go green (strictly success-only) ─────────────────
# gh pr checks --watch blocks until every required check finishes, then exits
# non-zero when any check is not passing. That covers the common cases, but the
# exit code alone doesn't distinguish "still pending" from "failed" right after
# PR creation (checks may not have registered yet). We add an explicit
# conclusion-validation loop:
#   • poll until at least one check has been registered (up to ~5 min)
#   • then hand off to `gh pr checks --watch` for the blocking wait
#   • after --watch exits 0, re-query every check's conclusion and reject any
#     that is not "SUCCESS" — this is the strictly-green-only gate
#
# The poll-until-registered guard prevents the old "bail on zero checks" bug
# that --auto exposed: a fresh PR has no checks for the first ~10–30 s; the
# original code would reach the CI-wait line with no checks and `--watch` exits
# immediately with 0 (nothing to wait for) → the merge gate would silently pass
# with no evidence of CI. The guard below holds the script in a tight loop until
# GitHub registers at least one check (or we timeout, in which case we bail).
echo "⏳ Waiting for CI checks to register on PR #${PR_NUMBER}…"
CHECKS_WAIT_MAX=300   # 5 minutes max for checks to appear
CHECKS_WAIT_INTERVAL=10
CHECKS_WAITED=0
while true; do
  CHECK_COUNT="$(gh pr checks "${BRANCH}" --json name 2>/dev/null | \
    python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d))' 2>/dev/null || echo 0)"
  if [ "${CHECK_COUNT}" -gt 0 ]; then
    echo "  ${CHECK_COUNT} check(s) registered — proceeding to watch."
    break
  fi
  if [ "${CHECKS_WAITED}" -ge "${CHECKS_WAIT_MAX}" ]; then
    die "CI checks never appeared on PR #${PR_NUMBER} after ${CHECKS_WAIT_MAX}s — inspect 'gh pr checks ${BRANCH}', re-push, re-run ship.sh."
  fi
  sleep "${CHECKS_WAIT_INTERVAL}"
  CHECKS_WAITED=$(( CHECKS_WAITED + CHECKS_WAIT_INTERVAL ))
done

echo "⏳ Waiting for all CI checks to finish…"
if ! gh pr checks "${BRANCH}" --watch --interval 30; then
  # --watch exited non-zero: at least one check did not pass. Print detail.
  echo "ship.sh: CI check(s) not green on ${BRANCH} — check details below." >&2
  gh pr checks "${BRANCH}" >&2 || true
  die "CI is not green for ${BRANCH} — not merging. Fix, re-push, re-run ship.sh."
fi

# Strict conclusion validation: `gh pr checks --watch` exits 0 when all checks
# *completed*, but it may exit 0 for checks in "neutral" or other edge-case
# states. Re-query every check's bucket+state and reject any that is not "pass".
# The `bucket` field from `gh pr checks --json` categorises the check's outcome:
#   pass / fail / pending / skipping / cancel
# Only "pass" is acceptable here — any other bucket is non-success.
echo "🔍 Verifying all check conclusions are pass…"
FAILING_CHECKS="$(gh pr checks "${BRANCH}" --json name,bucket,state,link 2>/dev/null | \
  python3 -c '
import json, sys
checks = json.load(sys.stdin)
if not checks:
    print("  FAIL: no checks reported — cannot verify CI is green")
    sys.exit(1)
bad = [c for c in checks if c.get("bucket","") != "pass"]
for c in bad:
    print("  FAIL: {} — state: {} (bucket: {}) — {}".format(
        c.get("name","?"), c.get("state","?"), c.get("bucket","?"), c.get("link","(no URL)")))
sys.exit(0 if not bad else 1)
' 2>/dev/null)" || {
  # Print the failing lines already assembled by the python script before dying
  printf '%s\n' "${FAILING_CHECKS}" >&2
  die "one or more CI checks did not pass — not merging. See URLs above."
}
echo "✅ CI green (all checks passed)."

# ── 5. Merge (real merge commit) + delete the branch ───────────────────
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

# ── Optional release (--release) ───────────────────────────────────────
# Only reached after a real merge (the --no-merge guard above rejects the
# combination). Bumps + tags via manual-release.yml, then kicks the platform
# build (release.yml) — its tag, pushed with GITHUB_TOKEN, doesn't self-trigger
# the `on: push: tags` build, so we launch it explicitly. Never fails the ship:
# the merge already landed; a release hiccup just prints the manual commands.
if [ -n "${RELEASE_TYPE}" ]; then
  echo "🚀 Launching ${RELEASE_TYPE} release…"
  git fetch origin --tags --quiet 2>/dev/null || true
  CUR="$(git show "origin/${BASE}:restorm/package.json" 2>/dev/null | grep -m1 '"version"' | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
  if [ -z "${CUR}" ]; then
    echo "⚠️  Couldn't read the version from origin/${BASE}; run it manually: gh workflow run manual-release.yml -f version_type=${RELEASE_TYPE}" >&2
  else
    IFS='.' read -r MAJ MIN PAT <<< "${CUR%%-*}"
    case "${RELEASE_TYPE}" in
      major) MAJ=$((MAJ + 1)); MIN=0; PAT=0 ;;
      minor) MIN=$((MIN + 1)); PAT=0 ;;
      patch) PAT=$((PAT + 1)) ;;
    esac
    NEW_TAG="v${MAJ}.${MIN}.${PAT}"
    echo "   ${CUR} → ${NEW_TAG#v}"
    if ! gh workflow run manual-release.yml -f version_type="${RELEASE_TYPE}"; then
      echo "⚠️  Failed to trigger manual-release.yml; run it manually." >&2
    else
      echo "⏳ Waiting for ${NEW_TAG} to be tagged…"
      TAGGED=0
      for _ in $(seq 1 40); do
        git fetch origin --tags --quiet 2>/dev/null || true
        if git rev-parse -q --verify "refs/tags/${NEW_TAG}" >/dev/null 2>&1; then TAGGED=1; break; fi
        sleep 15
      done
      if [ "${TAGGED}" -eq 1 ] && gh workflow run release.yml --ref "${NEW_TAG}"; then
        echo "🚀 Release build launched for ${NEW_TAG}. Watch: gh run watch \$(gh run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId')"
      else
        echo "⚠️  ${NEW_TAG} not built automatically; run: gh workflow run release.yml --ref ${NEW_TAG}" >&2
      fi
    fi
  fi
fi
exit 0
