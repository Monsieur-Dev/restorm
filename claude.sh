#!/usr/bin/env bash
# Start the Backlog.md board server in the background, then launch Claude.

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKLOG_PORT=6420

# Only start the board if nothing is already serving on the port (idempotent).
if ! curl -s -o /dev/null "http://localhost:${BACKLOG_PORT}" 2>/dev/null; then
  ( cd "$REPO_DIR" && npx -y backlog.md browser --port "$BACKLOG_PORT" \
      >/tmp/backlog-board.log 2>&1 & )
  echo "Backlog.md board starting on http://localhost:${BACKLOG_PORT} (logs: /tmp/backlog-board.log)"
else
  echo "Backlog.md board already running on http://localhost:${BACKLOG_PORT}"
fi

claude --channels plugin:telegram@claude-plugins-official
