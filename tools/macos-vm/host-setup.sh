#!/usr/bin/env bash
# Host-side tooling for the macOS QA sandbox. Run on the LINUX host, not in the VM.
# Installs vncdotool (screenshot + mouse control of the guest) and checks prereqs.
set -euo pipefail

echo "==> prerequisites"
[ -e /dev/kvm ]     && echo "  /dev/kvm ok"     || { echo "  MISSING /dev/kvm (enable virtualization)"; exit 1; }
[ -e /dev/net/tun ] && echo "  /dev/net/tun ok" || echo "  WARN: /dev/net/tun missing"
command -v docker >/dev/null || { echo "  docker MISSING"; exit 1; }

# Docker Desktop's engine has no /dev/kvm — the system engine does.
CTX=$(docker context show 2>/dev/null || echo default)
if [ "$CTX" != "default" ]; then
  echo "  WARN: docker context is '$CTX' (likely Docker Desktop, no /dev/kvm access)."
  echo "        Use 'docker --context default …' or 'docker context use default'."
fi
DR=$(docker --context default info 2>/dev/null | awk -F': ' '/Docker Root Dir/{print $2}')
[ -n "${DR:-}" ] && echo "  docker data-root: $DR ($(df -h "$DR" 2>/dev/null | awk 'NR==2{print $4}') free)"

echo "==> vncdotool (screenshots + clicks), user-local"
python3 -m pip install --user --upgrade vncdotool 2>/dev/null \
  || python3 -m pip install --user --break-system-packages --upgrade vncdotool
VNCDO="$HOME/.local/bin/vncdo"; [ -x "$VNCDO" ] || VNCDO="$(command -v vncdo || echo vncdo)"

cat <<EOF

Ready. Useful commands:

  # lifecycle (note the explicit context)
  docker --context default compose up -d
  docker --context default compose down
  docker logs -f macos

  # web installer / desktop
  http://localhost:8006

  # see the guest desktop (PNG you can open or feed to an agent)
  $VNCDO -s localhost::5900 capture /tmp/mac-screen.png

  # drive the GUI (clicks are reliable; typing over VNC is NOT — see README)
  $VNCDO -s localhost::5900 move 640 400 click 1

  # shell access, once Remote Login is enabled (System Settings > Sharing)
  ssh -p 2222 <user>@localhost

  # move files in/out (there is no working 9p share on macOS)
  scp -P 2222 ./file <user>@localhost:~/
EOF
