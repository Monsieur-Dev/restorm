# Local QA VMs + local release feed

Cross-OS sandboxes for **installing, launching, and auto-updating** packaged
Restorm builds without owning the hardware, plus a local stand-in for the
`dl.restorm.app` release feed so the whole install → update loop runs in seconds
against a **locally built** artifact instead of waiting ~15 min on CI.

| VM | Image | Tests | Web viewer |
|----|-------|-------|-----------|
| [`macos-vm/`](./macos-vm) | `dockurr/macos` | macOS rendering (titlebar, menus) — **not** builds | :8006 |
| [`windows-vm/`](./windows-vm) | `dockurr/windows` | NSIS `.exe` install + auto-update | :8006 |
| [`linux-vm/`](./linux-vm) | `qemux/qemu` (Ubuntu/Debian) | `.deb` / `.AppImage` install + auto-update | :8006 |
| [`redhat-vm/`](./redhat-vm) | `qemux/qemu` (Fedora/RHEL) | `.rpm` install + auto-update | :8007 |

> These are **QA sandboxes, not a release path.** Distributable artifacts are
> built + signed by `.github/workflows/release.yml` on the proper runners. The
> VMs only *consume* builds. macOS additionally may not build/sign/distribute
> here (Apple EULA) — see `macos-vm/README.md`.

## Why full VMs (not containers) for Linux

The sandbox crash we chase (`kernel.apparmor_restrict_unprivileged_userns=1`,
the Ubuntu 24.04+ / Kubuntu default that SIGTRAPs Chromium and is why the
AppImage needs `--no-sandbox`) is **host-kernel policy**. A Docker *container*
shares the host kernel and layers docker's own AppArmor/seccomp on top, so it
does **not** reproduce what a real user hits. `qemux/qemu` boots a real guest
kernel → faithful. (For that specific bug you can also just build + run on a
Ubuntu 24.04+ host — but the VMs give us Windows / Fedora / clean-install
coverage we otherwise lack.)

## Prerequisites (host) — same as the mac VM

- `/dev/kvm` + `/dev/net/tun`, CPU virtualization on
- Docker **Engine** (not Docker Desktop): its context has no `/dev/kvm`. Always
  `docker --context default …`. `tools/macos-vm/host-setup.sh` checks this.
- Disk on the docker data-root: ~40 GB per VM.

## Common lifecycle

```bash
cd tools/<os>-vm
docker --context default compose up -d      # first boot downloads the ISO + installs
docker logs -f restorm-<os>-vm              # watch install progress
# open http://localhost:8006 (or :8007 for redhat) — the web viewer
docker --context default compose down       # stop, keep the disk
docker --context default compose down -v    # stop + delete the disk
```

Shared credentials across every VM: user **`restorm`**, password **`password`**.

- **Windows** installs **unattended** (dockur answers setup) — just wait.
- **Linux/Fedora** boot a desktop **installer ISO**: run the installer once in
  the web viewer (create user `restorm` / `password`), then reboot to disk.
- Drive Linux/Windows guests over **SSH/RDP**, not VNC typing (the mac VM's
  keyboard-mangling gotcha). Clicks over VNC (`vncdotool`) are always reliable.

## Moving the built artifact into the guest

Each compose mounts `./shared` → the guest's Samba share:

- **Windows**: `\\host.lan\Data` (map to a drive letter once).
- **Linux/Fedora**: `mount -t cifs //host.lan/Data /mnt -o guest` (or use the
  9p/virtiofs mount dockur exposes). No dev tree in the VM — copy just the
  installer + feed files.

Build locally first (host has `dpkg-deb` + `rpmbuild`; `.exe`/`.dmg` still need
their runners):

```bash
cd restorm/restorm
pnpm run build && pnpm exec electron-builder --linux AppImage deb rpm
cp dist/restorm-*.{AppImage,deb,rpm} ../tools/linux-vm/shared/
```

## Local release feed (fast auto-update loop)

Goal: point the guest's `dl.restorm.app` at a **local** server dishing out a
freshly built artifact + its `latest-*.yml`, so "check for update → download →
relaunch" runs in seconds against your build.

electron-updater talks **HTTPS**, so a plain hosts-file redirect isn't enough —
the TLS cert must validate. The `tools/local-feed/` server (a small Caddy with
an internal CA) serves the `dist/` artifacts as `https://dl.restorm.app`; install
its CA root into each guest's trust store, then add the hosts entry:

- **Linux**: `/etc/hosts` → `<feed-ip> dl.restorm.app`; CA into
  `/usr/local/share/ca-certificates/` + `update-ca-certificates`.
- **Windows**: `C:\Windows\System32\drivers\etc\hosts`; import the CA into
  `Cert:\LocalMachine\Root`.

Bump the local `latest-*.yml` version above the installed build and hit
"Check for updates" in-app to exercise the update. (Wiring the exact
guest→feed network path is done live per VM — the guest reaches host-side
services through the QEMU gateway; see `tools/local-feed/README.md`.)
