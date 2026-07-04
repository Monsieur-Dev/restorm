import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { c as createTar } from 'tar'
import { writeArtifact } from './depsCache'
import { allCachedSpecs, contribVersion, ensureExtracted, fetchPackagesIndex, makeRWasmFetcher, parsePackagesIndex, resolveTransitiveSpecs } from './webrInstall'

describe('contribVersion', () => {
  it('strips the patch segment from a full R version', () => {
    expect(contribVersion('4.6.0')).toBe('4.6')
    expect(contribVersion('4.4.2')).toBe('4.4')
  })
})

describe('fetchPackagesIndex — offline mirror', () => {
  afterEach(() => { delete process.env['RESTORM_CODE_DEPS_OFFLINE_DIR'] })

  it('reads the index from RESTORM_CODE_DEPS_OFFLINE_DIR/r/PACKAGES with zero network', async () => {
    const mirror = mkdtempSync(join(tmpdir(), 'r-offline-mirror-'))
    try {
      mkdirSync(join(mirror, 'r'), { recursive: true })
      writeFileSync(join(mirror, 'r', 'PACKAGES'), 'Package: jsonlite\nVersion: 2.0.0\nDepends: methods\nFile: jsonlite_2.0.0.tgz\n')
      process.env['RESTORM_CODE_DEPS_OFFLINE_DIR'] = mirror
      // A real network call to repo.r-wasm.org would hang/fail in a sandboxed
      // test env — reaching this point without one proves the offline path was taken.
      const { index } = await fetchPackagesIndex('4.6.0')
      expect(index.get('jsonlite')).toEqual({ version: '2.0.0', file: 'jsonlite_2.0.0.tgz', depends: ['methods'] })
    } finally {
      rmSync(mirror, { recursive: true, force: true })
    }
  })
})

// A realistic slice of `repo.r-wasm.org`'s PACKAGES DCF (blank-line-separated
// paragraphs, folded continuation lines, Suggests intentionally NOT read).
const SAMPLE_PACKAGES = [
  'Package: jsonlite',
  'Version: 2.0.0',
  'Depends: methods',
  'Suggests: httr, vctrs, testthat, knitr, rmarkdown, R.rsp, sf',
  'License: MIT + file LICENSE',
  'File: jsonlite_2.0.0.tgz',
  '',
  'Package: ABACUS',
  'Version: 1.0.0',
  'Depends: R (>= 3.1.0)',
  'Imports: ggplot2 (>= 3.1.0), shiny (>= 1.3.1),',
  'Suggests: rmarkdown (>= 1.13), knitr (>= 1.22)',
  'License: GPL-3',
  'File: ABACUS_1.0.0.tgz',
  '',
  'Package: ggplot2',
  'Version: 3.5.1',
  'Imports: cli, glue,',
  '        rlang (>= 1.1.0)',
  'File: ggplot2_3.5.1.tgz',
  '',
  'Package: cli',
  'Version: 3.6.2',
  'File: cli_3.6.2.tgz',
  ''
].join('\n')

describe('parsePackagesIndex', () => {
  it('parses paragraphs, folds continuation lines, and strips version constraints + the base-R "R" dep', () => {
    const index = parsePackagesIndex(SAMPLE_PACKAGES)
    expect(index.get('jsonlite')).toEqual({ version: '2.0.0', file: 'jsonlite_2.0.0.tgz', depends: ['methods'] })
    expect(index.get('ABACUS')).toEqual({ version: '1.0.0', file: 'ABACUS_1.0.0.tgz', depends: ['ggplot2', 'shiny'] })
  })

  it('joins a folded (indented continuation) Imports line into one field', () => {
    const index = parsePackagesIndex(SAMPLE_PACKAGES)
    expect(index.get('ggplot2')?.depends).toEqual(['cli', 'glue', 'rlang'])
  })

  it('ignores Suggests — only Depends/Imports feed the transitive closure', () => {
    const index = parsePackagesIndex(SAMPLE_PACKAGES)
    expect(index.get('jsonlite')?.depends).not.toContain('httr')
  })
})

describe('makeRWasmFetcher', () => {
  it('rejects with the exact error-port message for a package absent from the index', async () => {
    const index = parsePackagesIndex(SAMPLE_PACKAGES)
    const fetcher = makeRWasmFetcher(index, 'https://repo.r-wasm.org/bin/emscripten/contrib/4.6')
    await expect(fetcher({ name: 'doesnotexist', version: '1.0.0' }))
      .rejects.toThrow('R package doesnotexist is not available as a WebR WASM package')
  })

  it('rejects the same way on a version pin mismatch (repo publishes exactly one version)', async () => {
    const index = parsePackagesIndex(SAMPLE_PACKAGES)
    const fetcher = makeRWasmFetcher(index, 'https://repo.r-wasm.org/bin/emscripten/contrib/4.6')
    await expect(fetcher({ name: 'jsonlite', version: '1.0.0' }))
      .rejects.toThrow('R package jsonlite is not available as a WebR WASM package')
  })
})

