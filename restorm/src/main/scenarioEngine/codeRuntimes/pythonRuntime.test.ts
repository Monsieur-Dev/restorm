import { describe, it, expect } from 'vitest'
import { pythonRuntime } from './pythonRuntime'

// Pyodide cold-loads CPython-WASM in a worker (~1-2 s the first time), so give
// these generous timeouts.
describe('pythonRuntime (Pyodide worker)', () => {
  it('runs python, injects `input`, captures print, returns the last expression', async () => {
    const { result, logs } = await pythonRuntime.run(
      'print("hello from python")\ninput["a"] + input["b"]',
      { input: { a: 2, b: 3 }, variables: {}, timeoutMs: 30_000 }
    )
    expect(result).toBe(5)
    expect(logs).toEqual(['hello from python'])
  }, 60_000)

  it('exposes run `vars` and returns a dict as a plain object', async () => {
    const { result } = await pythonRuntime.run(
      '{"greeting": f"hi {vars[\'name\']}", "n": len(vars)}',
      { input: null, variables: { name: 'Yoann' }, timeoutMs: 30_000 }
    )
    expect(result).toEqual({ greeting: 'hi Yoann', n: 1 })
  }, 60_000)

  it('rejects on a python error', async () => {
    await expect(
      pythonRuntime.run('1 / 0', { input: null, variables: {}, timeoutMs: 30_000 })
    ).rejects.toThrow(/ZeroDivisionError|division/i)
  }, 60_000)

  it('kills a runaway loop on timeout (does NOT hang)', async () => {
    const t0 = Date.now()
    await expect(
      pythonRuntime.run('while True:\n    pass', { input: null, variables: {}, timeoutMs: 2_000 })
    ).rejects.toThrow(/timed out/i)
    // Must return shortly after the 2 s budget, not hang forever.
    expect(Date.now() - t0).toBeLessThan(30_000)
  }, 60_000)
})
