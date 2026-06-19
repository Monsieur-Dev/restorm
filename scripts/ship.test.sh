#!/usr/bin/env bash
# Regression tests for the CI-gate merge validator embedded in ship.sh.
#
# The validator is the python3 snippet that inspects `gh pr checks --json`
# output and exits non-zero when any check is not "pass" (or when the list is
# empty). This harness pipes fixture JSON directly into that snippet so the
# merge-gate invariant can be verified without a live GitHub PR.
#
# Run directly:
#
#   bash scripts/ship.test.sh
#
# Exit 0 = all checks passed; exit 1 = at least one failed.

set -uo pipefail

FAILS=0

pass() { printf '  ok   — %s\n' "$1"; }
fail() { printf '  FAIL — %s\n' "$1"; FAILS=$((FAILS + 1)); }

# Run the validator snippet with $1 as stdin JSON. Prints "0" or "1" (the exit
# code) to stdout. The snippet is extracted verbatim from ship.sh so any edit
# to the validator is automatically picked up by the next test run.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHIP="${SCRIPT_DIR}/ship.sh"

# Extract the python validator snippet from ship.sh.
# The block starts with a line that is exactly "  python3 -c '" and ends with
# a line that is exactly "' 2>/dev/null)" (inside the FAILING_CHECKS block).
# We use sed with the start/end patterns and strip the delimiters themselves.
VALIDATOR="$(sed -n "/^  python3 -c '/{n; /^' 2/b; :loop; /^' 2/b; p; n; b loop}" "${SHIP}" 2>/dev/null || true)"
# Fallback: extract by unique surrounding context using line numbers.
if [ -z "${VALIDATOR}" ]; then
  # Find the line with "import json, sys" that immediately follows "python3 -c '"
  # in the FAILING_CHECKS block (there is exactly one such occurrence).
  START="$(grep -n '^import json, sys' "${SHIP}" | tail -1 | cut -d: -f1)"
  END="$(awk "NR>${START} && /^sys\.exit\(0 if not bad else 1\)/{print NR; exit}" "${SHIP}")"
  if [ -n "${START}" ] && [ -n "${END}" ]; then
    VALIDATOR="$(sed -n "${START},${END}p" "${SHIP}")"
  fi
fi
if [ -z "${VALIDATOR}" ]; then
  echo "FATAL: could not extract validator snippet from ${SHIP}" >&2
  exit 1
fi

run_validator() {
  # $1 = JSON string to pipe in. Echoes the exit code of the python snippet
  # to stdout; the snippet's own output goes to /dev/null so it doesn't
  # pollute the captured result.
  printf '%s' "$1" | python3 -c "${VALIDATOR}" >/dev/null 2>&1
  echo $?
}

# ── Fixtures ────────────────────────────────────────────────────────────

ALL_PASS='[{"name":"lint","bucket":"pass","state":"SUCCESS","link":"https://ci/1"},{"name":"build","bucket":"pass","state":"SUCCESS","link":"https://ci/2"}]'
ONE_FAIL='[{"name":"lint","bucket":"pass","state":"SUCCESS","link":"https://ci/1"},{"name":"e2e","bucket":"fail","state":"FAILURE","link":"https://ci/2"}]'
ONE_PENDING='[{"name":"lint","bucket":"pass","state":"SUCCESS","link":"https://ci/1"},{"name":"slow","bucket":"pending","state":"IN_PROGRESS","link":"https://ci/2"}]'
ONE_SKIPPING='[{"name":"lint","bucket":"skipping","state":"SKIPPED","link":"https://ci/1"}]'
ONE_CANCEL='[{"name":"lint","bucket":"cancel","state":"CANCELLED","link":"https://ci/1"}]'
EMPTY_ARRAY='[]'
EMPTY_STDIN=''
GARBAGE='not-json-at-all'
SINGLE_PASS='[{"name":"lint","bucket":"pass","state":"SUCCESS","link":"https://ci/1"}]'

echo "ship.sh CI-gate validator — regression suite"
echo "─────────────────────────────────────────────"

# All checks pass → must exit 0 (merge allowed)
result=$(run_validator "${ALL_PASS}")
[ "${result}" -eq 0 ] && pass "all-pass → exit 0 (merge allowed)" || fail "all-pass → expected 0, got ${result}"

# Single pass → must exit 0
result=$(run_validator "${SINGLE_PASS}")
[ "${result}" -eq 0 ] && pass "single-pass → exit 0 (merge allowed)" || fail "single-pass → expected 0, got ${result}"

# One failing check → must exit 1 (merge blocked)
result=$(run_validator "${ONE_FAIL}")
[ "${result}" -eq 1 ] && pass "one-fail → exit 1 (merge blocked)" || fail "one-fail → expected 1, got ${result}"

# One pending check → must exit 1 (merge blocked)
result=$(run_validator "${ONE_PENDING}")
[ "${result}" -eq 1 ] && pass "one-pending → exit 1 (merge blocked)" || fail "one-pending → expected 1, got ${result}"

# Skipping bucket → must exit 1 (merge blocked)
result=$(run_validator "${ONE_SKIPPING}")
[ "${result}" -eq 1 ] && pass "one-skipping → exit 1 (merge blocked)" || fail "one-skipping → expected 1, got ${result}"

# Cancel bucket → must exit 1 (merge blocked)
result=$(run_validator "${ONE_CANCEL}")
[ "${result}" -eq 1 ] && pass "one-cancel → exit 1 (merge blocked)" || fail "one-cancel → expected 1, got ${result}"

# Empty array — the critical fail-open case — must exit 1
result=$(run_validator "${EMPTY_ARRAY}")
[ "${result}" -eq 1 ] && pass "empty-array [] → exit 1 (merge blocked)" || fail "empty-array [] → expected 1, got ${result} (FAIL-OPEN!)"

# Empty stdin — must exit non-zero (json.load throws)
result=$(run_validator "${EMPTY_STDIN}")
[ "${result}" -ne 0 ] && pass "empty-stdin → exit non-zero (merge blocked)" || fail "empty-stdin → expected non-zero, got ${result}"

# Garbage input — must exit non-zero (json.load throws)
result=$(run_validator "${GARBAGE}")
[ "${result}" -ne 0 ] && pass "garbage-stdin → exit non-zero (merge blocked)" || fail "garbage-stdin → expected non-zero, got ${result}"

echo "─────────────────────────────────────────────"
if [ "${FAILS}" -eq 0 ]; then
  echo "All tests passed."
  exit 0
else
  echo "${FAILS} test(s) FAILED."
  exit 1
fi
