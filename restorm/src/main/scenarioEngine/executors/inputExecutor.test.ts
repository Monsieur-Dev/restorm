import { describe, it, expect } from 'vitest'
import { inputExecutor } from './registry'
import type { ScenarioNode } from '../../../shared/types/scenario'

/** Run the (async) input executor with a minimal activation + context, exposing
 * the variable store so the test can assert what the input published. */
async function runInput(
  config: Record<string, unknown>,
  act: { seeded: boolean; inputs: Record<string, unknown> }
): Promise<{ value: unknown; variables: Map<string, unknown> }> {
  const variables = new Map<string, unknown>()
  const node = { id: 'in', kind: 'input', config, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
  const ctx = { node, variables, interactive: false, log: () => undefined } as never
  const result = (await inputExecutor({ nodeId: 'in', kind: 'input', scope: [], ...act } as never, ctx)) as {
    outputs: { port: string; value: unknown }[]
  }
  return { value: result.outputs.find((o) => o.port === 'value')?.value, variables }
}

describe('inputExecutor — params published as scenario variables', () => {
  it('publishes each seeded param into the variable store', async () => {
    const { value, variables } = await runInput(
      { params: [{ id: 'p1', name: 'param1' }, { id: 'p2', name: 'param2' }] },
      { seeded: true, inputs: { value: { param1: 'hello', param2: 42 } } }
    )
    expect(value).toEqual({ param1: 'hello', param2: 42 })
    expect(variables.get('param1')).toBe('hello')
    expect(variables.get('param2')).toBe(42)
  })

  it('publishes configured defaults on a non-interactive run with no supplied values', async () => {
    const { value, variables } = await runInput(
      {
        params: [
          { id: 'p1', name: 'param1', valueType: { type: 'string', value: 'def' } },
          { id: 'p2', name: 'param2', valueType: { type: 'numeric', value: 7, format: 'decimal' } }
        ]
      },
      { seeded: false, inputs: {} }
    )
    expect(value).toEqual({ param1: 'def', param2: 7 })
    expect(variables.get('param1')).toBe('def')
    expect(variables.get('param2')).toBe(7)
  })

  it('ignores a non-object seeded value (nothing to publish)', async () => {
    const { variables } = await runInput(
      { params: [{ id: 'p1', name: 'param1' }] },
      { seeded: true, inputs: { value: 'scalar' } }
    )
    expect(variables.size).toBe(0)
  })
})
