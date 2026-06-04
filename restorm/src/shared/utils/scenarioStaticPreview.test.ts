import { describe, expect, it } from 'vitest'
import {
  staticScenarioPreview,
  concreteValue,
  setEnvironmentPreviewResolver,
  type StaticPreviewNode,
  type StaticPreviewEdge
} from './scenarioStaticPreview'

/** An `output` node carrying the given decls (id / name / optional literal). */
function outputNode(id: string, decls: { id: string; name: string; value?: unknown }[]): StaticPreviewNode {
  return { id, kind: 'output', config: { outputs: decls } }
}

describe('staticScenarioPreview — output node', () => {
  it('emits the literal fallback for an unwired decl', () => {
    const node = outputNode('out1', [
      { id: 'output-default-decl', name: 'static_output', value: { type: 'boolean', value: true } }
    ])
    expect(staticScenarioPreview(node, [node], [])).toEqual({ static_output: true })
  })

  it('resolves a wired decl through the source preview + selector', () => {
    const object: StaticPreviewNode = {
      id: 'obj',
      kind: 'object',
      config: {
        properties: [
          { id: 'p1', name: 'obj_param1', value: { type: 'string', value: 'main' } },
          { id: 'p2', name: 'obj_param2', value: { type: 'numeric', value: 20, format: 'decimal' } }
        ]
      }
    }
    const node = outputNode('out1', [
      { id: 'first', name: 'first' },
      { id: 'second', name: 'second' }
    ])
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'obj', portId: 'object' }, to: { nodeId: 'out1', portId: 'first' }, selector: 'obj_param1' },
      { from: { nodeId: 'obj', portId: 'object' }, to: { nodeId: 'out1', portId: 'second' }, selector: 'obj_param2' }
    ]
    expect(staticScenarioPreview(node, [object, node], edges)).toEqual({ first: 'main', second: 20 })
  })

  it('skips blank-named decls', () => {
    const node = outputNode('out1', [
      { id: 'd1', name: '', value: { type: 'string', value: 'ignored' } },
      { id: 'd2', name: 'kept', value: { type: 'string', value: 'x' } }
    ])
    expect(staticScenarioPreview(node, [node], [])).toEqual({ kept: 'x' })
  })

  it('emits null for an unwired environment decl with no environment selected', () => {
    const node = outputNode('out1', [
      { id: 'env', name: 'env', value: { type: 'environment', value: '' } }
    ])
    expect(staticScenarioPreview(node, [node], [])).toEqual({ env: null })
  })
})

describe('staticScenarioPreview — aggregate over a variable list', () => {
  it('previews the count of a customListMulti stashed in a setVariable, read via the variable', () => {
    // setVariable PetColors = [Vert, Bleu]; aggregate(count, items = variable
    // PetColors). The static preview resolves the variable to the setVariable's
    // list value (an array) so the inspector shows the count without a run.
    const sv: StaticPreviewNode = {
      id: 'sv',
      kind: 'setVariable',
      config: { name: 'PetColors', value: { type: 'customListMulti', listId: 'L', labels: ['Vert', 'Bleu'] } }
    }
    const agg: StaticPreviewNode = {
      id: 'agg',
      kind: 'aggregate',
      config: { op: 'count', items: { type: 'variable', value: 'PetColors' } }
    }
    expect(staticScenarioPreview(agg, [sv, agg], [])).toEqual({ result: 2 })
  })
})

describe('staticScenarioPreview — aggregate over a WIRED list', () => {
  it('previews the sum of a list piped from addToList.result through a `.` selector', () => {
    // addToList.result = [10, 15]; aggregate(sum) reads it via a wired `items`
    // link whose selector is `.` (array identity, relative to the port value).
    // The preview must unwrap the source PORT value before applying the selector
    // — applying `.` to the `{ result: [...] }` display wrapper instead returns
    // the object (not an array) and the inspector shows nothing.
    const add: StaticPreviewNode = {
      id: 'add',
      kind: 'addToList',
      config: {
        list: { type: 'list', items: [{ type: 'numeric', value: 10, format: 'decimal' }, { type: 'numeric', value: 15, format: 'decimal' }] },
        values: []
      }
    }
    const agg: StaticPreviewNode = {
      id: 'agg',
      kind: 'aggregate',
      config: { op: 'sum', items: { type: 'variable', value: 'basket' } }
    }
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'add', portId: 'result' }, to: { nodeId: 'agg', portId: 'items' }, selector: '.' }
    ]
    expect(staticScenarioPreview(agg, [add, agg], edges)).toEqual({ result: 25 })
  })
})

describe('concreteValue — environment', () => {
  it('returns null when no environment is selected (empty id)', () => {
    expect(concreteValue({ type: 'environment', value: '' })).toBeNull()
  })

  it('keeps the {{$id}} template for a selected-but-unresolved environment', () => {
    setEnvironmentPreviewResolver(null)
    expect(concreteValue({ type: 'environment', value: 'env-123' })).toBe('{{$env-123}}')
  })

  it('returns the resolver shape for a selected, resolvable environment', () => {
    setEnvironmentPreviewResolver((id) => ({ name: `env(${id})`, variables: {} }))
    expect(concreteValue({ type: 'environment', value: 'env-123' })).toEqual({ name: 'env(env-123)', variables: {} })
    setEnvironmentPreviewResolver(null)
  })
})
