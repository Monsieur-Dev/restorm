#!/usr/bin/env bash
# Regression test for scripts/git-commit-timeout.sh.
#
# There is no JS test harness for the repo's root bash tooling, so this is
# a self-contained bash test: it builds throwaway git repos under a temp
# dir, drives the real wrapper with `--allow-empty` (so it never runs the
# heavy pre-commit hook), and asserts the worktree-aware behaviour. Run it
# directly:
#
#   bash scripts/git-commit-timeout.test.sh
#
# Exit 0 = all checks passed; exit 1 = at least one failed (details above).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER="${SCRIPT_DIR}/git-commit-timeout.sh"
FAILS=0

pass() { printf '  ok   — %s\n' "$1"; }
fail() { printf '  FAIL — %s\n' "$1"; FAILS=$((FAILS + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1 (assertion: $2)"; fi; }

mkrepo() {
  # $1 = repo dir; creates a repo with one commit + a quiet git identity.
  git init -q "$1"
  git -C "$1" config user.email t@example.com
  git -C "$1" config user.name 'Test'
  git -C "$1" commit -q --allow-empty -m init
}

# ───────────────────────────────────────────────────────────────────────
echo '# plain repo + linked worktree: commit, shared journal, agent stamp'
T="$(mktemp -d "${TMPDIR:-/tmp}/gct-plain.XXXXXX")"
mkrepo "${T}/main"
git -C "${T}/main" worktree add -q "${T}/wt" -b feat >/dev/null 2>&1

( cd "${T}/main" && "${WRAPPER}" --allow-empty -m from-main ) >/dev/null 2>&1
MAIN_RC=$?
( cd "${T}/wt" && RESTORM_COMMIT_AGENT='Sample agent ticket name' "${WRAPPER}" --allow-empty -m from-wt ) >/dev/null 2>&1
WT_RC=$?

check 'commit from main checkout exits 0'            "[ ${MAIN_RC} -eq 0 ]"
check 'commit from linked worktree exits 0'          "[ ${WT_RC} -eq 0 ]"
check 'main commit landed'                           "git -C '${T}/main' log --oneline | grep -q from-main"
check 'worktree commit landed'                       "git -C '${T}/wt'   log --oneline | grep -q from-wt"
JOURNAL="${T}/main/.commit-flake-history.log"
check 'shared journal exists at MAIN root'           "[ -f '${JOURNAL}' ]"
check 'journal does NOT exist in the worktree'       "[ ! -f '${T}/wt/.commit-flake-history.log' ]"
check 'journal holds the main PASS entry'            "grep -q 'agent (local) .* worktree main' '${JOURNAL}'"
check 'journal holds the worktree PASS entry+agent'  "grep -q 'agent Sample agent ticket name .* worktree wt' '${JOURNAL}'"
# Newest-on-top: the worktree commit ran second, so its line precedes main's.
check 'newest entry (worktree) is on top'            "head -1 '${JOURNAL}' | grep -q 'worktree wt'"
check 'per-worktree scratch log lives in its gitdir' "[ -f \"\$(git -C '${T}/wt' rev-parse --absolute-git-dir)/commit-timeout.log\" ]"
check 'lock lives in the git common dir, not WT'     "[ -f '${T}/main/.git/commit-flake-history.lock' ] && [ ! -f '${T}/main/.commit-flake-history.log.lock' ]"
rm -rf "${T}"

# ───────────────────────────────────────────────────────────────────────
echo '# failing commit: exit code propagates + FAIL block captured'
T="$(mktemp -d "${TMPDIR:-/tmp}/gct-fail.XXXXXX")"
mkrepo "${T}/main"
# A pre-commit hook that prints a marker then fails. Git normalises ANY
# hook abort to exit 1 (it does not relay the hook's own exit value), so
# the contract the wrapper must honour is "propagate git's non-zero code".
mkdir -p "${T}/main/.git/hooks"
cat > "${T}/main/.git/hooks/pre-commit" <<'HOOK'
#!/bin/sh
echo "SENTINEL_HOOK_OUTPUT_12345"
exit 7
HOOK
chmod +x "${T}/main/.git/hooks/pre-commit"
( cd "${T}/main" && "${WRAPPER}" --allow-empty -m should-fail ) >/dev/null 2>&1
RC=$?
JOURNAL="${T}/main/.commit-flake-history.log"
check 'wrapper propagates git'\''s non-zero exit code' "[ ${RC} -ne 0 ]"
check 'journal records a FAIL entry for that code'     "grep -q '^FAIL ${RC} ' '${JOURNAL}'"
check 'FAIL block embeds the hook output tail'         "grep -q 'SENTINEL_HOOK_OUTPUT_12345' '${JOURNAL}'"
rm -rf "${T}"

# ───────────────────────────────────────────────────────────────────────
echo '# concurrent commits from two worktrees serialize (flock, no clobber)'
T="$(mktemp -d "${TMPDIR:-/tmp}/gct-conc.XXXXXX")"
mkrepo "${T}/main"
git -C "${T}/main" worktree add -q "${T}/a" -b feat-a >/dev/null 2>&1
git -C "${T}/main" worktree add -q "${T}/b" -b feat-b >/dev/null 2>&1
( cd "${T}/a" && RESTORM_COMMIT_AGENT='AGENT-A' "${WRAPPER}" --allow-empty -m from-a ) >/dev/null 2>&1 &
PA=$!
( cd "${T}/b" && RESTORM_COMMIT_AGENT='AGENT-B' "${WRAPPER}" --allow-empty -m from-b ) >/dev/null 2>&1 &
PB=$!
wait "${PA}"; wait "${PB}"
JOURNAL="${T}/main/.commit-flake-history.log"
check 'both concurrent entries survived (no clobber)' "[ \"\$(grep -c '^PASS' '${JOURNAL}')\" -eq 2 ]"
check 'agent A entry present'                          "grep -q 'agent AGENT-A' '${JOURNAL}'"
check 'agent B entry present'                          "grep -q 'agent AGENT-B' '${JOURNAL}'"
# Entries must not interleave: every PASS header is immediately followed by
# the separator line, with nothing spliced between two headers.
check 'entries are well-formed (PASS then separator)' "[ \"\$(grep -c '^_' '${JOURNAL}')\" -eq 2 ]"
# Plain repos (no core.hooksPath, no .husky) must NOT be stamped HOOKS
# SKIPPED — there's no hook to skip, so the prior PASS entries are clean.
check 'plain-repo entries are not stamped HOOKS SKIPPED' "! grep -q 'HOOKS SKIPPED' '${JOURNAL}'"
rm -rf "${T}"

# ───────────────────────────────────────────────────────────────────────
echo '# hooks expected but unactivatable: entry stamped HOOKS SKIPPED, commit still lands'
T="$(mktemp -d "${TMPDIR:-/tmp}/gct-skip.XXXXXX")"
mkrepo "${T}/main"
# Declare hook intent (husky pattern) but provide no usable wrappers, and a
# husky stub that is a no-op so activation is *attempted* yet fails — which
# also keeps the wrapper off the pnpm path entirely.
git -C "${T}/main" config core.hooksPath .husky/_
mkdir -p "${T}/main/node_modules/.bin"
printf '#!/bin/sh\nexit 0\n' > "${T}/main/node_modules/.bin/husky"
chmod +x "${T}/main/node_modules/.bin/husky"
( cd "${T}/main" && "${WRAPPER}" --allow-empty -m hookless ) >/dev/null 2>&1
RC=$?
JOURNAL="${T}/main/.commit-flake-history.log"
check 'commit still lands when hooks cannot activate' "[ ${RC} -eq 0 ] && git -C '${T}/main' log --oneline | grep -q hookless"
check 'entry is stamped HOOKS SKIPPED'                "grep -q 'HOOKS SKIPPED' '${JOURNAL}'"
rm -rf "${T}"

# ───────────────────────────────────────────────────────────────────────
echo '# hooks expected + activatable: wrapper self-heals, hook runs, no skip tag'
T="$(mktemp -d "${TMPDIR:-/tmp}/gct-heal.XXXXXX")"
mkrepo "${T}/main"
git -C "${T}/main" config core.hooksPath .husky/_
mkdir -p "${T}/main/node_modules/.bin"
# A husky stub that materialises an active pre-commit hook (as real husky
# does), which touches a sentinel so we can prove the hook actually ran.
cat > "${T}/main/node_modules/.bin/husky" <<HUSKY
#!/bin/sh
mkdir -p "${T}/main/.husky/_"
printf '#!/bin/sh\ntouch "${T}/main/HOOK_RAN"\n' > "${T}/main/.husky/_/pre-commit"
chmod +x "${T}/main/.husky/_/pre-commit"
HUSKY
chmod +x "${T}/main/node_modules/.bin/husky"
( cd "${T}/main" && "${WRAPPER}" --allow-empty -m healed ) >/dev/null 2>&1
RC=$?
JOURNAL="${T}/main/.commit-flake-history.log"
check 'commit lands after self-heal'                  "[ ${RC} -eq 0 ] && git -C '${T}/main' log --oneline | grep -q healed"
check 'the activated pre-commit hook actually ran'    "[ -f '${T}/main/HOOK_RAN' ]"
check 'healed entry is NOT stamped HOOKS SKIPPED'     "! grep -q 'HOOKS SKIPPED' '${JOURNAL}'"
rm -rf "${T}"

# ───────────────────────────────────────────────────────────────────────
echo
if [ "${FAILS}" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
  exit 0
else
  echo "${FAILS} CHECK(S) FAILED"
  exit 1
fi
