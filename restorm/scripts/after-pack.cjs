// electron-builder afterPack hook (Linux only).
//
// Wraps the packaged executable so the Chromium sandbox is disabled BEFORE the
// process starts. On distros that restrict unprivileged user namespaces
// (Ubuntu 24.04+/Kubuntu, AppArmor), Chromium's SUID/userns sandbox aborts the
// process during C++ init — BEFORE the app's main JS runs — so an in-app
// `app.commandLine.appendSwitch('no-sandbox')` is too late and cannot prevent it
// (verified: appendSwitch leaves the crash intact).
//
// The AppImage's AppRun and a raw ./restorm-bin invocation both exec the
// `restorm-bin` executable directly with no extra args, so the only place to
// inject the flag for every launch path — double-click, menu, the updater's
// zero-arg relaunch, and app.relaunch() — is the executable itself. We rename
// the real ELF to `restorm-bin.bin` and drop a tiny wrapper at `restorm-bin`
// that exports ELECTRON_DISABLE_SANDBOX=1 before exec'ing it.
//
// Why the env var and not `--no-sandbox`: ELECTRON_DISABLE_SANDBOX is read at
// C++ init just like the flag, but being an environment variable it is
// INHERITED by every child process and by app.relaunch(), so a self-restart
// stays sandbox-free without having to thread the flag through. Setting it here
// (the launcher) is what makes it take effect; setting it from JS would be too
// late.
//
// The .deb/.rpm also route their menu/CLI launch through /usr/bin/restorm
// (build/postinstall.sh), which already passes --no-sandbox; the wrapper's env
// var is a harmless no-op there. This hook runs once on the shared unpacked dir,
// so it applies to every Linux target, which is fine.

const { promises: fs } = require('fs')
const path = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return

  const dir = context.appOutDir
  const exe = context.packager.executableName // "restorm-bin"
  const realName = `${exe}.bin`
  const exePath = path.join(dir, exe)
  const realPath = path.join(dir, realName)

  // Idempotent: if a previous run already wrapped it, do nothing.
  try {
    await fs.access(realPath)
    return
  } catch {
    // not yet wrapped
  }

  await fs.rename(exePath, realPath)

  const wrapper = `#!/bin/bash
# Disable the Chromium sandbox before startup. On distros that restrict
# unprivileged user namespaces (Ubuntu 24.04+/Kubuntu) the SUID/userns sandbox
# aborts Chromium before the app's JS runs; ELECTRON_DISABLE_SANDBOX is read at
# C++ init and inherited by children + app.relaunch(), so it holds on the
# updater's relaunch too. (Setting it in-app via appendSwitch is too late.)
HERE="$(dirname "$(readlink -f "$0")")"
export ELECTRON_DISABLE_SANDBOX=1
exec "$HERE/${realName}" "$@"
`
  await fs.writeFile(exePath, wrapper, { mode: 0o755 })
}
