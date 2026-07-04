import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeArtifact } from './depsCache'
import type { PackageSpec } from './types'

vi.mock('electron', () => ({ app: { getPath: (): string => tmpdir() } }))

const httpGetBytes = vi.fn<typeof import('./depsInstaller').httpGetBytes>()
const httpGetText = vi.fn<typeof import('./depsInstaller').httpGetText>()
vi.mock('./depsInstaller', async () => {
  const actual = await vi.importActual<typeof import('./depsInstaller')>('./depsInstaller')
  return { ...actual, httpGetBytes: (url: string) => httpGetBytes(url), httpGetText: (url: string) => httpGetText(url) }
})

import {
  compareRubyVersions,
  ensureExtracted,
  isClosureReady,
  parseGemspecYaml,
  readClosureGems,
  resolveSatisfyingVersion,
  resolveTransitiveSpecs,
  rubyGemFetcher,
  satisfiesRequirement,
  writeClosureManifest
} from './rubyGemSource'

// --- A minimal, real POSIX/ustar tar writer, just enough to build a synthetic
// `.gem` archive (a plain tar of `metadata.gz` + `data.tar.gz`) so the
// production tar READER (node-tar) is exercised against real tar bytes, not a
// fixture. node-tar validates the header checksum, so it must be a real one —
// not the placeholder spaces a hand-rolled reader would have tolerated. ---
function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0, 'utf8')
  header.write('0000644', 100, 'utf8') // mode
  header.write((size.toString(8)).padStart(11, '0'), 124, 'utf8') // size, octal
  header.write('00000000000', 136, 'utf8') // mtime
  header.write('        ', 148, 'utf8') // checksum field, spaces while summing (ustar spec)
  header[156] = 0x30 // typeflag '0' — regular file
  header.write('ustar', 257, 'utf8')
  const sum = header.reduce((acc, byte) => acc + byte, 0)
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'utf8')
  return header
}
function tarEntry(name: string, data: Buffer): Buffer {
  const header = tarHeader(name, data.length)
  const padLen = (512 - (data.length % 512)) % 512
  return Buffer.concat([header, data, Buffer.alloc(padLen)])
}
function buildTar(entries: { name: string; data: Buffer }[]): Buffer {
  return Buffer.concat([...entries.map((e) => tarEntry(e.name, e.data)), Buffer.alloc(1024)])
}

/** Build a synthetic `.gem` archive: outer tar of `metadata.gz` (gzipped
 * gemspec YAML) + `data.tar.gz` (gzipped tar of the gem's files). */
function buildGemBuffer(gemspecYaml: string, files: { name: string; content: string }[]): Buffer {
  const dataTar = buildTar(files.map((f) => ({ name: f.name, data: Buffer.from(f.content, 'utf8') })))
  const dataTarGz = gzipSync(dataTar)
  const metadataGz = gzipSync(Buffer.from(gemspecYaml, 'utf8'))
  return buildTar([
    { name: 'metadata.gz', data: metadataGz },
    { name: 'data.tar.gz', data: dataTarGz }
  ])
}

function pureGemspecYaml(name: string, version: string, deps: string[] = []): string {
  const depsYaml = deps.length === 0
    ? 'dependencies: []'
    : ['dependencies:', ...deps.map((d) => [
        '- !ruby/object:Gem::Dependency',
        `  name: ${d}`,
        '  requirement: !ruby/object:Gem::Requirement',
        '    requirements:',
        '    - - ">="',
        '      - !ruby/object:Gem::Version',
        '          version: \'0\'',
        '  type: :runtime'
      ].join('\n'))].join('\n')
  return [
    '--- !ruby/object:Gem::Specification',
    `name: ${name}`,
    'version: !ruby/object:Gem::Version',
    `  version: ${version}`,
    depsYaml,
    'require_paths:',
    '- lib',
    'extensions: []'
  ].join('\n')
}

function nativeGemspecYaml(name: string, version: string): string {
  return [
    '--- !ruby/object:Gem::Specification',
    `name: ${name}`,
    'version: !ruby/object:Gem::Version',
    `  version: ${version}`,
    'dependencies: []',
    'require_paths:',
    '- lib',
    '- ext',
    'extensions:',
    '- ext/extconf.rb'
  ].join('\n')
}

