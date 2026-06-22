#!/usr/bin/env bash
# Regression test for scripts/mcp-launcher.mjs.
#
# There is no JS test harness for the repo's root tooling, so this is a
# self-contained bash test (matching scripts/git-commit-timeout.test.sh /
# ship.test.sh). It drives the launcher's SYNTHETIC handshake only — the
# `initialize` reply is answered by the launcher itself without spawning or
# probing restorm, so the test is hermetic and fast (no GUI app launches).
#
# Guards the gap that broke on-demand screenshot read-back: the launcher
# proxies the MCP client, and the client negotiates server capabilities ONCE
# at `initialize`. If that synthetic reply doesn't advertise `resources`, the
# client short-circuits every `resources/list` / `resources/read` with
# "Server restorm does not support resources" and the on-demand
# `ecui-media://screenshot/<file>` fetch is dead end-to-end — even though the
# live restorm instance fully supports resources. So: assert the synthetic
# `initialize` advertises BOTH `tools` and `resources`.
#
# Run directly:
#   bash scripts/mcp-launcher.test.sh
#
# Exit 0 = all checks passed; exit 1 = at least one failed (details above).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER="${SCRIPT_DIR}/mcp-launcher.mjs"
FAILS=0

pass() { printf '  ok   — %s\n' "$1"; }
fail() { printf '  FAIL — %s\n' "$1"; FAILS=$((FAILS + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1 (assertion: $2)"; fi; }

# ───────────────────────────────────────────────────────────────────────
echo '# synthetic initialize advertises tools + resources capabilities'

# Pin discovery to an empty temp dir so the launcher never adopts a real
# running restorm (it wouldn't for `initialize` anyway — that reply is fully
# synthetic — but this keeps the test independent of the host's state).
EMPTY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mcp-launcher-test.XXXXXX")"

INIT_REQ='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.0.0"}}}'

# Pipe a single `initialize` line in; the launcher answers synthetically and
# then sees EOF on stdin and exits. `timeout` bounds it in case it ever hangs.
REPLY="$(printf '%s\n' "${INIT_REQ}" | RESTORM_MCP_DIR="${EMPTY_DIR}" timeout 20 node "${LAUNCHER}" 2>/dev/null)"

rm -rf "${EMPTY_DIR}"

check 'reply is non-empty' '[ -n "${REPLY}" ]'
check 'reply is for the initialize request (id 1)' 'printf "%s" "${REPLY}" | grep -q "\"id\":1"'
check 'reply advertises tools capability' 'printf "%s" "${REPLY}" | grep -q "\"tools\""'
check 'reply advertises resources capability' 'printf "%s" "${REPLY}" | grep -q "\"resources\""'
check 'reply is valid JSON with both capabilities (strict)' \
  'printf "%s" "${REPLY}" | node -e "const m=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));const c=m.result&&m.result.capabilities||{};process.exit(c.tools&&c.resources?0:1)"'

# ───────────────────────────────────────────────────────────────────────
if [ "${FAILS}" -eq 0 ]; then
  echo 'ALL PASS'
  exit 0
else
  echo "FAILURES: ${FAILS}"
  exit 1
fi
