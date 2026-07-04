import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'
import { assertPureLua, extractFiles, parseRockspec, resolveRevision, type ParsedRockspec } from './luaSource'

describe('resolveRevision', () => {
  it('resolves the pinned version to its manifest <version>-<revision> key', () => {
    const versions = { '3.1.3-0': [{ arch: 'rockspec' }], '3.1.2-0': [{ arch: 'rockspec' }] }
    expect(resolveRevision(versions, '3.1.3')).toBe('3.1.3-0')
  })

  it('picks the highest revision when a version was republished', () => {
    const versions = { '1.0.0-1': [], '1.0.0-2': [], '1.0.0-10': [] }
    expect(resolveRevision(versions, '1.0.0')).toBe('1.0.0-10')
  })

  it('returns undefined when the pinned version has no manifest entry', () => {
    const versions = { '2.0.0-1': [] }
    expect(resolveRevision(versions, '3.0.0')).toBeUndefined()
  })
})

describe('parseRockspec', () => {
  // A real rockspec (inspect 3.1.3-0), byte-for-byte as served by luarocks.org.
  const INSPECT_ROCKSPEC = `
package = "inspect"
version = "3.1.3-0"
source = {
  url = "https://github.com/kikito/inspect.lua/archive/v3.1.3.tar.gz",
  dir = "inspect.lua-3.1.3"
}
description = {
  summary = "Lua table visualizer, ideal for debugging"
}
dependencies = {
  "lua >= 5.1"
}
build = {
  type = "builtin",
  modules = {
    inspect = "inspect.lua"
  }
}
`

  it('extracts source.url, build.type and build.modules from a real rockspec', () => {
    const spec = parseRockspec(INSPECT_ROCKSPEC, 'inspect')
    expect(spec).toEqual({
      sourceUrl: 'https://github.com/kikito/inspect.lua/archive/v3.1.3.tar.gz',
      buildType: 'builtin',
      modules: { inspect: 'inspect.lua' }
    })
  })

  it('parses a multi-module rockspec (bare dotted submodule keys)', () => {
    const raw = `
source = { url = "https://example.com/pkg.tar.gz" }
build = {
  type = "builtin",
  modules = {
    foo = "foo.lua",
    foo.bar = "src/bar.lua"
  }
}
`
    const spec = parseRockspec(raw, 'pkg')
    expect(spec.modules).toEqual({ foo: 'foo.lua', 'foo.bar': 'src/bar.lua' })
  })

  it('throws when source.url is missing', () => {
    expect(() => parseRockspec('build = { type = "builtin" }', 'broken')).toThrow(/source\.url/)
  })

  it('defaults build.type to "builtin" when the build table omits it', () => {
    const raw = `
source = { url = "https://example.com/pkg.tar.gz" }
build = { modules = { pkg = "pkg.lua" } }
`
    expect(parseRockspec(raw, 'pkg').buildType).toBe('builtin')
  })
})

describe('assertPureLua', () => {
  const pure: ParsedRockspec = { sourceUrl: 'https://example.com/a.tar.gz', buildType: 'builtin', modules: { a: 'a.lua' } }

  it('accepts a builtin, all-.lua rockspec', () => {
    expect(() => { assertPureLua('a', pure) }).not.toThrow()
  })

  it('rejects a non-source build type (compiles native code)', () => {
    const native: ParsedRockspec = { ...pure, buildType: 'make' }
    expect(() => { assertPureLua('a', native) }).toThrow(/has C dependencies, not supported in the WASM runtime/)
  })

  it('rejects a module whose declared source is not .lua (a C file)', () => {
    const cExt: ParsedRockspec = { ...pure, modules: { a: 'a.lua', b: 'lua_b.c' } }
    expect(() => { assertPureLua('a', cExt) }).toThrow(/has C dependencies, not supported in the WASM runtime/)
  })

  it('rejects a rockspec with no declared modules', () => {
    const empty: ParsedRockspec = { ...pure, modules: {} }
    expect(() => { assertPureLua('a', empty) }).toThrow(/declares no built modules/)
  })
})

describe('extractFiles', () => {
  let buildDir = ''
  afterEach(() => { if (buildDir) rmSync(buildDir, { recursive: true, force: true }) })

  /** Build a GitHub-archive-shaped `.tar.gz` (one root folder) and return its
   * bytes, mirroring what `luaModuleFetcher` downloads from `source.url`. */
  async function makeTarball(rootDir: string, files: Record<string, string>): Promise<Uint8Array> {
    buildDir = mkdtempSync(join(tmpdir(), 'lua-src-fixture-'))
    const root = join(buildDir, rootDir)
    for (const [rel, content] of Object.entries(files)) {
      const dest = join(root, rel)
      mkdirSync(join(dest, '..'), { recursive: true })
      writeFileSync(dest, content, 'utf8')
    }
    const tarGz = join(buildDir, 'out.tar.gz')
    await tar.c({ gzip: true, file: tarGz, cwd: buildDir }, [rootDir])
    return new Uint8Array(readFileSync(tarGz))
  }

  it('extracts only the wanted files, stripping the archive root folder', async () => {
    const bytes = await makeTarball('inspect.lua-3.1.3', {
      'inspect.lua': 'return { _VERSION = "3.1.3" }',
      'README.md': 'not wanted'
    })
    const out = await extractFiles(bytes, ['inspect.lua'])
    expect(out.size).toBe(1)
    expect(Buffer.from(out.get('inspect.lua') ?? new Uint8Array()).toString('utf8')).toBe('return { _VERSION = "3.1.3" }')
  })

  it('extracts a nested submodule path', async () => {
    const bytes = await makeTarball('pkg-1.0.0', {
      'foo.lua': 'return "foo"',
      'src/bar.lua': 'return "bar"'
    })
    const out = await extractFiles(bytes, ['foo.lua', 'src/bar.lua'])
    expect(Buffer.from(out.get('src/bar.lua') ?? new Uint8Array()).toString('utf8')).toBe('return "bar"')
  })

  it('omits a wanted path that is not present in the archive (no throw here — the caller reports it)', async () => {
    const bytes = await makeTarball('pkg-1.0.0', { 'foo.lua': 'return "foo"' })
    const out = await extractFiles(bytes, ['foo.lua', 'missing.lua'])
    expect(out.has('foo.lua')).toBe(true)
    expect(out.has('missing.lua')).toBe(false)
  })
})