describe('parseGemspecYaml', () => {
  it('extracts name/version/require_paths from the Ruby-tagged YAML', () => {
    const spec = parseGemspecYaml(pureGemspecYaml('foo', '1.2.3'))
    expect(spec).toMatchObject({ name: 'foo', version: '1.2.3', requirePaths: ['lib'], extensions: [], runtimeDependencies: [] })
  })

  it('defaults require_paths to ["lib"] when the gemspec omits it', () => {
    const yaml = '--- !ruby/object:Gem::Specification\nname: bare\nversion: !ruby/object:Gem::Version\n  version: 1.0.0\ndependencies: []\nextensions: []'
    expect(parseGemspecYaml(yaml).requirePaths).toEqual(['lib'])
  })

  it('keeps only unconditional (type: :runtime) dependencies', () => {
    const yaml = [
      '--- !ruby/object:Gem::Specification',
      'name: has-deps',
      'version: !ruby/object:Gem::Version',
      '  version: 2.0.0',
      'dependencies:',
      '- !ruby/object:Gem::Dependency',
      '  name: runtime-dep',
      '  requirement: !ruby/object:Gem::Requirement',
      '    requirements:',
      '    - - "~>"',
      '      - !ruby/object:Gem::Version',
      '          version: \'1.0\'',
      '  type: :runtime',
      '- !ruby/object:Gem::Dependency',
      '  name: dev-only',
      '  requirement: !ruby/object:Gem::Requirement',
      '    requirements: []',
      '  type: :development',
      'require_paths:',
      '- lib',
      'extensions: []'
    ].join('\n')
    const spec = parseGemspecYaml(yaml)
    expect(spec.runtimeDependencies).toEqual([{ name: 'runtime-dep', requirements: [{ op: '~>', version: '1.0' }] }])
  })

  it('reads a non-empty extensions list (native gem)', () => {
    expect(parseGemspecYaml(nativeGemspecYaml('nativegem', '1.0.0')).extensions).toEqual(['ext/extconf.rb'])
  })
})

describe('compareRubyVersions / satisfiesRequirement', () => {
  it('compares numeric segments, not lexically', () => {
    expect(compareRubyVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareRubyVersions('1.2.0', '1.2.0')).toBe(0)
    expect(compareRubyVersions('1.2', '1.2.0')).toBe(0)
  })

  it('supports >=, <, and exact-match operators', () => {
    expect(satisfiesRequirement('2.0.0', [{ op: '>=', version: '1.0.0' }])).toBe(true)
    expect(satisfiesRequirement('0.9.0', [{ op: '>=', version: '1.0.0' }])).toBe(false)
    expect(satisfiesRequirement('1.0.0', [{ op: '=', version: '1.0.0' }])).toBe(true)
  })

  it('supports the pessimistic ~> constraint', () => {
    // ~> 1.2.3 => >= 1.2.3, < 1.3.0
    expect(satisfiesRequirement('1.2.5', [{ op: '~>', version: '1.2.3' }])).toBe(true)
    expect(satisfiesRequirement('1.3.0', [{ op: '~>', version: '1.2.3' }])).toBe(false)
    expect(satisfiesRequirement('1.2.2', [{ op: '~>', version: '1.2.3' }])).toBe(false)
    // ~> 1.2 => >= 1.2, < 2.0
    expect(satisfiesRequirement('1.9.9', [{ op: '~>', version: '1.2' }])).toBe(true)
    expect(satisfiesRequirement('2.0.0', [{ op: '~>', version: '1.2' }])).toBe(false)
  })

  it('ANDs multiple clauses', () => {
    const reqs = [{ op: '>=', version: '1.0' }, { op: '<', version: '2.0' }]
    expect(satisfiesRequirement('1.5.0', reqs)).toBe(true)
    expect(satisfiesRequirement('2.0.0', reqs)).toBe(false)
  })
})

