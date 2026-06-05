import { describe, it, expect } from 'vitest'
import { xmlExecutor } from './pureExecutors'
import type { ScenarioNode } from '../../../shared/types/scenario'

function runXml(
  config: Record<string, unknown>,
  inputs: Record<string, unknown> = {},
  variables = new Map<string, unknown>()
): unknown {
  const node = { id: 'x', kind: 'xml', config, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
  const ctx = { node, variables, interactive: false, log: () => undefined } as never
  const result = xmlExecutor({ nodeId: 'x', kind: 'xml', scope: [], inputs } as never, ctx) as {
    outputs: { port: string; value: unknown }[]
  }
  return result.outputs.find((o) => o.port === 'result')?.value
}

describe('xmlExecutor — wires the shared applyXml onto `result`', () => {
  it('parses a wired XML string', () => {
    expect(runXml({ op: 'parse' }, { value: '<a><b>1</b></a>' })).toEqual({ a: { b: 1 } })
  })

  it('stringifies a wired object', () => {
    expect(runXml({ op: 'stringify' }, { value: { a: { b: '1' } } })).toBe('<a><b>1</b></a>')
  })

  it('reads a live variable operand and parses it', () => {
    const vars = new Map<string, unknown>([['body', '<r id="2"/>']])
    expect(runXml({ op: 'parse', value: { type: 'variable', value: 'body' } }, {}, vars)).toEqual({
      r: { '@_id': '2' }
    })
  })

  it('defaults to parse when op is missing', () => {
    expect(runXml({}, { value: '<n>hi</n>' })).toEqual({ n: 'hi' })
  })

  it('THROWS malformed XML so the scheduler routes it to `error`', () => {
    expect(() => runXml({ op: 'parse' }, { value: '<a><b></a>' })).toThrow()
  })
})
