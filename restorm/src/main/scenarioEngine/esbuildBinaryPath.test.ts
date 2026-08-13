// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensureEsbuildBinaryResolvable,
  resetEsbuildBinaryLatchForTests,
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

  it('the default resolver finds the real platform package (two-hop via esbuild)', () => {
    // Under pnpm's isolated store, resolving `@esbuild/<plat>` from THIS file
    // throws MODULE_NOT_FOUND (it is a transitive dep of esbuild, not a
    // top-level link) — the two-hop resolution must still land on it.
    const resolved = resolvePlatformPackageJson()
    expect(resolved).toContain(`@esbuild`)
    expect(resolved.endsWith('package.json')).toBe(true)
  })
})