describe('rubyGemFetcher', () => {
  afterEach(() => { httpGetBytes.mockReset() })

  // Native-extension rejection is NOT the fetcher's job here — it needs
  // `tar.x` on a real cached file, so it's asserted against `ensureExtracted`
  // instead (see the 'closure manifest + extraction' describe block below).

  it('downloads the gem and caches it, given a pure-Ruby gemspec', async () => {
    const spec: PackageSpec = { name: 'foo', version: '1.0.0' }
    httpGetBytes.mockResolvedValue(new Uint8Array(buildGemBuffer(pureGemspecYaml('foo', '1.0.0'), [{ name: 'lib/foo.rb', content: 'module Foo; end' }])))
    const artifacts = await rubyGemFetcher(spec)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].filename).toBe('foo-1.0.0.gem')
  })

  it('rejects with a clear message when the gem cannot be downloaded', async () => {
    httpGetBytes.mockRejectedValue(new Error('404'))
    await expect(rubyGemFetcher({ name: 'missing', version: '9.9.9' })).rejects.toThrow(/could not be found on RubyGems/i)
  })
})

describe('resolveSatisfyingVersion', () => {
  afterEach(() => { httpGetText.mockReset() })

  it('picks the newest non-prerelease ruby-platform release satisfying the requirement', async () => {
    httpGetText.mockResolvedValue(JSON.stringify([
      { number: '2.0.0', platform: 'java', prerelease: false },
      { number: '1.9.0', platform: 'ruby', prerelease: false },
      { number: '1.10.0', platform: 'ruby', prerelease: false },
      { number: '2.0.0.pre', platform: 'ruby', prerelease: true }
    ]))
    const resolved = await resolveSatisfyingVersion('somedep', [{ op: '>=', version: '1.0' }])
    expect(resolved).toEqual({ name: 'somedep', version: '1.10.0' })
  })

  it('returns undefined when nothing satisfies (caller skips the dependency)', async () => {
    httpGetText.mockResolvedValue(JSON.stringify([{ number: '1.0.0', platform: 'ruby', prerelease: false }]))
    expect(await resolveSatisfyingVersion('somedep', [{ op: '>=', version: '5.0' }])).toBeUndefined()
  })

  it('returns undefined on a registry lookup failure (name not found)', async () => {
    httpGetText.mockRejectedValue(new Error('404'))
    expect(await resolveSatisfyingVersion('unknown-dep', [])).toBeUndefined()
  })
})

