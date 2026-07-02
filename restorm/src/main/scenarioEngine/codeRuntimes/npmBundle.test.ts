// @vitest-environment node
// esbuild trips over jsdom's cross-realm `TextEncoder` — see
// `codeSandbox.test.ts` for the same override.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { runInNewContext } from 'node:vm'

vi.mock('electron', () => ({ app: { getPath: (): string => tmpdir() } }))

const { httpGetText, httpGetBytes } = vi.hoisted(() => ({
  httpGetText: vi.fn<(url: string) => Promise<string>>(),
  httpGetBytes: vi.fn<(url: string) => Promise<Uint8Array>>()
}))
vi.mock('./depsInstaller', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./depsInstaller')>()
  return { ...actual, httpGetText, httpGetBytes }
})

import { readCachedBundle, buildUserPackagesPrelude, mountPackagesIntoContext, npmBundleFetcher } from './npmBundle'
import { packageDir, packageSubDir } from './depsCache'
import type { PackageSpec } from './types'

/** Build a minimal (no-PAX) ustar tar entry for one file. */
function tarEntry(name: string, content: string): Buffer {
  const data = Buffer.from(content, 'utf8')
  const header = Buffer.alloc(512)
  header.write(name, 0, 'utf8')
  header.write('0000644\0', 100, 'utf8')
  header.write('0000000\0', 108, 'utf8')
  header.write('0000000\0', 116, 'utf8')
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 'utf8')
  header.write('00000000000\0', 136, 'utf8')
  header.fill(0x20, 148, 156) // chksum field blanked (spaces) while computing
  header.write('0', 156, 'ascii') // typeflag: regular file
  header.write('ustar\0', 257, 'utf8')
  header.write('00', 263, 'utf8')
  let sum = 0
  for (const b of header) sum += b
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')
  const padLen = (512 - (data.length % 512)) % 512
  return Buffer.concat([header, data, Buffer.alloc(padLen)])
}

/** Build a gzipped tarball (as `npm pack` would) from a `path -> content` map. */
function buildTarGz(files: Record<string, string>): Uint8Array {
  const entries = Object.entries(files).map(([name, content]) => tarEntry(name, content))
  const archive = Buffer.concat([...entries, Buffer.alloc(1024)]) // two zero end blocks
  return new Uint8Array(gzipSync(archive))
}

