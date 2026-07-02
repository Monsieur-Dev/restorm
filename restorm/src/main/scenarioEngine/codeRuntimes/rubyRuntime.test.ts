import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { rubyRuntime } from './rubyRuntime'
import { isClosureReady } from './rubyGemSource'
import type { PackageSpec } from './types'

vi.mock('electron', () => ({ app: { getPath: (): string => tmpdir() } }))

const httpGetBytes = vi.fn<typeof import('./depsInstaller').httpGetBytes>()
vi.mock('./depsInstaller', async () => {
  const actual = await vi.importActual<typeof import('./depsInstaller')>('./depsInstaller')
  return { ...actual, httpGetBytes: (url: string) => httpGetBytes(url) }
})

describe('rubyRuntime (ruby.wasm worker)', () => {
  it('runs ruby, injects `$input`/`$vars`, captures puts, returns the last expression', async () => {
    const { result, logs } = await rubyRuntime.run(
      'puts "hi from ruby #{$vars["name"]}"\n$input["a"] + $input["b"]',
      { input: { a: 2, b: 5 }, variables: { name: 'Yo' }, timeoutMs: 40_000 }
    )
    expect(result).toBe(7)
    expect(logs).toEqual(['hi from ruby Yo'])
  }, 90_000)

  it('rejects on a ruby error', async () => {
    await expect(
      rubyRuntime.run('raise "boom"', { input: null, variables: {}, timeoutMs: 40_000 })
    ).rejects.toThrow(/boom/i)
  }, 90_000)

  it('kills a runaway loop on timeout (does NOT hang)', async () => {
    const t0 = Date.now()
    await expect(
      rubyRuntime.run('loop { }', { input: null, variables: {}, timeoutMs: 2_000 })
    ).rejects.toThrow(/timed out/i)
    expect(Date.now() - t0).toBeLessThan(30_000)
  }, 90_000)
})

// --- Real end-to-end proof that a pinned gem actually `require`s inside
// ruby.wasm: a synthetic pure-Ruby gem served from the offline mirror
// (RESTORM_CODE_DEPS_OFFLINE_DIR — zero live RubyGems, deterministic), through
// the SAME installPackages -> run(packages, packagesCacheDir) path the
// executor drives. A minimal, real POSIX/ustar tar writer builds the `.gem`
// bytes so the production tar reader is exercised end to end. ---
function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0, 'utf8')
  header.write('0000644', 100, 'utf8')
  header.write(size.toString(8).padStart(11, '0'), 124, 'utf8')
  header.write('00000000000', 136, 'utf8')
  header.write('        ', 148, 'utf8') // checksum field, spaces while summing (ustar spec)
  header[156] = 0x30 // typeflag '0' — regular file
  header.write('ustar', 257, 'utf8')
  // node-tar (the production reader) validates the header checksum, unlike a
  // hand-rolled reader — must be a real one, not the placeholder spaces above.
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
function buildGemBuffer(gemspecYaml: string, files: { name: string; content: string }[]): Buffer {
  const dataTarGz = gzipSync(buildTar(files.map((f) => ({ name: f.name, data: Buffer.from(f.content, 'utf8') }))))
  const metadataGz = gzipSync(Buffer.from(gemspecYaml, 'utf8'))
  return buildTar([{ name: 'metadata.gz', data: metadataGz }, { name: 'data.tar.gz', data: dataTarGz }])
}
function gemspecYaml(name: string, version: string, extensions: string[] = []): string {
  return [
    '--- !ruby/object:Gem::Specification',
    `name: ${name}`,
    'version: !ruby/object:Gem::Version',
    `  version: ${version}`,
    'dependencies: []',
    'require_paths:',
    '- lib',
    extensions.length === 0 ? 'extensions: []' : `extensions:\n- ${extensions.join('\n- ')}`
  ].join('\n')
}

