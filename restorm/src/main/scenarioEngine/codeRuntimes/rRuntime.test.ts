import { describe, it, expect } from 'vitest'
import { rRuntime } from './rRuntime'

// WebR loads R-WASM once (lazily, ~1 s) then reuses the singleton.
describe('rRuntime (WebR)', () => {
  it('runs R, injects `input`/`vars`, captures cat, returns the last expression', async () => {
    const { result, logs } = await rRuntime.run(
      'cat("hi from R", vars$name, "\\n")\ninput$a + input$b',
      { input: { a: 2, b: 5 }, variables: { name: 'Yo' }, timeoutMs: 40_000 }
    )
    expect(result).toBe(7)
    expect(logs.join('')).toMatch(/hi from R Yo/)
  }, 90_000)

  it('rejects on an R error', async () => {
    await expect(
      rRuntime.run('stop("boom")', { input: null, variables: {}, timeoutMs: 40_000 })
    ).rejects.toThrow(/boom/i)
  }, 90_000)

  it('kills a runaway loop on timeout (does NOT hang)', async () => {
    const t0 = Date.now()
    await expect(
      rRuntime.run('while (TRUE) {}', { input: null, variables: {}, timeoutMs: 2_000 })
    ).rejects.toThrow(/timed out/i)
    expect(Date.now() - t0).toBeLessThan(30_000)
  }, 90_000)
})
