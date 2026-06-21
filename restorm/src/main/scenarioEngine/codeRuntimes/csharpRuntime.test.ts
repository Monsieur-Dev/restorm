import { describe, it, expect } from 'vitest'
import { csharpRuntime } from './csharpRuntime'

/**
 * Parity suite for the C# runtime (mirrors rubyRuntime/rRuntime). The .NET WASM
 * eval bundle is vendored under `resources/dotnet-wasm/` (built once with the
 * .NET SDK + wasm-tools — see docs/contributing/building-the-csharp-wasm-bundle.md),
 * so these run for real: inject `input`/`vars`, capture `Console` output, return
 * the last expression, reject on a C# error, and kill a runaway loop on timeout.
 */
describe('csharpRuntime (.NET WASM worker)', () => {
  it('runs C#, injects `input`/`vars`, captures Console output, returns the last expression', async () => {
    const { result, logs } = await csharpRuntime.run(
      'Console.WriteLine($"hi from C# {vars["name"]}");\n(int)(long)input["a"] + (int)(long)input["b"]',
      { input: { a: 2, b: 5 }, variables: { name: 'Yo' }, timeoutMs: 40_000 }
    )
    expect(result).toBe(7)
    expect(logs.join('')).toMatch(/hi from C# Yo/)
  }, 120_000)

  it('rejects on a C# error', async () => {
    await expect(
      csharpRuntime.run('throw new Exception("boom");', { input: null, variables: {}, timeoutMs: 40_000 })
    ).rejects.toThrow(/boom/i)
  }, 120_000)

  it('kills a runaway loop on timeout (does NOT hang)', async () => {
    const t0 = Date.now()
    await expect(
      csharpRuntime.run('while (true) {}', { input: null, variables: {}, timeoutMs: 2_000 })
    ).rejects.toThrow(/timed out/i)
    expect(Date.now() - t0).toBeLessThan(30_000)
  }, 120_000)
})
