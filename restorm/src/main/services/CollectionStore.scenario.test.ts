import { describe, it, expect, beforeEach, vi } from 'vitest'

// The store fires events through these on every mutation — stub them so the
// unit test exercises the tree logic in isolation.
vi.mock('electron-core-ui/main', () => ({
  eventBusService: { emit: vi.fn(() => Promise.resolve()) },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createPubSub: () => ({ publish: vi.fn(), asyncIterator: vi.fn() }),
  serializeWithDecorators: (_c: unknown, o: unknown) => o
}))

import { collectionStore } from './CollectionStore'

/** A plain (IPC-shaped) tree: an env-folder holding a scenario that itself
 * holds a child request, a child folder, and a nested sub-scenario. */
function seedTree(): void {
  collectionStore.setCollections([
    {
      folderType: 'environment',
      id: 'root',
      name: 'Root',
      tags: [],
      items: [
        {
          type: 'scenario',
          id: 'scn',
          name: 'Scenario',
          tags: [],
          params: [],
          nodes: [],
          edges: [],
          items: [
            { type: 'http', id: 'req-1', name: 'Child request' },
            { id: 'fld-1', name: 'Child folder', items: [], configuration: {} },
            { type: 'scenario', id: 'sub', name: 'Sub', tags: [], params: [], nodes: [], edges: [], items: [] }
          ]
        }
      ],
      environments: []
    }
  ] as unknown as Parameters<typeof collectionStore.setCollections>[0])
}

describe('CollectionStore — scenario behaves as a folder-like container', () => {
  beforeEach(() => { seedTree() })

  it('findById descends into a scenario\'s items', () => {
    expect(collectionStore.findById('req-1')?.id).toBe('req-1')
    expect(collectionStore.findById('fld-1')?.id).toBe('fld-1')
    expect(collectionStore.findById('sub')?.id).toBe('sub')
  })

  it('findParentFolder of a scenario-nested item returns the scenario', () => {
    expect(collectionStore.findParentFolder('req-1')?.id).toBe('scn')
    expect(collectionStore.findParentFolder('sub')?.id).toBe('scn')
  })

  it('deleteRequest removes a request nested in a scenario', () => {
    expect(collectionStore.deleteRequest('req-1')).toBe(true)
    expect(collectionStore.findById('req-1')).toBeNull()
  })

  it('createRequest adds a child request under a scenario', () => {
    const created = collectionStore.createRequest('scn', { type: 'http', name: 'New' })
    expect(collectionStore.findById(created.id)?.id).toBe(created.id)
    expect(collectionStore.findParentFolder(created.id)?.id).toBe('scn')
  })

  it('createFolder adds a child folder under a scenario', () => {
    const created = collectionStore.createFolder('scn', { name: 'Sub folder' })
    expect(collectionStore.findById(created.id)?.id).toBe(created.id)
    expect(collectionStore.findParentFolder(created.id)?.id).toBe('scn')
  })

  it('deleteScenario removes a sub-scenario nested in a scenario', () => {
    expect(collectionStore.deleteScenario('sub')).toBe(true)
    expect(collectionStore.findById('sub')).toBeNull()
    // The parent scenario survives.
    expect(collectionStore.findById('scn')?.id).toBe('scn')
  })

  it('moveRequest moves a request from a folder into a scenario', () => {
    collectionStore.createRequest('root', { type: 'http', id: 'mover', name: 'Mover' })
    collectionStore.moveRequest('mover', 'scn', 0)
    expect(collectionStore.findParentFolder('mover')?.id).toBe('scn')
  })
})

/** Read the ordered child ids of a container straight off the live tree. */
function childIds(containerId: string): string[] {
  const c = collectionStore.findById(containerId) as unknown as { items?: { id: string }[] } | null
  return (c?.items ?? []).map((i) => i.id)
}

