import { describe, it, expect } from 'vitest'
import { luaRuntime } from './luaRuntime'

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