describe('rubyRuntime external dependencies (offline mirror)', () => {
  let cacheTemp = ''
  let mirror = ''

  beforeEach(() => {
    // `cacheDir` is passed explicitly to installPackages/run below (as the
    // executor does), so an isolated temp dir per test is enough — nothing
    // here depends on the mocked `app.getPath('temp')`.
    cacheTemp = mkdtempSync(join(tmpdir(), 'ruby-deps-runtime-'))
    mirror = mkdtempSync(join(tmpdir(), 'ruby-deps-mirror-'))
    process.env['RESTORM_CODE_DEPS_OFFLINE_DIR'] = mirror
  })
  afterEach(() => {
    delete process.env['RESTORM_CODE_DEPS_OFFLINE_DIR']
    rmSync(cacheTemp, { recursive: true, force: true })
    rmSync(mirror, { recursive: true, force: true })
    httpGetBytes.mockReset()
  })

  function seedMirror(spec: PackageSpec, gem: Buffer): void {
    const dir = join(mirror, 'ruby', `${spec.name}@${spec.version}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${spec.name}-${spec.version}.gem`), gem)
  }

  it('installs a pure-Ruby gem from the offline mirror and `require`s it in ruby.wasm', async () => {
    const spec: PackageSpec = { name: 'restormrbdep', version: '1.0.0' }
    seedMirror(spec, buildGemBuffer(gemspecYaml(spec.name, spec.version), [
      { name: 'lib/restormrbdep.rb', content: 'module Restormrbdep\n  VALUE = "1.0.0"\nend' }
    ]))

    const cacheDir = join(cacheTemp, 'restorm-code-deps', 'ruby')
    await rubyRuntime.installPackages?.([spec], cacheDir)
    expect(isClosureReady(cacheDir, spec)).toBe(true)

    const { result } = await rubyRuntime.run('require "restormrbdep"; Restormrbdep::VALUE', {
      input: null,
      variables: {},
      timeoutMs: 40_000,
      packages: [spec],
      packagesCacheDir: cacheDir
    })
    expect(result).toBe('1.0.0')
  }, 90_000)

  it('mountPackages evals $LOAD_PATH.unshift for every cached + extracted gem', async () => {
    const spec: PackageSpec = { name: 'restormrbdep', version: '1.0.0' }
    seedMirror(spec, buildGemBuffer(gemspecYaml(spec.name, spec.version), [
      { name: 'lib/restormrbdep.rb', content: 'module Restormrbdep; end' }
    ]))
    const cacheDir = join(cacheTemp, 'restorm-code-deps', 'ruby')
    await rubyRuntime.installPackages?.([spec], cacheDir)

    const evalSpy = vi.fn()
    await rubyRuntime.mountPackages?.({ eval: evalSpy }, cacheDir)
    expect(evalSpy).toHaveBeenCalledWith('$LOAD_PATH.unshift("/gems/restormrbdep@1.0.0/lib")')
  }, 90_000)

  it('a second install of the same gem needs no network (offline mirror removed, still succeeds)', async () => {
    const spec: PackageSpec = { name: 'restormrbdep', version: '1.0.0' }
    seedMirror(spec, buildGemBuffer(gemspecYaml(spec.name, spec.version), [
      { name: 'lib/restormrbdep.rb', content: 'module Restormrbdep; end' }
    ]))
    const cacheDir = join(cacheTemp, 'restorm-code-deps', 'ruby')
    await rubyRuntime.installPackages?.([spec], cacheDir)

    // Remove the mirror entirely — a re-install must still succeed purely from
    // the closure-manifest fast path (isClosureReady), proving zero network.
    rmSync(mirror, { recursive: true, force: true })
    await expect(rubyRuntime.installPackages?.([spec], cacheDir)).resolves.toBeUndefined()
  }, 90_000)

  it('rejects a gem with native C extensions on `installPackages` (error-port bound)', async () => {
    // No offline-mirror entry for this spec — installPackages falls through to
    // the real (mocked) network fetcher, where the extensions check lives.
    const spec: PackageSpec = { name: 'nativerbgem', version: '1.0.0' }
    httpGetBytes.mockResolvedValue(new Uint8Array(buildGemBuffer(gemspecYaml(spec.name, spec.version, ['ext/extconf.rb']), [])))
    const cacheDir = join(cacheTemp, 'restorm-code-deps', 'ruby')
    await expect(rubyRuntime.installPackages?.([spec], cacheDir)).rejects.toThrow(/native C extensions/i)
    expect(isClosureReady(cacheDir, spec)).toBe(false)
  }, 90_000)
})
