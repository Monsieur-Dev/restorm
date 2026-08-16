// electron-builder afterPack hook.
//
// Two jobs, both per packed target:
//
// 1. (Linux only) Wrap the packaged executable so the Chromium sandbox is
//    disabled BEFORE the process starts. On distros that restrict unprivileged
//    user namespaces (Ubuntu 24.04+/Kubuntu, AppArmor), Chromium's SUID/userns
//    sandbox aborts the process during C++ init — BEFORE the app's main JS runs
//    — so an in-app `app.commandLine.appendSwitch('no-sandbox')` is too late and
//    cannot prevent it (verified: appendSwitch leaves the crash intact).
//
//    The AppImage's AppRun and a raw ./restorm-bin invocation both exec the
//    `restorm-bin` executable directly with no extra args, so the only place to
//    inject the flag for every launch path — double-click, menu, the updater's
//    zero-arg relaunch, and app.relaunch() — is the executable itself. We rename
//    the real ELF to `restorm-bin.bin` and drop a tiny wrapper at `restorm-bin`
//    that exports ELECTRON_DISABLE_SANDBOX=1 before exec'ing it.
//
//    Why the env var and not `--no-sandbox`: ELECTRON_DISABLE_SANDBOX is read at
//    C++ init just like the flag, but being an environment variable it is
//    INHERITED by every child process and by app.relaunch(), so a self-restart
//    stays sandbox-free without having to thread the flag through. Setting it
//    here (the launcher) is what makes it take effect; setting it from JS would
//    be too late.
//
//    The .deb/.rpm also route their menu/CLI launch through /usr/bin/restorm
//    (build/postinstall.sh), which already passes --no-sandbox; the wrapper's
//    env var is a harmless no-op there. This step runs once on the shared
//    unpacked dir, so it applies to every Linux target, which is fine.
//
// 2. (Every platform) Guarantee the esbuild binary matching the TARGET
//    platform+arch sits under `app.asar.unpacked`. node_modules only ever
//    holds the binary for the machine that ran `pnpm install`, and
//    electron-builder refuses to bundle a platform-specific optional dep that
//    doesn't match the HOST — so a cross-arch target (the x64 mac app built on
//    an arm64 mac runner) ships without `@esbuild/darwin-x64` and every code
//    node dies at runtime with esbuild's "installed for another platform"
//    error. When the target's package is missing from the unpacked dir, fetch
//    the exact same esbuild version from the registry and extract it there;
//    the runtime bootstrap (`esbuildBinaryPath.ts`) knows how to find it even
//    though the package is absent from the archive itself. Failing to obtain
//    it fails the build — shipping code nodes that cannot run is worse than a
//    red pipeline.

const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } = require('node:fs')
const { promises: fs } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

/** electron-builder's Arch enum ordinals → esbuild package arch names. */
const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }

/** The packed target's `app.asar.unpacked` root (layout differs on mac). */
function unpackedRoot(context) {
  if (context.electronPlatformName === 'darwin') {
    const app = readdirSync(context.appOutDir).find((f) => f.endsWith('.app'))
    if (!app) throw new Error(`afterPack: no .app bundle under ${context.appOutDir}`)
    return path.join(context.appOutDir, app, 'Contents', 'Resources', 'app.asar.unpacked')
  }
  return path.join(context.appOutDir, 'resources', 'app.asar.unpacked')
}

/**
 * Ensure `app.asar.unpacked/node_modules/@esbuild/<target>/` holds the
 * target's esbuild binary. No-op when electron-builder already unpacked it
 * (host arch == target arch). Throws when the package cannot be obtained.
 * Returns the ensured package dir, or null for a universal/unknown arch.
 */
function ensureEsbuildUnpackedForTarget(context, log = console.log) {
  const platform = context.electronPlatformName
  const archName = ARCH_NAMES[context.arch]
  if (!archName || archName === 'universal') return null
  const pkg = `@esbuild/${platform}-${archName}`
  const dest = path.join(unpackedRoot(context), 'node_modules', '@esbuild', `${platform}-${archName}`)
  const binary = platform === 'win32' ? path.join(dest, 'esbuild.exe') : path.join(dest, 'bin', 'esbuild')
  if (existsSync(binary)) return dest

  const version = require('esbuild/package.json').version
  log(`afterPack: ${pkg} missing from app.asar.unpacked (cross-arch build) — fetching ${pkg}@${version}`)
  const work = mkdtempSync(path.join(tmpdir(), 'esbuild-arch-'))
  try {
    execFileSync('npm', ['pack', `${pkg}@${version}`, '--pack-destination', work], { stdio: 'pipe' })
    const tarball = readdirSync(work).find((f) => f.endsWith('.tgz'))
    if (!tarball) throw new Error(`npm pack produced no tarball for ${pkg}@${version}`)
    mkdirSync(dest, { recursive: true })
    // npm tarballs root everything under `package/` — strip it. tar preserves
    // the executable bit on bin/esbuild (esbuild.exe on win32 needs none).
    execFileSync('tar', ['-xzf', path.join(work, tarball), '-C', dest, '--strip-components=1'], { stdio: 'pipe' })
    if (!existsSync(binary)) throw new Error(`extraction of ${pkg}@${version} left no ${path.basename(binary)}`)
    return dest
  } catch (err) {
    rmSync(dest, { recursive: true, force: true })
    throw new Error(
      `afterPack: cannot provide ${pkg}@${version} for the ${platform}-${archName} target — ` +
      `a build without it ships code nodes that cannot run. Original error: ${err.message}`
    )
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

exports.ensureEsbuildUnpackedForTarget = ensureEsbuildUnpackedForTarget

async function wrapLinuxExecutable(context) {
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

exports.default = async function afterPack(context) {
  const ensured = ensureEsbuildUnpackedForTarget(context)
  if (ensured) console.log(`afterPack: target esbuild binary present at ${ensured}`)

  if (context.electronPlatformName === 'linux') {
    await wrapLinuxExecutable(context)
  }
}
