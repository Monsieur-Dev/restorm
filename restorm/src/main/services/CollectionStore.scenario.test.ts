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
      type: 'environment-folder',
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
