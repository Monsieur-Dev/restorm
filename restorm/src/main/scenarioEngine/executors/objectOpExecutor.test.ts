import { describe, it, expect } from 'vitest'
import { objectOpExecutor, urlExecutor, randomExecutor, throwExecutor } from './pureExecutors'
import type { ScenarioNode } from '../../../shared/types/scenario'

function run(executor: typeof objectOpExecutor, kind: string, config: Record<string, unknown>, inputs: Record<string, unknown> = {}, variables = new Map<string, unknown>()): unknown {
  const node = { id: 'n', kind, config, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
  const ctx = { node, variables, interactive: false, log: () => undefined } as never
  const result = executor({ nodeId: 'n', kind, scope: [], inputs } as never, ctx) as { outputs: { port: string; value: unknown }[] }
  return result.outputs.find((o) => o.port === 'result')?.value
}

describe('objectOpExecutor — wires applyObjectOp onto `result`', () => {
  it('gets a dot-path from a wired object', () => {
    expect(run(objectOpExecutor, 'objectOp', { op: 'get', path: 'a.b' }, { value: { a: { b: 7 } } })).toBe(7)
  })
  it('picks keys (comma-separated config)', () => {
    expect(run(objectOpExecutor, 'objectOp', { op: 'pick', keys: 'id, name' }, { value: { id: 1, name: 'x', extra: 9 } })).toEqual({ id: 1, name: 'x' })
  })
  it('merges with the inline `other` object', () => {
    expect(run(objectOpExecutor, 'objectOp', { op: 'merge', other: { type: 'list', items: [] } }, { value: { a: 1 } })).toBeDefined()
    expect(run(objectOpExecutor, 'objectOp', { op: 'keys' }, { value: { a: 1, b: 2 } })).toEqual(['a', 'b'])
  })
  it('THROWS on a non-object operand', () => {
    expect(() => run(objectOpExecutor, 'objectOp', { op: 'keys' }, { value: 'nope' })).toThrow()
  })
})

describe('urlExecutor — wires applyUrl onto `result`', () => {
  it('encodes / parses a query', () => {
    expect(run(urlExecutor, 'url', { op: 'encode' }, { value: 'a b' })).toBe('a%20b')
    expect(run(urlExecutor, 'url', { op: 'parseQuery' }, { value: 'a=1&b=2' })).toEqual({ a: '1', b: '2' })
  })
  it('THROWS on a bad URL', () => {
    expect(() => run(urlExecutor, 'url', { op: 'parseUrl' }, { value: 'nope' })).toThrow()
  })
})

describe('randomExecutor — wires applyRandom onto `result`', () => {
  it('is deterministic with a seed', () => {
    const a = run(randomExecutor, 'random', { op: 'int', min: 1, max: 100, seed: 42 })
    const b = run(randomExecutor, 'random', { op: 'int', min: 1, max: 100, seed: 42 })
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(1)
    expect(a).toBeLessThanOrEqual(100)
  })
  it('picks from a config list', () => {
    const v = run(randomExecutor, 'random', { op: 'pick', seed: 3, items: { type: 'list', items: [{ type: 'string', value: 'x' }, { type: 'string', value: 'y' }] } })
    expect(['x', 'y']).toContain(v)
  })
  it('advances the seeded sequence across calls that share a run (not a constant)', () => {
    // Same run = shared variable store → the per-node call index advances, so a
    // seeded random in a loop yields a SEQUENCE, not the same value every time.
    const vars = new Map<string, unknown>()
    const seq = Array.from({ length: 5 }, () =>
      run(randomExecutor, 'random', { op: 'int', min: 1, max: 1_000_000, seed: 42 }, {}, vars)
    )
    expect(new Set(seq).size).toBeGreaterThan(1)
    // …yet the sequence is reproducible: a fresh run with the same seed repeats it.
    const vars2 = new Map<string, unknown>()
    const seq2 = Array.from({ length: 5 }, () =>
      run(randomExecutor, 'random', { op: 'int', min: 1, max: 1_000_000, seed: 42 }, {}, vars2)
    )
    expect(seq2).toEqual(seq)
  })
})

describe('throwExecutor — always throws', () => {
  it('throws the resolved message', () => {
    const node = { id: 't', kind: 'throw', config: { message: { type: 'string', value: 'boom' } }, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
    const ctx = { node, variables: new Map(), interactive: false, log: () => undefined } as never
    expect(() => throwExecutor({ nodeId: 't', kind: 'throw', scope: [], inputs: {} } as never, ctx)).toThrow('boom')
  })
})