describe('closure manifest + extraction, on disk', () => {
  let cacheDir = ''
  beforeEach(() => { cacheDir = mkdtempSync(join(tmpdir(), 'ruby-deps-')) })
  afterEach(() => { rmSync(cacheDir, { recursive: true, force: true }) })

  it('extracts only .rb files under require_paths, skipping everything else, and is idempotent', () => {
    const spec: PackageSpec = { name: 'foo', version: '1.0.0' }
    const gem = buildGemBuffer(pureGemspecYaml('foo', '1.0.0'), [
      { name: 'lib/foo.rb', content: 'module Foo\n  VALUE = 42\nend' },
      { name: 'lib/foo/nested.rb', content: 'module Foo; module Nested; end; end' },
      { name: 'README.md', content: '# foo' },
      { name: 'test/foo_test.rb', content: '# not under require_paths, skip' }
    ])
    writeArtifact(cacheDir, spec, 'foo-1.0.0.gem', new Uint8Array(gem))

    const gemspec = ensureExtracted(cacheDir, spec)
    expect(gemspec.requirePaths).toEqual(['lib'])
    const libDir = join(cacheDir, 'foo@1.0.0', 'lib')
    expect(existsSync(join(libDir, 'foo.rb'))).toBe(true)
    expect(existsSync(join(libDir, 'foo', 'nested.rb'))).toBe(true)
    expect(existsSync(join(cacheDir, 'foo@1.0.0', 'README.md'))).toBe(false)
    expect(existsSync(join(cacheDir, 'foo@1.0.0', 'test'))).toBe(false)

    // Idempotent: a second call doesn't throw and content is unchanged.
    ensureExtracted(cacheDir, spec)
    expect(readFileSync(join(libDir, 'foo.rb'), 'utf8')).toContain('VALUE = 42')
  })

  it('rejects a gem that declares native C extensions before extracting any source', () => {
    const spec: PackageSpec = { name: 'nativegem', version: '1.0.0' }
    const gem = buildGemBuffer(nativeGemspecYaml('nativegem', '1.0.0'), [{ name: 'lib/nativegem.rb', content: '' }])
    writeArtifact(cacheDir, spec, 'nativegem-1.0.0.gem', new Uint8Array(gem))
    expect(() => ensureExtracted(cacheDir, spec)).toThrow(/native C extensions/i)
    // The cached .gem itself is written by writeArtifact (before extraction
    // even runs) so its package dir exists — but no source must be extracted.
    expect(existsSync(join(cacheDir, 'nativegem@1.0.0', 'lib'))).toBe(false)
  })

  it('isClosureReady is false with no manifest, true once every member is cached + extracted', () => {
    const root: PackageSpec = { name: 'foo', version: '1.0.0' }
    expect(isClosureReady(cacheDir, root)).toBe(false)

    const gem = buildGemBuffer(pureGemspecYaml('foo', '1.0.0'), [{ name: 'lib/foo.rb', content: 'module Foo; end' }])
    writeArtifact(cacheDir, root, 'foo-1.0.0.gem', new Uint8Array(gem))
    ensureExtracted(cacheDir, root)
    writeClosureManifest(cacheDir, root, [{ key: 'foo@1.0.0', requirePaths: ['lib'] }])
    expect(isClosureReady(cacheDir, root)).toBe(true)
  })

  it('readClosureGems reads back the recorded closure, falling back to the spec itself with no manifest', () => {
    const root: PackageSpec = { name: 'foo', version: '1.0.0' }
    const gem = buildGemBuffer(pureGemspecYaml('foo', '1.0.0'), [{ name: 'lib/foo.rb', content: 'module Foo; end' }])
    writeArtifact(cacheDir, root, 'foo-1.0.0.gem', new Uint8Array(gem))
    ensureExtracted(cacheDir, root)

    // No manifest yet — falls back to the spec's own require_paths.
    expect(readClosureGems(cacheDir, root)).toEqual([{ name: 'foo', version: '1.0.0', requirePaths: ['lib'] }])

    writeClosureManifest(cacheDir, root, [
      { key: 'foo@1.0.0', requirePaths: ['lib'] },
      { key: 'bar@2.0.0', requirePaths: ['lib', 'lib/bar-compat'] }
    ])
    expect(readClosureGems(cacheDir, root)).toEqual([
      { name: 'foo', version: '1.0.0', requirePaths: ['lib'] },
      { name: 'bar', version: '2.0.0', requirePaths: ['lib', 'lib/bar-compat'] }
    ])
  })

  it('resolveTransitiveSpecs discovers a cached gem\'s runtime dependency and is cycle-safe via `seen`', async () => {
    const root: PackageSpec = { name: 'foo', version: '1.0.0' }
    const gem = buildGemBuffer(pureGemspecYaml('foo', '1.0.0', ['bar']), [{ name: 'lib/foo.rb', content: 'module Foo; end' }])
    writeArtifact(cacheDir, root, 'foo-1.0.0.gem', new Uint8Array(gem))
    httpGetText.mockResolvedValue(JSON.stringify([{ number: '2.0.0', platform: 'ruby', prerelease: false }]))

    const seen = new Set<string>(['foo@1.0.0'])
    const discovered = await resolveTransitiveSpecs(cacheDir, [root], seen)
    expect(discovered).toEqual([{ name: 'bar', version: '2.0.0' }])
    expect(seen.has('bar@2.0.0')).toBe(true)

    // A second pass with the same frontier must not rediscover `bar` — it's
    // already in `seen` (this is what makes a dependency cycle terminate).
    httpGetText.mockClear()
    const second = await resolveTransitiveSpecs(cacheDir, [root], seen)
    expect(second).toEqual([])
  })
})
