import { describe, it, expect } from 'vitest'
import type { FolderItem, Scenario } from '../../../shared/types/collections'
import { deepCloneItem, cloneItemInTree, generateUniqueId } from './treeManipulation'

describe('generateUniqueId', () => {
  it('produces a UUID, never colliding within a tight loop', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 10_000; i++) ids.add(generateUniqueId())
    // Date.now()+Math.random() collided within a millisecond; crypto.randomUUID never does.
    expect(ids.size).toBe(10_000)
    expect(generateUniqueId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})

/**
 * Cloning a tree item (sidebar "Clone") must produce a FULLY independent copy:
 * a fresh id for the item AND every descendant, no shared arrays/objects (so
 * adding a child to the copy never touches the original), and references to the
 * cloned ids remapped onto the new ones. Scenarios + folders both apply.
 */
function makeScenario(): Scenario {
  return {
    type: 'scenario',
    id: 'scn-1',
    name: 'My Scenario',
    tags: [],
    params: [],
    nodes: [
      { id: 'node-1', kind: 'httpRequest', config: { requestId: 'req-child' }, inputs: [], outputs: [], position: { x: 0, y: 0 } },
      { id: 'node-2', kind: 'log', config: {}, inputs: [], outputs: [], position: { x: 10, y: 10 } }
    ],
    edges: [
      { id: 'e-1', from: { nodeId: 'node-1', portId: 'out' }, to: { nodeId: 'node-2', portId: 'in' } }
    ],
    items: [
      { type: 'http', id: 'req-child', name: 'Child Req', method: 'GET', url: '' } as unknown as FolderItem
    ]
  } as unknown as Scenario
}

describe('deepCloneItem', () => {
  it('clones a scenario with a fresh id + fresh child ids, fully unshared', () => {
    const original = makeScenario()
    const clone = deepCloneItem(original as unknown as FolderItem) as unknown as Scenario

    // Fresh ids for the scenario and its child item.
    expect(clone.id).not.toBe(original.id)
    expect(clone.items?.[0]?.id).not.toBe('req-child')

    // Independent arrays/objects — mutating the clone must not touch the source.
    expect(clone.nodes).not.toBe(original.nodes)
    expect(clone.items).not.toBe(original.items)
    clone.items?.push({ type: 'http', id: 'added', name: 'Added' } as unknown as FolderItem)
    expect(original.items?.length).toBe(1)

    // Only the top-level clone is renamed; children keep their names.
    expect(clone.name).toBe('My Scenario (copy)')
    expect(clone.items?.[0]?.name).toBe('Child Req')
  })

  it('remaps references to cloned ids (a node bound to a child request follows the copy)', () => {
    const original = makeScenario()
    const clone = deepCloneItem(original as unknown as FolderItem) as unknown as Scenario
    const newChildId = clone.items?.[0]?.id
    const boundId = (clone.nodes[0]?.config as { requestId?: string }).requestId
    expect(boundId).toBe(newChildId)
    // Original is untouched.
    expect((original.nodes[0]?.config as { requestId?: string }).requestId).toBe('req-child')
  })

  it('leaves scenario-scoped node/edge ids intact (edges still point at their nodes)', () => {
    const clone = deepCloneItem(makeScenario() as unknown as FolderItem) as unknown as Scenario
    expect(clone.nodes[0]?.id).toBe('node-1')
    expect(clone.edges[0]?.from.nodeId).toBe('node-1')
    expect(clone.edges[0]?.to.nodeId).toBe('node-2')
  })
})

describe('cloneItemInTree', () => {
  it('clones a ROOT-level item back into the root list (no parent)', () => {
    const root: FolderItem[] = [
      { id: 'env-1', name: 'Env', items: [], environments: [{ id: 'e1', name: 'local' }], configuration: {} } as unknown as FolderItem
    ]
    const clone = cloneItemInTree(root, 'env-1')
    expect(clone).not.toBeNull()
    expect(root).toHaveLength(2)
    expect(root[1]?.id).not.toBe('env-1')
    expect(root[1]?.id).toBe(clone?.id)
    // Environment child got a fresh id too.
    const clonedEnvs = (root[1] as unknown as { environments: { id: string }[] }).environments
    expect(clonedEnvs[0]?.id).not.toBe('e1')
  })
})