describe('CollectionStore.moveItem — validated reparent + reorder', () => {
  beforeEach(() => { seedTree() })

  it('reparents a request into a scenario and reports the resolved position', () => {
    collectionStore.createRequest('root', { type: 'http', id: 'mover', name: 'Mover' })
    const r = collectionStore.moveItem('mover', 'scn', 0)
    expect(r.ok).toBe(true)
    expect(collectionStore.findParentFolder('mover')?.id).toBe('scn')
    if (r.ok) { expect(r.kind).toBe('request'); expect(r.parentId).toBe('scn'); expect(r.index).toBe(0) }
  })

  it('reparents a sub-scenario as the moved item (scenario → folder)', () => {
    // seedTree: scn contains the sub-scenario `sub` and the folder `fld-1`.
    // A Scenario has no `configuration` field, so it must NOT be routed through
    // moveFolder (whose isAnyFolder guard would drop it) — this proves the
    // direct-splice path moves scenarios.
    const r = collectionStore.moveItem('sub', 'fld-1', 0)
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.kind).toBe('scenario'); expect(r.parentId).toBe('fld-1') }
    expect(collectionStore.findParentFolder('sub')?.id).toBe('fld-1')
    expect(childIds('fld-1')).toEqual(['sub'])
    // It left its old parent (fld-1 itself stays under scn).
    expect(childIds('scn')).toEqual(['req-1', 'fld-1'])
  })

  it('reorders within the same parent when newParentId is omitted (fld-1 before req-1)', () => {
    expect(childIds('scn')).toEqual(['req-1', 'fld-1', 'sub'])
    const r = collectionStore.moveItem('fld-1', undefined, 0)
    expect(r.ok).toBe(true)
    expect(childIds('scn')).toEqual(['fld-1', 'req-1', 'sub'])
  })

  it('appends to the end when index is omitted', () => {
    collectionStore.createRequest('root', { type: 'http', id: 'mover', name: 'Mover' })
    const r = collectionStore.moveItem('mover', 'scn', undefined)
    expect(r.ok).toBe(true)
    const ids = childIds('scn')
    expect(ids[ids.length - 1]).toBe('mover')
  })

  it('rejects moving an item into itself or its own descendant (and never orphans it)', () => {
    const r = collectionStore.moveItem('scn', 'sub', 0) // sub is a descendant of scn
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/itself or its own descendant/)
    // Both survive — the rejected move mutated nothing.
    expect(collectionStore.findById('scn')?.id).toBe('scn')
    expect(collectionStore.findById('sub')?.id).toBe('sub')
  })

  it('rejects a destination that is not a container (a request)', () => {
    collectionStore.createRequest('root', { type: 'http', id: 'mover', name: 'Mover' })
    const r = collectionStore.moveItem('mover', 'req-1', 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not a container/)
  })

  it('rejects nesting an env-folder inside a scenario or another env-folder, at any depth', () => {
    collectionStore.setCollections([
      {
        folderType: 'environment', id: 'root', name: 'Root', tags: [], environments: [],
        items: [
          { type: 'scenario', id: 'scn', name: 'S', tags: [], params: [], nodes: [], edges: [], items: [] },
          { id: 'plain', name: 'Plain', items: [], configuration: {} }
        ]
      },
      { folderType: 'environment', id: 'env2', name: 'Env2', tags: [], items: [], environments: [] }
    ] as unknown as Parameters<typeof collectionStore.setCollections>[0])

    expect(collectionStore.moveItem('env2', 'scn', 0).ok).toBe(false)   // into a scenario
    expect(collectionStore.moveItem('env2', 'root', 0).ok).toBe(false)  // directly into an env-folder
    // 'plain' is a folder, but it lives INSIDE the 'root' env-folder → an
    // env-folder ancestor → still rejected (the "any depth" rule).
    const nested = collectionStore.moveItem('env2', 'plain', 0)
    expect(nested.ok).toBe(false)
    if (!nested.ok) expect(nested.error).toMatch(/env-folder/)
    // env2 untouched at root.
    expect(collectionStore.findParentFolder('env2')).toBeNull()
  })

  it('reorders two env-folders at the root level (omit newParentId → root reorder)', () => {
    collectionStore.setCollections([
      { folderType: 'environment', id: 'envA', name: 'A', tags: [], items: [], environments: [] },
      { folderType: 'environment', id: 'envB', name: 'B', tags: [], items: [], environments: [] }
    ] as unknown as Parameters<typeof collectionStore.setCollections>[0])

    // envB is a root item; omitting newParentId reorders it within the root.
    const r = collectionStore.moveItem('envB', undefined, 0)
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.kind).toBe('env-folder'); expect(r.parentId).toBeNull(); expect(r.index).toBe(0) }
    expect(collectionStore.getCollections().map((c) => c.id)).toEqual(['envB', 'envA'])
  })
})