describe('resolveTransitiveSpecs', () => {
  it('resolves a hard dependency to its exact indexed version', () => {
    const index = parsePackagesIndex(SAMPLE_PACKAGES)
    const seen = new Set<string>(['ABACUS@1.0.0'])
    const discovered = resolveTransitiveSpecs(index, [{ name: 'ABACUS', version: '1.0.0' }], seen)
    // `shiny` isn't in this sample index (unresolvable here) so only `ggplot2` resolves.
    expect(discovered).toEqual([{ name: 'ggplot2', version: '3.5.1' }])
  })

  it('skips a dependency absent from the index — a base-R package already available', () => {
    const index = parsePackagesIndex(SAMPLE_PACKAGES)
    const seen = new Set<string>(['jsonlite@2.0.0'])
    // jsonlite depends only on `methods`, a base-R package never published on the WASM repo.
    expect(resolveTransitiveSpecs(index, [{ name: 'jsonlite', version: '2.0.0' }], seen)).toEqual([])
  })

  it('dedups against `seen` across BFS levels', () => {
    const index = parsePackagesIndex(SAMPLE_PACKAGES)
    const seen = new Set<string>(['ggplot2@3.5.1', 'cli@3.6.2'])
    // cli is already `seen` (discovered at a previous level) — must not resurface.
    expect(resolveTransitiveSpecs(index, [{ name: 'ggplot2', version: '3.5.1' }], seen)).toEqual([])
  })
})

describe('extraction + whole-cache view', () => {
  let cacheDir = ''
  beforeEach(() => { cacheDir = mkdtempSync(join(tmpdir(), 'r-deps-')) })
  afterEach(() => { rmSync(cacheDir, { recursive: true, force: true }) })

  const cacheTgz = (spec: { name: string; version: string }): void => {
    const src = mkdtempSync(join(tmpdir(), 'r-pkg-src-'))
    const pkgDir = join(src, spec.name)
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'DESCRIPTION'), `Package: ${spec.name}\nVersion: ${spec.version}\n`)
    const tgzPath = join(src, `${spec.name}_${spec.version}.tgz`)
    createTar({ file: tgzPath, cwd: src, gzip: true, sync: true }, [spec.name])
    writeArtifact(cacheDir, spec, `${spec.name}_${spec.version}.tgz`, new Uint8Array(readFileSync(tgzPath)))
    rmSync(src, { recursive: true, force: true })
  }

  it('extracts a cached .tgz into a real DESCRIPTION-bearing package directory', () => {
    const spec = { name: 'jsonlite', version: '2.0.0' }
    cacheTgz(spec)
    const dir = ensureExtracted(cacheDir, spec)
    const desc = join(dir, 'jsonlite', 'DESCRIPTION')
    expect(existsSync(desc)).toBe(true)
  })

  it('is idempotent — a second call reuses the already-extracted directory', () => {
    const spec = { name: 'jsonlite', version: '2.0.0' }
    cacheTgz(spec)
    const first = ensureExtracted(cacheDir, spec)
    const second = ensureExtracted(cacheDir, spec)
    expect(second).toBe(first)
  })

  it('a malicious archive entry that tries to escape the extraction dir is dropped, not followed', () => {
    const spec = { name: 'evil', version: '1.0.0' }
    // Hand-craft a minimal ustar archive with a path-traversal entry name —
    // `tar.c` sanitises names it creates, so a real attack has to be built
    // by hand to prove the extractor's own containment.
    const header = Buffer.alloc(512)
    const name = '../../escaped.txt'
    header.write(name, 0, 100, 'utf8')
    header.write('0000644\0', 100, 8)
    header.write('0000000\0', 108, 8)
    header.write('0000000\0', 116, 8)
    const content = Buffer.from('pwned')
    header.write(`${content.length.toString(8).padStart(11, '0')} `, 124, 12)
    header.write('00000000000\0', 136, 12)
    header.fill(0x20, 148, 156) // checksum field blanked for computation
    header[156] = 0x30 // '0' — regular file
    header.write('ustar\0', 257, 6)
    header.write('00', 263, 2)
    let sum = 0
    for (const b of header) sum += b
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8)
    const tarBuf = Buffer.concat([header, content, Buffer.alloc(512 - (content.length % 512 || 512)), Buffer.alloc(1024)])
    const gz = gzipSync(tarBuf)
    writeArtifact(cacheDir, spec, `${spec.name}_${spec.version}.tgz`, new Uint8Array(gz))

    const dir = ensureExtracted(cacheDir, spec)
    expect(existsSync(join(dir, '..', '..', 'escaped.txt'))).toBe(false)
    expect(readdirSync(dir)).toEqual([])
  })

  it('throws a clear error when there is no cached artifact to extract', () => {
    expect(() => ensureExtracted(cacheDir, { name: 'missing', version: '1.0.0' })).toThrow(/no cached artifact/)
  })

  it('allCachedSpecs lists every cached <name>@<version> directory', () => {
    cacheTgz({ name: 'jsonlite', version: '2.0.0' })
    cacheTgz({ name: 'cli', version: '3.6.2' })
    expect(allCachedSpecs(cacheDir).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'cli', version: '3.6.2' },
      { name: 'jsonlite', version: '2.0.0' }
    ])
  })

  it('allCachedSpecs is empty for a cache dir that does not exist yet', () => {
    expect(allCachedSpecs(join(cacheDir, 'never-created'))).toEqual([])
  })
})
