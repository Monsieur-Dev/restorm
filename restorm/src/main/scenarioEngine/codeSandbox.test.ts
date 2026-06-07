// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { runCodeInSandbox } from './codeSandbox'

describe('codeSandbox', () => {
  it('runs plain JS and returns the value', async () => {
    const { result } = await runCodeInSandbox({ code: 'return 1 + 2' })
    expect(result).toBe(3)
  })

  it('strips TypeScript types and runs', async () => {
    const { result } = await runCodeInSandbox({ code: 'const n: number = 20; const s: string = "x"; return n * 2' })
    expect(result).toBe(40)
  })

  it('exposes the wired input as `input`', async () => {
    const { result } = await runCodeInSandbox({ code: 'return input.x + 1', input: { x: 41 } })
    expect(result).toBe(42)
  })

  it('exposes run variables as `vars`', async () => {
    const { result } = await runCodeInSandbox({ code: 'return vars.greeting + " world"', variables: { greeting: 'hello' } })
    expect(result).toBe('hello world')
  })

  it('bundles lodash (global + require)', async () => {
    const a = await runCodeInSandbox({ code: 'return _.sum([1, 2, 3, 4])' })
    expect(a.result).toBe(10)
    const b = await runCodeInSandbox({ code: 'const ld = require("lodash"); return ld.chunk([1,2,3,4], 2)' })
    expect(b.result).toEqual([[1, 2], [3, 4]])
  })

  it('bundles moment', async () => {
    const { result } = await runCodeInSandbox({ code: 'return moment("2026-01-01").add(1, "day").format("YYYY-MM-DD")' })
    expect(result).toBe('2026-01-02')
  })

  it('captures console.log output', async () => {
    const { logs } = await runCodeInSandbox({ code: 'console.log("hi", 42); console.log({ a: 1 }); return null' })
    expect(logs).toEqual(['hi 42', '{"a":1}'])
  })

  it('surfaces a thrown error', async () => {
    await expect(runCodeInSandbox({ code: 'throw new Error("boom")' })).rejects.toThrow('boom')
  })

  it('has NO access to the host (no require of node builtins, no process)', async () => {
    await expect(runCodeInSandbox({ code: 'return require("fs")' })).rejects.toThrow(/not available in the sandbox/)
    const { result } = await runCodeInSandbox({ code: 'return typeof process' })
    expect(result).toBe('undefined')
  })

  it('kills a runaway loop via the deadline', async () => {
    await expect(runCodeInSandbox({ code: 'while (true) {}', timeoutMs: 300 })).rejects.toThrow()
  }, 5000)

  it('supports top-level await on a resolved promise', async () => {
    const { result } = await runCodeInSandbox({ code: 'const x = await Promise.resolve(41); return x + 1' })
    expect(result).toBe(42)
  })

  it('supports await Promise.all + an async helper', async () => {
    const { result } = await runCodeInSandbox({
      code: 'async function dbl(n: number) { return n * 2 }\nconst xs = await Promise.all([dbl(1), dbl(2), dbl(3)])\nreturn _.sum(xs)'
    })
    expect(result).toBe(12)
  })

  it('resolves await on a setTimeout-backed promise', async () => {
    const { result } = await runCodeInSandbox({ code: 'await new Promise((r) => setTimeout(() => r(undefined), 10)); return "done"' })
    expect(result).toBe('done')
  })

  it('times out an await that never settles', async () => {
    await expect(runCodeInSandbox({ code: 'await new Promise(() => {}); return 1', timeoutMs: 300 })).rejects.toThrow(/timed out/)
  }, 5000)
})