describe('npmBundleFetcher', () => {
  let cacheDir = ''
  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'npm-deps-'))
    httpGetText.mockReset()
    httpGetBytes.mockReset()
  })
  afterEach(() => { rmSync(cacheDir, { recursive: true, force: true }) })

  it('fetches, extracts and bundles a minimal pure-JS package, caching bundle.js + the raw tarball', async () => {
    const spec: PackageSpec = { name: 'tiny-pkg', version: '1.0.0' }
    const tgz = buildTarGz({
      'package/package.json': JSON.stringify({ name: 'tiny-pkg', version: '1.0.0', main: 'index.js' }),
      'package/index.js': 'module.exports = function add1(x) { return x + 1 }'
    })
    httpGetText.mockResolvedValue(JSON.stringify({ main: 'index.js', dist: { tarball: 'https://registry.npmjs.org/tiny-pkg/-/tiny-pkg-1.0.0.tgz' } }))
    httpGetBytes.mockResolvedValue(tgz)

    const artifacts = await npmBundleFetcher(spec, cacheDir)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].filename).toBe('bundle.js')
    const bundleText = Buffer.from(artifacts[0].data).toString('utf8')
    expect(bundleText).toContain('__pkgExports')

    // The raw tarball is persisted separately, under a `tarball/` sub-dir.
    const tarballPath = join(packageSubDir(cacheDir, spec, 'tarball'), 'tiny-pkg-1.0.0.tgz')
    expect(existsSync(tarballPath)).toBe(true)

    // The bundle actually runs and behaves like the source module.
    const sandbox: { __pkgExports?: unknown } = {}
    runInNewContext(bundleText, sandbox)
    expect((sandbox.__pkgExports as (x: number) => number)(41)).toBe(42)
  })

  it('rejects with a clear message naming an unresolvable Node built-in', async () => {
    const spec: PackageSpec = { name: 'needs-fs', version: '1.0.0' }
    const tgz = buildTarGz({
      'package/package.json': JSON.stringify({ name: 'needs-fs', version: '1.0.0', main: 'index.js' }),
      'package/index.js': "var fs = require('fs'); module.exports = fs"
    })
    httpGetText.mockResolvedValue(JSON.stringify({ dist: { tarball: 'https://registry.npmjs.org/needs-fs/-/needs-fs-1.0.0.tgz' } }))
    httpGetBytes.mockResolvedValue(tgz)

    await expect(npmBundleFetcher(spec, cacheDir)).rejects.toThrow(/needs-fs.*could not be bundled|"fs"/)
  })

  it('resolves a relative require between two files in the package', async () => {
    const spec: PackageSpec = { name: 'multi-file', version: '2.0.0' }
    const tgz = buildTarGz({
      'package/package.json': JSON.stringify({ name: 'multi-file', version: '2.0.0', main: 'index.js' }),
      'package/index.js': "module.exports = require('./helper')",
      'package/helper.js': 'module.exports = 7'
    })
    httpGetText.mockResolvedValue(JSON.stringify({ dist: { tarball: 'https://registry.npmjs.org/multi-file/-/multi-file-2.0.0.tgz' } }))
    httpGetBytes.mockResolvedValue(tgz)

    const artifacts = await npmBundleFetcher(spec, cacheDir)
    const sandbox: { __pkgExports?: unknown } = {}
    runInNewContext(Buffer.from(artifacts[0].data).toString('utf8'), sandbox)
    expect(sandbox.__pkgExports).toBe(7)
  })

  it('throws a clear error when the registry has no downloadable tarball', async () => {
    httpGetText.mockResolvedValue(JSON.stringify({}))
    await expect(npmBundleFetcher({ name: 'no-tarball', version: '1.0.0' }, cacheDir)).rejects.toThrow(/no downloadable tarball/)
  })

  it('sanitises a `../`-escaping entry instead of writing outside the scratch dir (node-tar, not a hand-rolled reader)', async () => {
    const spec: PackageSpec = { name: 'malicious-pkg', version: '1.0.0' }
    // A real npm tarball's paths flow straight from the registry — untrusted.
    // Alongside the legit package files, plant an entry that escapes the
    // extraction root one level up (where `extractTarball`'s `mkdtempSync`
    // scratch dir lives, i.e. straight into the OS tmp dir).
    const marker = `restorm-traversal-poc-${Date.now()}.txt`
    const tgz = buildTarGz({
      'package/package.json': JSON.stringify({ name: 'malicious-pkg', version: '1.0.0', main: 'index.js' }),
      'package/index.js': 'module.exports = 1',
      [`../${marker}`]: 'pwned'
    })
    httpGetText.mockResolvedValue(JSON.stringify({ dist: { tarball: 'https://registry.npmjs.org/malicious-pkg/-/malicious-pkg-1.0.0.tgz' } }))
    httpGetBytes.mockResolvedValue(tgz)

    // node-tar drops the escaping entry rather than throwing — extraction (and
    // bundling of the legit files) still succeeds.
    const artifacts = await npmBundleFetcher(spec, cacheDir)
    expect(artifacts).toHaveLength(1)

    // The escaping entry never landed outside the (already-cleaned-up) scratch
    // dir — a hand-rolled ustar reader honouring the raw path would have
    // written it straight into the OS tmp dir.
    expect(existsSync(join(tmpdir(), marker))).toBe(false)
  })
})

