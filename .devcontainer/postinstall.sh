#!/usr/bin/env bash
#
# Runs once after the devcontainer is created (postCreateCommand).
# Installs Node.js 25 inside the LXDE/VNC container so we can run the
# Electron / Playwright E2E suite with a real graphical session.

set -euo pipefail

log() { printf '\n\033[1;36m[postinstall]\033[0m %s\n' "$*"; }

log 'Updating apt cache and installing prerequisites…'
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  git \
  gnupg

log 'Adding NodeSource repository for Node.js 25…'
curl -fsSL https://deb.nodesource.com/setup_25.x | bash -

log 'Adding GitHub CLI apt repository…'
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | gpg --dearmor -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  > /etc/apt/sources.list.d/github-cli.list
apt-get update

log 'Installing Node.js 25, GitHub CLI, and Docker CLI…'
# docker.io ships only the client here — the daemon runs on the host and is
# reached via the /var/run/docker.sock bind mount declared in docker-compose.yml.
# The base webtop image usually already ships a docker CLI; `apt-get install`
# is a no-op in that case.
apt-get install -y --no-install-recommends nodejs gh docker.io socat

log 'Cleaning apt caches…'
apt-get clean
rm -rf /var/lib/apt/lists/*

log "git:    $(git --version)"
log "gh:     $(gh --version | head -n1)"
log "docker: $(docker --version 2>/dev/null || echo 'not installed')"
log "Node:   $(node --version)"
log "npm:    $(npm --version)"

log 'Installing pnpm globally…'
npm install -g pnpm
log "pnpm:  $(pnpm --version)"

log 'Installing Claude Code CLI globally…'
npm install -g @anthropic-ai/claude-code
log "claude: $(claude --version 2>/dev/null || echo 'installed')"

log 'Done.'
