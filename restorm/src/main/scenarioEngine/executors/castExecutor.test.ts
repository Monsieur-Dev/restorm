import { describe, it, expect } from 'vitest'
import { castExecutor } from './pureExecutors'
import type { ScenarioNode } from '../../../shared/types/scenario'

/** Run the cast executor with a minimal activation + context. `wired` (when
 * present) feeds the `value` port; otherwise the inline `config.value` is used. */
function runCast(
  config: Record<string, unknown>,
  inputs: Record<string, unknown> = {},
  variables = new Map<string, unknown>()
): unknown {
  const node = { id: 'c', kind: 'cast', config, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
  const ctx = { node, variables, interactive: false, log: () => undefined } as never
  const result = castExecutor({ nodeId: 'c', kind: 'cast', scope: [], inputs } as never, ctx) as {
    outputs: { port: string; value: unknown }[]
  }
  return result.outputs.find((o) => o.port === 'result')?.value
}

describe('castExecutor — wires the shared castValue onto `result`', () => {
  it('casts a wired numeric string to number', () => {
    expect(runCast({ targetType: 'number' }, { value: '42' })).toBe(42)
  })

  it('casts an inline boolean config value to a 0/1 number', () => {
    expect(runCast({ targetType: 'number', value: { type: 'boolean', value: true } })).toBe(1)
  })

  it('wraps any value into a single-element list', () => {
    expect(runCast({ targetType: 'list' }, { value: 'x' })).toEqual(['x'])
  })

  it('reads a live variable operand and casts it', () => {
    const vars = new Map<string, unknown>([['flag', 'yes']])
    expect(runCast({ targetType: 'boolean', value: { type: 'variable', value: 'flag' } }, {}, vars)).toBe(true)
  })

  it('defaults to string when targetType is missing/unknown', () => {
    expect(runCast({}, { value: 7 })).toBe('7')
  })

  it('THROWS an impossible cast so the scheduler routes it to `error`', () => {
    expect(() => runCast({ targetType: 'number' }, { value: 'abc' })).toThrow(/not a numeric value/)
    expect(() => runCast({ targetType: 'number' }, { value: [1, 2] })).toThrow(/Cannot cast/)
  })
})
