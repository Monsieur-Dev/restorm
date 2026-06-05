import { describe, it, expect } from 'vitest'
import { jsonExecutor } from './pureExecutors'
import type { ScenarioNode } from '../../../shared/types/scenario'

function runJson(
  config: Record<string, unknown>,
  inputs: Record<string, unknown> = {},
  variables = new Map<string, unknown>()
): unknown {
  const node = { id: 'j', kind: 'json', config, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
  const ctx = { node, variables, interactive: false, log: () => undefined } as never
  const result = jsonExecutor({ nodeId: 'j', kind: 'json', scope: [], inputs } as never, ctx) as {
    outputs: { port: string; value: unknown }[]
  }
  return result.outputs.find((o) => o.port === 'result')?.value
}

describe('jsonExecutor — wires the shared applyJson onto `result`', () => {
  it('parses a wired JSON string', () => {
    expect(runJson({ op: 'parse' }, { value: '{"a":1}' })).toEqual({ a: 1 })
  })

  it('stringifies a wired object (the natural use)', () => {
    expect(runJson({ op: 'stringify' }, { value: { a: 1, b: [2, 3] } })).toBe('{"a":1,"b":[2,3]}')
  })

  it('stringify honours an inline indent', () => {
    expect(runJson({ op: 'stringify', indent: 2 }, { value: { a: 1 } })).toBe('{\n  "a": 1\n}')
  })

  it('reads a live variable operand and parses it', () => {
    const vars = new Map<string, unknown>([['body', '[1,2,3]']])
    expect(runJson({ op: 'parse', value: { type: 'variable', value: 'body' } }, {}, vars)).toEqual([1, 2, 3])
  })

  it('defaults to parse when op is missing/unknown', () => {
    expect(runJson({}, { value: '"hi"' })).toBe('hi')
  })

  it('THROWS malformed JSON so the scheduler routes it to `error`', () => {
    expect(() => runJson({ op: 'parse' }, { value: '{bad}' })).toThrow()
  })
})
