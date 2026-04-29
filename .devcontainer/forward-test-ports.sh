#!/usr/bin/env bash
#
# Forwards localhost:<host-port> → <container-name>:<container-port> for every
# restorm test service, so the app inside the devcontainer can hit the exact
# same URLs as a developer running the tests from the host (`localhost:8080`
# for Petstore, etc.).
#
# Requires:
#  - `socat` (installed by postinstall.sh)
#  - the devcontainer to be attached to the external `restorm-tests` network
#    (see .devcontainer/docker-compose.yml). Target containers don't need to
#    be running yet — socat will connect lazily on each incoming connection.
#
# Invoked by `postStartCommand` in devcontainer.json, so it runs every time
# the container starts.

set -euo pipefail

# host_port:container:container_port
FORWARDS=(
  '8080:restorm-petstore:8080'
  '4000:restorm-graphql:4000'
  '8090:restorm-soap:8080'
  '9000:restorm-grpc:9000'
  '9002:restorm-grpc:9001'
  '1883:restorm-mqtt:1883'
  '9001:restorm-mqtt:9001'
  '3001:restorm-socketio:3001'
)

# Kill stale forwarders from a previous start.
pkill -f 'socat.*TCP-LISTEN' 2>/dev/null || true

for entry in "${FORWARDS[@]}"; do
  IFS=':' read -r host_port target target_port <<<"$entry"
  # `setsid … &` + `disown` detaches socat from the invoking shell so it
  # survives the script exit and any SIGHUP the invoker might get.
  setsid socat -d "TCP-LISTEN:${host_port},reuseaddr,fork,bind=127.0.0.1" \
    "TCP:${target}:${target_port}" \
    </dev/null >/var/log/socat-${host_port}.log 2>&1 &
  disown || true
  echo "  localhost:${host_port} → ${target}:${target_port} (pid $!)"
done

echo 'Port forwarders running.'
