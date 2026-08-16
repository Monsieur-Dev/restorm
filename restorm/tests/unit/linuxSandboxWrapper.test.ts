import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Guard for the Linux launch fix.
 *
 * On distros that restrict unprivileged user namespaces (Ubuntu 24.04+ default
 * `kernel.apparmor_restrict_unprivileged_userns=1`), Chromium's SUID/userns
 * sandbox aborts the process during C++ init — before the app's main JS runs —
 * so an in-app `appendSwitch('no-sandbox')` cannot prevent it. The fix is an
 * electron-builder `afterPack` hook that turns the packaged `restorm-bin` into a
 * wrapper exporting `ELECTRON_DISABLE_SANDBOX=1` (read at C++ init, inherited by
 * children + app.relaunch) before exec'ing the real ELF. This guards that the
 * hook is present, wired, and still expresses that intent.
 */
describe('Linux sandbox launcher wrapper (afterPack)', () => {
  const pkgRoot = process.cwd() // restorm package root
  const hookRel = 'scripts/after-pack.cjs'

  it('build.afterPack points at the wrapper hook', () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
    expect(pkg?.build?.afterPack).toBe(hookRel)
  })

  it('the hook exists and exports ELECTRON_DISABLE_SANDBOX via a renamed binary', () => {
    const hookPath = join(pkgRoot, hookRel)
    expect(existsSync(hookPath), `${hookRel} exists`).toBe(true)
    const src = readFileSync(hookPath, 'utf8')
    // The wrap is Linux-scoped (the hook itself now also serves other
    // platforms for the esbuild target-arch guarantee)
    expect(src).toMatch(/electronPlatformName\s*===\s*'linux'[\s\S]*wrapLinuxExecutable/)
    // Injects the env var that disables the sandbox pre-JS
    expect(src).toContain('ELECTRON_DISABLE_SANDBOX=1')
    // Wraps by renaming the real binary aside and exec'ing it
    expect(src).toMatch(/\.bin/)
    expect(src).toMatch(/exec /)
  })
})
