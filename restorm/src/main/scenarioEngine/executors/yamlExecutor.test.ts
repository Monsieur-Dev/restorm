import { describe, it, expect } from 'vitest'
import { yamlExecutor } from './pureExecutors'
import type { ScenarioNode } from '../../../shared/types/scenario'

function runYaml(
  config: Record<string, unknown>,
  inputs: Record<string, unknown> = {},
  variables = new Map<string, unknown>()
): unknown {
  const node = { id: 'y', kind: 'yaml', config, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
  const ctx = { node, variables, interactive: false, log: () => undefined } as never
  const result = yamlExecutor({ nodeId: 'y', kind: 'yaml', scope: [], inputs } as never, ctx) as {
    outputs: { port: string; value: unknown }[]
  }
  return result.outputs.find((o) => o.port === 'result')?.value
}

describe('yamlExecutor — wires the shared applyYaml onto `result`', () => {
  it('parses a wired YAML string', () => {
    expect(runYaml({ op: 'parse' }, { value: 'a: 1\nb: 2\n' })).toEqual({ a: 1, b: 2 })
  })

  it('stringifies a wired object', () => {
    expect(runYaml({ op: 'stringify' }, { value: { a: 1, b: [2, 3] } })).toBe('a: 1\nb:\n  - 2\n  - 3\n')
  })

  it('reads a live variable operand and parses it', () => {
    const vars = new Map<string, unknown>([['body', 'x: true']])
    expect(runYaml({ op: 'parse', value: { type: 'variable', value: 'body' } }, {}, vars)).toEqual({ x: true })
  })

  it('defaults to parse when op is missing', () => {
    expect(runYaml({}, { value: 'hi' })).toBe('hi')
  })

  it('THROWS malformed YAML so the scheduler routes it to `error`', () => {
    expect(() => runYaml({ op: 'parse' }, { value: 'a: [1, 2' })).toThrow()
  })
})
