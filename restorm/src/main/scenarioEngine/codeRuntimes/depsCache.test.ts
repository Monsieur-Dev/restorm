import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// depsCache reads `app.getPath('temp')` at call time — stub electron.
let tempDir = ''
vi.mock('electron', () => ({ app: { getPath: (): string => tempDir } }))

import { existsSync } from 'node:fs'
import { cacheKey, cachedArtifacts, codeDepsCacheDir, codeDepsRoot, isCached, packageDir, packageSubDir, writeArtifact, writeFileAt } from './depsCache'

describe('depsCache', () => {
  let dir = ''
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deps-cache-')); tempDir = dir })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('keys a package by <name>@<version>', () => {
    expect(cacheKey({ name: 'requests', version: '2.31.0' })).toBe('requests@2.31.0')
  })

  it('roots the cache under <os-temp>/restorm-code-deps/<lang>', () => {
    expect(codeDepsRoot()).toBe(join(dir, 'restorm-code-deps'))
    expect(codeDepsCacheDir('python')).toBe(join(dir, 'restorm-code-deps', 'python'))
  })

  it('rejects path-traversal / separator segments (untrusted user + registry input)', () => {
    expect(() => cacheKey({ name: '..', version: '1.0' })).toThrow(/unsafe cache path segment/)
    expect(() => cacheKey({ name: 'a/b', version: '1.0' })).toThrow(/unsafe cache path segment/)
    expect(() => cacheKey({ name: 'a:b', version: '1.0' })).toThrow(/unsafe cache path segment/)
    expect(() => writeArtifact(dir, { name: 'ok', version: '1.0' }, '../evil', new Uint8Array())).toThrow(/unsafe/)
  })

  it('writes an artifact then reports the package cached (survives as a plain file)', () => {
    const spec = { name: 'sixish', version: '1.16.0' }
    expect(isCached(dir, spec)).toBe(false)
    const dest = writeArtifact(dir, spec, 'sixish-1.16.0-py3-none-any.whl', new Uint8Array([1, 2, 3]))
    expect(dest).toBe(join(packageDir(dir, spec), 'sixish-1.16.0-py3-none-any.whl'))
    expect(isCached(dir, spec)).toBe(true)
    expect(cachedArtifacts(dir, spec)).toEqual([dest])
  })

  it('reports an absent package as not cached without throwing', () => {
    expect(cachedArtifacts(dir, { name: 'nope', version: '9.9.9' })).toEqual([])
  })

  it('a raw artifact tucked into a packageSubDir does NOT count as a package-root cache hit', () => {
    const spec = { name: 'just-snake-case', version: '1.0.0' }
    writeFileAt(packageSubDir(dir, spec, 'tarball'), 'just-snake-case-1.0.0.tgz', new Uint8Array([1]))
    // The raw tarball is on disk, in its own sub-directory…
    expect(existsSync(join(packageSubDir(dir, spec, 'tarball'), 'just-snake-case-1.0.0.tgz'))).toBe(true)
    // …but isCached (which only scans the package ROOT) still reports false —
    // this is what lets a derived artifact (e.g. npm's bundle.js) written at the
    // package root double as the single "fully cached" signal.
    expect(isCached(dir, spec)).toBe(false)
    expect(cachedArtifacts(dir, spec)).toEqual([])
    // Once the derived artifact lands at the package root, it's a cache hit.
    writeArtifact(dir, spec, 'bundle.js', new Uint8Array([2]))
    expect(isCached(dir, spec)).toBe(true)
  })

  it('packageSubDir rejects an unsafe sub-directory name', () => {
    expect(() => packageSubDir(dir, { name: 'ok', version: '1.0' }, '..')).toThrow(/unsafe/)
  })
})
