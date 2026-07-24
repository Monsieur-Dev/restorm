# macOS QA sandbox (local VM)

A KVM-accelerated macOS VM for reproducing and fixing **macOS-only rendering
issues** (titlebar, native traffic lights, menu bar, ⌘ shortcuts) from a Linux
workstation, without renting a Mac.

> **Legal.** Apple's EULA permits macOS only on Apple-branded hardware. This is
> a **local, experimental** tool for eyeballing UI. Do **not** use it to build,
> sign or distribute releases. Release builds run on GitHub Actions' macOS
> runners (real Apple hardware) — see `.github/workflows/release.yml`.

## Why this exists

The e2e harness runs on Linux/xvfb and structurally cannot validate macOS
rendering. Everything below was learned the hard way while resolving the
"do the native traffic lights render?" question — the gotchas are the point of
this document.

## Prerequisites (host)

- `/dev/kvm` and `/dev/net/tun` present, CPU virtualization enabled
- Docker **Engine** (not Docker Desktop — see the first gotcha)
- ~40 GB free on the Docker data-root filesystem (`docker info | grep "Docker Root Dir"`)

## Start

```bash
cd tools/macos-vm
docker --context default compose up -d
```

Open **http://localhost:8006** and complete the macOS installer:

1. The installer shows only "macOS Base System" as a target and says
   **"This disk is locked"** — that is the installer's own read-only image.
   Quit to **Disk Utility** first, `View → Show All Devices`, select the ~48 GB
   *physical* disk (QEMU HARDDISK / VirtIO Block Media), **Erase** it as
   APFS / GUID Partition Map, name it `Macintosh HD`, then install onto it.
2. The install reboots several times into a boot picker. Each time choose
   **Macintosh HD** (never "macOS Base System") and click the ↑ arrow.

## Give an agent/CLI access

### 1. Enable SSH — use the GUI toggle, not `systemsetup`

```
sudo systemsetup -setremotelogin on
→ "Turning Remote Login on or off requires Full Disk Access privileges."
```

`systemsetup` needs Full Disk Access, which Terminal doesn't have. The GUI
toggle does **not**:

**System Settings → General → Sharing → Remote Login = ON**

(This is clickable over VNC, so an agent can do it itself — mouse control works
even when keyboard input doesn't; see the keyboard gotcha.)

### 2. Install an SSH key

Password auth works immediately (`paramiko`, or `ssh` interactively). Log in
once with the password and append your public key to
`~/.ssh/authorized_keys` (`chmod 700 ~/.ssh`, `chmod 600 authorized_keys`).
After that: `ssh -p 2222 <user>@localhost`.

### 3. Screenshots + mouse from the host

```bash
python3 -m pip install --user vncdotool
vncdo -s localhost::5900 capture screen.png        # see the desktop
vncdo -s localhost::5900 move 640 400 click 1      # click
```

Screenshots + clicks are how you validate rendering and drive System Settings.

## Gotchas (all hit in practice)

| Symptom | Cause / fix |
|---|---|
| `error gathering device information while adding custom device "/dev/kvm": no such file or directory` | Your shell's docker context is **Docker Desktop**, whose engine runs in its own VM with no `/dev/kvm`. Use the system engine: `docker --context default …` (or `docker context use default`). |
| `sudo mount_9p shared` → *command not found* | **macOS has no 9p client.** QEMU exposes the share (`mount_tag=shared`) but the guest can't mount it. Don't bother with a 9p bind-mount — transfer files with `scp -P 2222` instead. |
| `systemsetup -setremotelogin` refuses | Needs Full Disk Access. Use the **Sharing** GUI toggle instead. |
| VNC-typed text comes out mangled (`mount_9p` → `mount-9p`, capitals lost, `~` → `§`) | VNC **isn't sending Shift**, and a FR/AZERTY guest layout remaps letters too. Switching the guest to the U.S. layout fixes the letters but *not* Shift. **Don't drive the guest by typing over VNC — use SSH.** Mouse clicks are always reliable. |
| GUI app launched over SSH never appears; `launchctl asuser` → *Could not switch to audit session … Operation not permitted* | An SSH session isn't in the Aqua GUI session. Launch through LaunchServices instead: `open -n /path/to/App.app --args <args>`. Requires someone logged in at the console. |
| `FATAL ERROR: Reached heap limit — JavaScript heap out of memory` during `electron-vite build` | **4 GB is not enough** for restorm's renderer bundle. Use `RAM_SIZE: 6G` and `NODE_OPTIONS=--max-old-space-size=4096`. |
| Xcode CLT download claims *"About 41 hours remaining"* | Bogus early estimate from Apple; it settles to ~20 min. (Verify your link separately — this VM measured 18 MB/s.) Accepting the CLT licence is a legal agreement — have the human confirm. |
| `ERR_PNPM_UNSUPPORTED_PLATFORM @img/sharp-linux-x64` | Was a real repo bug: a Linux-only binary pinned as a **non-optional** devDependency, which broke install on macOS *and* Windows. Fixed by removing it (sharp resolves its own per-platform binary). |

## Building restorm inside the VM

```bash
# Node per .nvmrc (NOT "latest" — Node 26 was too new)
curl -sSLo node.tgz https://nodejs.org/dist/v25.9.0/node-v25.9.0-darwin-x64.tar.gz
mkdir -p ~/node25 && tar xzf node.tgz -C ~/node25 --strip-components=1
export PATH="$HOME/node25/bin:$PATH"
corepack enable && corepack prepare pnpm@10 --activate

# Xcode Command Line Tools (native deps). GUI dialog → click Install, accept licence.
xcode-select --install

# source: scp a tarball from the host (no 9p!), excluding node_modules/dist/.git
export NODE_OPTIONS=--max-old-space-size=4096
pnpm install --frozen-lockfile
pnpm run build:core-ui
pnpm --filter restorm run build

# launch into the GUI session (NOT plain ssh execution)
open -n node_modules/electron/dist/Electron.app --args "$PWD/restorm"
```

## Cheaper alternative for a pure question

If you only need to know how **Electron itself** behaves on macOS (window
flags, traffic lights, titlebar insets), skip the whole restorm build: a
~20-line Electron app with the same `BrowserWindow` options answers it in
minutes and needs no Xcode. That is how the macOS titlebar / traffic-lights
question was settled.

## Stop / reset

```bash
docker --context default compose down      # stop, keep the disk
docker --context default compose down -v   # stop and DELETE the macOS disk
```
