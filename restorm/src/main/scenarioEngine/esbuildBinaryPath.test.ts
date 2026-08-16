// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensureEsbuildBinaryResolvable,
  resetEsbuildBinaryLatchForTests,
  resolveEsbuildSiblingRoot,
  resolvePlatformPackageJson,
  toAsarUnpackedPath
} from './esbuildBinaryPath'

describe('toAsarUnpackedPath', () => {
  it('maps an asar-internal posix path to its unpacked sibling', () => {
    expect(toAsarUnpackedPath('/opt/Restorm/resources/app.asar/node_modules/@esbuild/linux-x64/bin/esbuild'))
      .toBe('/opt/Restorm/resources/app.asar.unpacked/node_modules/@esbuild/linux-x64/bin/esbuild')
  })

  it('maps a Windows path with backslashes', () => {
    expect(toAsarUnpackedPath('C:\\Restorm\\resources\\app.asar\\node_modules\\@esbuild\\win32-x64\\esbuild.exe'))
      .toBe('C:\\Restorm\\resources\\app.asar.unpacked\\node_modules\\@esbuild\\win32-x64\\esbuild.exe')
  })

  it('leaves a plain checkout path untouched', () => {
    const p = '/home/dev/restorm/node_modules/@esbuild/linux-x64/bin/esbuild'
    expect(toAsarUnpackedPath(p)).toBe(p)
  })
})

describe('ensureEsbuildBinaryResolvable', () => {
  const saved = process.env.ESBUILD_BINARY_PATH
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'restorm-esbuild-bin-'))
    resetEsbuildBinaryLatchForTests()
    delete process.env.ESBUILD_BINARY_PATH
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    resetEsbuildBinaryLatchForTests()
    if (saved === undefined) delete process.env.ESBUILD_BINARY_PATH
    else process.env.ESBUILD_BINARY_PATH = saved
  })

  /** Lay out `<dir>/app.asar.unpacked/node_modules/@esbuild/<plat>/bin/esbuild`
   * and return the ASAR-side package.json path a packaged resolve would yield. */
  function packagedLayout(): { asarPkgJson: string; unpackedBinary: string } {
    const rel = join('node_modules', `@esbuild/${process.platform}-${process.arch}`)
    const unpackedPkg = join(dir, 'app.asar.unpacked', rel)
    const binaryRel = process.platform === 'win32' ? 'esbuild.exe' : join('bin', 'esbuild')
    const unpackedBinary = join(unpackedPkg, binaryRel)
    mkdirSync(join(unpackedPkg, 'bin'), { recursive: true })
    writeFileSync(unpackedBinary, '#!/bin/sh\n')
    return { asarPkgJson: join(dir, 'app.asar', rel, 'package.json'), unpackedBinary }
  }

  it('points ESBUILD_BINARY_PATH at the unpacked binary when the resolution lands in an asar', () => {
    const { asarPkgJson, unpackedBinary } = packagedLayout()
    ensureEsbuildBinaryResolvable(() => asarPkgJson)
    expect(process.env.ESBUILD_BINARY_PATH).toBe(unpackedBinary)
  })

  it('leaves the env unset when the unpacked binary is missing', () => {
    ensureEsbuildBinaryResolvable(() => join(dir, 'app.asar', 'node_modules', 'x', 'package.json'))
    expect(process.env.ESBUILD_BINARY_PATH).toBeUndefined()
  })

  it('never overrides a caller-provided ESBUILD_BINARY_PATH', () => {
    process.env.ESBUILD_BINARY_PATH = '/custom/esbuild'
    const { asarPkgJson } = packagedLayout()
    ensureEsbuildBinaryResolvable(() => asarPkgJson)
    expect(process.env.ESBUILD_BINARY_PATH).toBe('/custom/esbuild')
  })

  it('no-ops when the resolution lands outside any asar (dev checkout)', () => {
    ensureEsbuildBinaryResolvable(() => '/home/dev/restorm/node_modules/@esbuild/linux-x64/package.json')
    expect(process.env.ESBUILD_BINARY_PATH).toBeUndefined()
  })

  it('runs once: a later call with a different resolver is a no-op', () => {
    ensureEsbuildBinaryResolvable(() => '/home/dev/checkout/package.json')
    const { asarPkgJson } = packagedLayout()
    ensureEsbuildBinaryResolvable(() => asarPkgJson)
    expect(process.env.ESBUILD_BINARY_PATH).toBeUndefined()
  })

  it('falls back to the afterPack drop under app.asar.unpacked when the platform package is absent from the archive (cross-arch build)', () => {
    // The x64 mac app built on an arm64 runner: node_modules holds only the
    // HOST's platform package, so the in-archive resolve throws — but
    // afterPack placed the TARGET's package under app.asar.unpacked.
    const { unpackedBinary } = packagedLayout()
    ensureEsbuildBinaryResolvable(
      () => { throw new Error('MODULE_NOT_FOUND') },
      () => join(dir, 'app.asar', 'node_modules')
    )
    expect(process.env.ESBUILD_BINARY_PATH).toBe(unpackedBinary)
  })

  it('stays unset when the cross-arch fallback finds no binary either', () => {
    ensureEsbuildBinaryResolvable(
      () => { throw new Error('MODULE_NOT_FOUND') },
      () => join(dir, 'app.asar', 'node_modules')
    )
    expect(process.env.ESBUILD_BINARY_PATH).toBeUndefined()
  })

  it('the cross-arch fallback no-ops outside any asar (dev checkout with a hole in node_modules)', () => {
    ensureEsbuildBinaryResolvable(
      () => { throw new Error('MODULE_NOT_FOUND') },
      () => '/home/dev/restorm/node_modules'
    )
    expect(process.env.ESBUILD_BINARY_PATH).toBeUndefined()
  })

  it('stays unset when both resolvers throw', () => {
    ensureEsbuildBinaryResolvable(
      () => { throw new Error('MODULE_NOT_FOUND') },
      () => { throw new Error('esbuild itself is gone') }
    )
    expect(process.env.ESBUILD_BINARY_PATH).toBeUndefined()
  })

  it('the default sibling-root resolver lands on the node_modules containing esbuild', () => {
    const root = resolveEsbuildSiblingRoot()
    expect(existsSync(join(root, 'esbuild', 'package.json'))).toBe(true)
    // The host's platform package must be REACHABLE at root/@esbuild/<plat>-<arch>
    // (via pnpm symlinks in dev, as a real dir in the packed app) — the path
    // shape the cross-arch fallback derives when the archive resolve throws.
    expect(existsSync(join(root, '@esbuild', `${process.platform}-${process.arch}`, 'package.json'))).toBe(true)
  })

  it('the default resolver finds the real platform package (two-hop via esbuild)', () => {
    // Under pnpm's isolated store, resolving `@esbuild/<plat>` from THIS file
    // throws MODULE_NOT_FOUND (it is a transitive dep of esbuild, not a
    // top-level link) — the two-hop resolution must still land on it.
    const resolved = resolvePlatformPackageJson()
    expect(resolved).toContain(`@esbuild`)
    expect(resolved.endsWith('package.json')).toBe(true)
  })
})
