import { describe, expect, it } from 'vitest'
import {
  staticScenarioPreview,
  concreteValue,
  setEnvironmentPreviewResolver,
  setSecretPreviewResolver,
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

describe('staticScenarioPreview — variable resolved by following the graph', () => {
  it('previews an aggregate over a variable built by a setVariable<-addToList chain (nearest assignment wins)', () => {
    // basket = [] (up-front) → addToList appends 10,15 → setVariable basket =
    // that result → aggregate(sum, items = variable basket). The preview must
    // follow the trigger chain to the NEAREST setVariable(basket) — the one fed
    // by addToList (=[10,15]) — not the earlier empty one, AND the addToList must
    // see the EMPTY basket (its own nearest assignment) before appending.
    const svEmpty: StaticPreviewNode = { id: 'svEmpty', kind: 'setVariable', config: { name: 'basket', value: { type: 'list', items: [] } } }
    const add: StaticPreviewNode = {
      id: 'add', kind: 'addToList',
      config: {
        list: { type: 'variable', value: 'basket' },
        values: [
          { id: 'r1', value: { type: 'numeric', value: 10, format: 'decimal' } },
          { id: 'r2', value: { type: 'numeric', value: 15, format: 'decimal' } }
        ]
      }
    }
    const svFull: StaticPreviewNode = { id: 'svFull', kind: 'setVariable', config: { name: 'basket' } }
    const agg: StaticPreviewNode = { id: 'agg', kind: 'aggregate', config: { op: 'sum', items: { type: 'variable', value: 'basket' } } }
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'svEmpty', portId: 'done' }, to: { nodeId: 'add', portId: 'in' } },
      { from: { nodeId: 'add', portId: 'result' }, to: { nodeId: 'svFull', portId: 'value' }, selector: '.' },
      { from: { nodeId: 'svFull', portId: 'done' }, to: { nodeId: 'agg', portId: 'in' } }
    ]
    expect(staticScenarioPreview(agg, [svEmpty, add, svFull, agg], edges)).toEqual({ result: 25 })
  })

  it('previews an aggregate over a variable updated by an addToList PUSH toggle (no explicit setVariable)', () => {
    // basket2 = [] → addToList(list = basket2, updateSourceVariable: true) pushes
    // 10,15 straight INTO basket2 → aggregate(sum) over basket2. The preview must
    // recognise the addToList as a writer of basket2 and evaluate its `result`.
    const svEmpty: StaticPreviewNode = { id: 'svEmpty', kind: 'setVariable', config: { name: 'basket2', value: { type: 'list', items: [] } } }
    const add: StaticPreviewNode = {
      id: 'add', kind: 'addToList',
      config: {
        list: { type: 'variable', value: 'basket2' },
        updateSourceVariable: true,
        values: [
          { id: 'r1', value: { type: 'numeric', value: 10, format: 'decimal' } },
          { id: 'r2', value: { type: 'numeric', value: 15, format: 'decimal' } }
        ]
      }
    }
    const agg: StaticPreviewNode = { id: 'agg', kind: 'aggregate', config: { op: 'sum', items: { type: 'variable', value: 'basket2' } } }
    const edges: StaticPreviewEdge[] = [
      { from: { nodeId: 'svEmpty', portId: 'done' }, to: { nodeId: 'add', portId: 'in' } },
      { from: { nodeId: 'add', portId: 'done' }, to: { nodeId: 'agg', portId: 'in' } }
    ]
    expect(staticScenarioPreview(agg, [svEmpty, add, agg], edges)).toEqual({ result: 25 })
  })

  it('resolves a customListMulti variable to its ARRAY (not the joined string) through the trigger chain', () => {
    const sv: StaticPreviewNode = { id: 'sv', kind: 'setVariable', config: { name: 'cols', value: { type: 'customListMulti', listId: 'L', labels: ['Vert', 'Bleu'] } } }
    const gv: StaticPreviewNode = { id: 'gv', kind: 'getVariable', config: { value: { type: 'variable', value: 'cols' } } }
    const edges: StaticPreviewEdge[] = [{ from: { nodeId: 'sv', portId: 'done' }, to: { nodeId: 'gv', portId: 'in' } }]
    expect(staticScenarioPreview(gv, [sv, gv], edges)).toEqual({ cols: ['Vert', 'Bleu'] })
  })

  it('compares two list variables by SET equality (order-independent) and SUBSET (contains)', () => {
    const c1: StaticPreviewNode = { id: 'c1', kind: 'setVariable', config: { name: 'l1', value: { type: 'customListMulti', listId: 'L', labels: ['Rouge', 'Vert'] } } }
    const c2: StaticPreviewNode = { id: 'c2', kind: 'setVariable', config: { name: 'l2', value: { type: 'customListMulti', listId: 'L', labels: ['Vert', 'Rouge'] } } }
    const edgesTo = (cmp: string): StaticPreviewEdge[] => [
      { from: { nodeId: 'c1', portId: 'done' }, to: { nodeId: cmp, portId: 'in' } },
      { from: { nodeId: 'c2', portId: 'done' }, to: { nodeId: cmp, portId: 'in' } }
    ]
    const eq: StaticPreviewNode = { id: 'eq', kind: 'comparator', config: { operator: '=', a: { type: 'variable', value: 'l1' }, b: { type: 'variable', value: 'l2' } } }
    const contains: StaticPreviewNode = { id: 'ct', kind: 'comparator', config: { operator: 'contains', a: { type: 'variable', value: 'l1' }, b: { type: 'variable', value: 'l2' } } }
    expect(staticScenarioPreview(eq, [c1, c2, eq], edgesTo('eq'))).toEqual({ result: true })
    expect(staticScenarioPreview(contains, [c1, c2, contains], edgesTo('ct'))).toEqual({ result: true })
  })

  it('a variable read BEFORE it is set (the writer is a successor) previews nothing, not the future value', () => {
    const gv: StaticPreviewNode = { id: 'gv', kind: 'getVariable', config: { value: { type: 'variable', value: 'rb' } } }
    const sv: StaticPreviewNode = { id: 'sv', kind: 'setVariable', config: { name: 'rb', value: { type: 'string', value: 'test' } } }
    // getVariable runs first; the setVariable is DOWNSTREAM (its `in` is wired
    // from the read's `done`), so at the read point `rb` isn't set yet.
    const edges: StaticPreviewEdge[] = [{ from: { nodeId: 'gv', portId: 'done' }, to: { nodeId: 'sv', portId: 'in' } }]
    expect(staticScenarioPreview(gv, [gv, sv], edges)).toEqual({ rb: null })
  })

  it('returns null (no misleading result) for a sum over non-numeric items', () => {
    // [1, true] — a boolean is non-numeric, so the strict aggregate throws; the
    // preview catches it and shows nothing rather than a coerced 2.
    const sv: StaticPreviewNode = { id: 'sv', kind: 'setVariable', config: { name: 'mix', value: { type: 'list', items: [{ type: 'numeric', value: 1, format: 'decimal' }, { type: 'boolean', value: true }] } } }
    const agg: StaticPreviewNode = { id: 'agg', kind: 'aggregate', config: { op: 'sum', items: { type: 'variable', value: 'mix' } } }
    expect(staticScenarioPreview(agg, [sv, agg], [])).toBeNull()
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

describe('concreteValue — secret', () => {
  it('renders empty when no resolver is installed (no plaintext on disk)', () => {
    setSecretPreviewResolver(null)
    expect(concreteValue({ type: 'secret', source: 'envVar', params: { name: 'PATH' } })).toBe('')
  })

  it('renders the resolved plaintext when the resolver knows the secret', () => {
    setSecretPreviewResolver((source, params) =>
      source === 'envVar' && params['name'] === 'PATH' ? '/home/me/bin' : undefined
    )
    expect(concreteValue({ type: 'secret', source: 'envVar', params: { name: 'PATH' } })).toBe('/home/me/bin')
    setSecretPreviewResolver(null)
  })

  it('renders empty on a resolver miss (async value not cached yet)', () => {
    setSecretPreviewResolver(() => undefined)
    expect(concreteValue({ type: 'secret', source: 'envVar', params: { name: 'PATH' } })).toBe('')
    setSecretPreviewResolver(null)
  })

  it('a set-variable node surfaces the resolved secret in its preview', () => {
    setSecretPreviewResolver(() => '/home/me/bin')
    const node: StaticPreviewNode = {
      id: 'sv',
      kind: 'setVariable',
      config: { name: 'apiKey', value: { type: 'secret', source: 'envVar', params: { name: 'PATH' } } }
    }
    expect(staticScenarioPreview(node, [node], [])).toEqual({ apiKey: '/home/me/bin' })
    setSecretPreviewResolver(null)
  })
})
