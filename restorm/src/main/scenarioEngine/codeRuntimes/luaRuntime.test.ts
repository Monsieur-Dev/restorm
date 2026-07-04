import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { luaRuntime } from './luaRuntime'
import { writeArtifact } from './depsCache'

describe('luaRuntime (wasmoon worker)', () => {
  it('runs lua, injects `input`/`vars`, captures print, returns the chunk value', async () => {
    const { result, logs } = await luaRuntime.run(
      'print("hi from lua", vars.name)\nreturn input.a + input.b',
      { input: { a: 2, b: 5 }, variables: { name: 'Yo' }, timeoutMs: 20_000 }
    )
    expect(result).toBe(7)
    expect(logs).toEqual(['hi from lua\tYo'])
  }, 40_000)

  it('returns table results with deterministically sorted keys', async () => {
    // Lua hash-table iteration order is per-VM, so without normalisation the
    // same script flakes between { v, n } and { n, v }. Keys must come back sorted.
    const { result } = await luaRuntime.run(
      'return { v = 3, n = "a", nested = { z = 1, a = 2 } }',
      { input: null, variables: {}, timeoutMs: 20_000 }
    )
    expect(Object.keys(result as Record<string, unknown>)).toEqual(['n', 'nested', 'v'])
    expect(Object.keys((result as { nested: Record<string, unknown> }).nested)).toEqual(['a', 'z'])
  }, 40_000)

  it('keeps array (sequence) order intact', async () => {
    const { result } = await luaRuntime.run('return { 3, 1, 2 }', {
      input: null,
      variables: {},
      timeoutMs: 20_000
    })
    expect(result).toEqual([3, 1, 2])
  }, 40_000)

  it('rejects on a lua error', async () => {
    await expect(
      luaRuntime.run('error("boom")', { input: null, variables: {}, timeoutMs: 20_000 })
    ).rejects.toThrow(/boom/i)
  }, 40_000)

  it('kills a runaway loop on timeout (does NOT hang)', async () => {
    const t0 = Date.now()
    await expect(
      luaRuntime.run('while true do end', { input: null, variables: {}, timeoutMs: 2_000 })
    ).rejects.toThrow(/timed out/i)
    expect(Date.now() - t0).toBeLessThan(20_000)
  }, 40_000)
})

describe('luaRuntime — external dependencies (package.preload mount)', () => {
  it('mounts a cached module before running (real worker path) — require() returns it', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'lua-deps-run-'))
    try {
      const spec = { name: 'restormluatest', version: '1.0.0' }
      writeArtifact(cacheDir, spec, 'restormluatest.lua', Buffer.from(
        'return { greet = function(n) return "hi " .. n end }', 'utf8'
      ))
      const { result, logs } = await luaRuntime.run(
        'local m = require("restormluatest")\nprint(m.greet("world"))\nreturn m.greet("world")',
        { input: null, variables: {}, timeoutMs: 20_000, packages: [spec], packagesCacheDir: cacheDir }
      )
      expect(result).toBe('hi world')
      expect(logs).toEqual(['hi world'])
    } finally {
      rmSync(cacheDir, { recursive: true, force: true })
    }
  }, 40_000)

  it('a run with no packages never sees a module mounted by another run (no leakage)', async () => {
    await expect(
      luaRuntime.run('return require("restormluatest")', { input: null, variables: {}, timeoutMs: 20_000 })
    ).rejects.toThrow(/restormluatest/)
  }, 40_000)

  // mountPackages() itself isn't exercised directly here: constructing a wasmoon
  // engine on vitest's main thread (outside the worker) hits a wasmoon/vitest
  // `import.meta.url` resolution quirk unrelated to this runtime's logic — the
  // SAME limitation the Pyodide runtime's analogous main-hosted mount path has
  // (also untested directly). mountPackages() is two lines that call the exact
  // `mountLuaModules` helper the worker test above already proves end-to-end via
  // `require()`, so the mounting technique itself is covered.
})
