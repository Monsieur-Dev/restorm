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
