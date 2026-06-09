import { describe, it, expect } from 'vitest'
import { rubyRuntime } from './rubyRuntime'

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