describe('buildUserPackagesPrelude', () => {
  let cacheDir = ''
  beforeEach(() => { cacheDir = mkdtempSync(join(tmpdir(), 'npm-prelude-')) })
  afterEach(() => { rmSync(cacheDir, { recursive: true, force: true }) })

  const writeBundle = (spec: PackageSpec, exportsSrc: string): void => {
    writeFileSync(join(packageDir(cacheDir, spec), 'bundle.js'), `var __pkgExports = ${exportsSrc};`, { flag: 'w' })
  }
  const ensureDir = (spec: PackageSpec): void => {
    mkdirSync(packageDir(cacheDir, spec), { recursive: true })
  }

  it('exposes a package via require() and as a snake-cased global', () => {
    const spec: PackageSpec = { name: 'just-snake-case', version: '1.0.0' }
    ensureDir(spec)
    writeBundle(spec, '42')
    const sandbox: Record<string, unknown> = {}
    runInNewContext(buildUserPackagesPrelude(cacheDir, [spec]), sandbox)
    expect(sandbox['require']).toBeTypeOf('function')
    expect((sandbox['require'] as (n: string) => unknown)('just-snake-case')).toBe(42)
    expect(sandbox['just_snake_case']).toBe(42)
  })

  it('never clobbers a global already defined by the curated stdlib prelude, but require() still yields the user package', () => {
    const spec: PackageSpec = { name: 'lodash', version: '9.9.9' }
    ensureDir(spec)
    writeBundle(spec, "'USER_LODASH'")
    const sandbox: Record<string, unknown> = { lodash: 'CURATED_LODASH', require: (n: string) => { throw new Error(`curated require: unknown module "${n}"`) } }
    runInNewContext(buildUserPackagesPrelude(cacheDir, [spec]), sandbox)
    expect(sandbox['lodash']).toBe('CURATED_LODASH')
    expect((sandbox['require'] as (n: string) => unknown)('lodash')).toBe('USER_LODASH')
  })

  it('falls back to the original require() for a name it does not own', () => {
    const spec: PackageSpec = { name: 'pkg-a', version: '1.0.0' }
    ensureDir(spec)
    writeBundle(spec, '1')
    const sandbox: Record<string, unknown> = { require: (n: string) => { throw new Error(`curated: ${n}`) } }
    runInNewContext(buildUserPackagesPrelude(cacheDir, [spec]), sandbox)
    expect(() => (sandbox['require'] as (n: string) => unknown)('unrelated')).toThrow(/curated: unrelated/)
  })

  it('throws a clear error when a spec has no cached bundle', () => {
    expect(() => buildUserPackagesPrelude(cacheDir, [{ name: 'missing', version: '1.0.0' }])).toThrow(/no cached bundle/)
  })
})

describe('mountPackagesIntoContext', () => {
  let cacheDir = ''
  beforeEach(() => { cacheDir = mkdtempSync(join(tmpdir(), 'npm-mount-')) })
  afterEach(() => { rmSync(cacheDir, { recursive: true, force: true }) })

  it('is a no-op against an empty cache (no bundle.js anywhere)', async () => {
    const evalCode = vi.fn()
    await mountPackagesIntoContext({ evalCode }, cacheDir)
    expect(evalCode).not.toHaveBeenCalled()
  })

  it('evals the combined prelude for every cached package into the given engine', async () => {
    const spec: PackageSpec = { name: 'pkg-one', version: '1.0.0' }
    mkdirSync(packageDir(cacheDir, spec), { recursive: true })
    writeFileSync(join(packageDir(cacheDir, spec), 'bundle.js'), 'var __pkgExports = 5;')
    const dispose = vi.fn()
    const evalCode = vi.fn(() => ({ value: { dispose } }))
    await mountPackagesIntoContext({ evalCode }, cacheDir)
    expect(evalCode).toHaveBeenCalledTimes(1)
    expect(evalCode.mock.calls[0][0]).toContain('pkg-one')
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})

describe('readCachedBundle', () => {
  let cacheDir = ''
  beforeEach(() => { cacheDir = mkdtempSync(join(tmpdir(), 'npm-read-')) })
  afterEach(() => { rmSync(cacheDir, { recursive: true, force: true }) })

  it('returns undefined when nothing is cached', () => {
    expect(readCachedBundle(cacheDir, { name: 'nope', version: '1.0.0' })).toBeUndefined()
  })
})
