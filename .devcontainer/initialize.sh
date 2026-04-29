#!/usr/bin/env bash
#
# Runs on the HOST before `docker compose up` (devcontainer.json:initializeCommand).
#
# Prepares prerequisites that the compose file assumes already exist, so a fresh
# clone works on Linux, macOS and Windows (Git Bash / WSL2) without manual steps:
#   1. ~/.claude — bind-mounted into the container to persist Claude Code sessions
#   2. `restorm-tests` docker network — declared `external: true` in docker-compose.yml
#      so sibling test containers (restorm-petstore, …) can be joined by name

set -e

mkdir -p "$HOME/.claude"

if ! docker network inspect restorm-tests >/dev/null 2>&1; then
  docker network create restorm-tests >/dev/null
fi
