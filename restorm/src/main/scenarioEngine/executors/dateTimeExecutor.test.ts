import { describe, it, expect } from 'vitest'
import { dateTimeExecutor } from './pureExecutors'
import type { ScenarioNode } from '../../../shared/types/scenario'

function runDateTime(
  config: Record<string, unknown>,
  inputs: Record<string, unknown> = {},
  variables = new Map<string, unknown>()
): unknown {
  const node = { id: 'd', kind: 'datetime', config, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
  const ctx = { node, variables, interactive: false, log: () => undefined } as never
  const result = dateTimeExecutor({ nodeId: 'd', kind: 'datetime', scope: [], inputs } as never, ctx) as {
    outputs: { port: string; value: unknown }[]
  }
  return result.outputs.find((o) => o.port === 'result')?.value
}

describe('dateTimeExecutor — wires the shared applyDateTime onto `result`', () => {
  it('adds a duration to a wired date', () => {
    expect(runDateTime({ op: 'add', amount: 2, unit: 'days' }, { value: '2026-01-01T00:00:00.000Z' })).toContain(
      '2026-01-03'
    )
  })

  it('formats a wired date with a luxon pattern', () => {
    expect(runDateTime({ op: 'format', format: 'yyyy-LL-dd' }, { value: '2026-06-05T08:00:00.000Z' })).toBe(
      '2026-06-05'
    )
  })

  it('diffs against an inline `other` date', () => {
    expect(
      runDateTime({ op: 'diff', unit: 'days', other: { type: 'string', value: '2026-01-11T00:00:00.000Z' } }, {
        value: '2026-01-01T00:00:00.000Z'
      })
    ).toBe(10)
  })

  it('reads a live variable date operand', () => {
    const vars = new Map<string, unknown>([['ts', '2026-01-01T00:00:00.000Z']])
    expect(
      runDateTime({ op: 'add', amount: 1, unit: 'years', value: { type: 'variable', value: 'ts' } }, {}, vars)
    ).toContain('2027-01-01')
  })

  it('THROWS an unreadable date so the scheduler routes it to `error`', () => {
    expect(() => runDateTime({ op: 'add', amount: 1, unit: 'days' }, { value: 'not a date' })).toThrow()
  })
})
