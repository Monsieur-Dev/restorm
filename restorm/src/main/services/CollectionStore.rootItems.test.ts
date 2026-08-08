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
import { isScenario, isRequest, isEnvironmentFolder, isFolder, Scenario } from '../../shared/models'

/** The root of the sidebar accepts more than collections: a scenario or a
 * request may sit there as a sibling of an env-folder. This is the plain,
 * IPC-shaped tree the renderer mirrors through `collections:sync`. */
function seedRootTree(): void {
  collectionStore.setCollections([
    {
      folderType: 'environment',
      id: 'coll',
      name: 'Collection',
      tags: [],
      items: [
        { type: 'scenario', id: 'nested-scn', name: 'Nested', tags: [], params: [], nodes: [], edges: [], items: [] }
      ],
      environments: []
    },
    {
      type: 'scenario',
      id: 'root-scn',
      name: 'Root scenario',
      tags: [],
      params: [{ id: 'p1', name: 'token', kind: 'string' }],
      nodes: [{ id: 'n1', kind: 'start', name: 'Start' }],
      edges: [{ id: 'e1', source: 'n1', target: 'n1' }],
      items: [{ type: 'http', id: 'scn-child-req', name: 'Child of the root scenario' }]
    },
    { type: 'http', id: 'root-req', name: 'Root request', url: 'https://example.test/ping' }
  ] as unknown as Parameters<typeof collectionStore.setCollections>[0])
}

describe('CollectionStore — non-collection items at the root of the tree', () => {
  beforeEach(() => { seedRootTree() })

  it('keeps a root-level scenario resolvable AS a scenario', () => {
    const found = collectionStore.findById('root-scn')
    expect(found).not.toBeNull()
    // The engine's `loadScenario` gate: found but rejected by `isScenario` is
    // indistinguishable from absent in its error message, so assert the guard.
    expect(found !== null && isScenario(found)).toBe(true)
    expect(found).toBeInstanceOf(Scenario)
  })

  it('preserves a root-level scenario\'s graph (nodes, edges, params)', () => {
    const scn = collectionStore.findById('root-scn') as Scenario | null
    expect(scn?.nodes.map((n) => n.id)).toEqual(['n1'])
    expect(scn?.edges.map((e) => e.id)).toEqual(['e1'])
    expect(scn?.params.map((p) => p.name)).toEqual(['token'])
  })

  it('descends into a root-level scenario\'s child items', () => {
    expect(collectionStore.findById('scn-child-req')?.id).toBe('scn-child-req')
    expect(collectionStore.findParentFolder('scn-child-req')?.id).toBe('root-scn')
  })

  it('keeps a root-level request resolvable AS a request', () => {
    const found = collectionStore.findById('root-req')
    expect(found).not.toBeNull()
    expect(found !== null && isRequest(found)).toBe(true)
    expect(found !== null && isEnvironmentFolder(found)).toBe(false)
  })

  it('still reifies a root collection as an env-folder', () => {
    const coll = collectionStore.findById('coll')
    expect(coll !== null && isEnvironmentFolder(coll)).toBe(true)
    // …and its nested scenario keeps working, as before.
    const nested = collectionStore.findById('nested-scn')
    expect(nested !== null && isScenario(nested)).toBe(true)
  })

  it('creates a scenario at the root when no parent is given, and it resolves AS a scenario', () => {
    // The sidebar can already create one there; the programmatic path must be
    // able to express the same placement, and what it creates has to be
    // resolvable — an unresolvable root scenario is the original defect.
    const created = collectionStore.createScenario(null, { name: 'Made at root' })
    expect(collectionStore.findParentFolder(created.id)).toBeNull()
    const found = collectionStore.findById(created.id)
    expect(found !== null && isScenario(found)).toBe(true)
    expect(collectionStore.getCollections().map((c) => c.id)).toContain(created.id)
  })

  it('creates a request at the root when no parent is given, and it resolves AS a request', () => {
    const created = collectionStore.createRequest(null, { type: 'http', name: 'Made at root' })
    expect(collectionStore.findParentFolder(created.id)).toBeNull()
    const found = collectionStore.findById(created.id)
    expect(found !== null && isRequest(found)).toBe(true)
  })

  // The headless load path (`loadProjectIntoStore`) calls this straight after
  // `setCollections`, with no renderer involved. It walks every root entry, so
  // a non-folder at the root reaches a helper written for folders. A scenario
  // whose `items` key is absent entirely (the shape `Scenario.fromPlain`
  // produces when the document has no children) is the sharp case: a guard
  // keyed on the key EXISTING would let it through and then iterate undefined.
  it('re-emits environments without tripping over non-folder root items', () => {
    collectionStore.setCollections([
      {
        folderType: 'environment',
        id: 'coll',
        name: 'Collection',
        tags: [],
        items: [],
        environments: [{ id: 'env-1', name: 'local', variables: [] }]
      },
      // No `items` key at all — not `items: []`.
      { type: 'scenario', id: 'bare-scn', name: 'Bare', tags: [], params: [], nodes: [], edges: [] },
      { type: 'http', id: 'bare-req', name: 'Bare request' }
    ] as unknown as Parameters<typeof collectionStore.setCollections>[0])

    expect(() => { collectionStore.reemitAllEnvironmentsCreated() }).not.toThrow()
    // …and the collection's environment was still re-emitted, so the guard
    // skipped the non-folders without skipping the real work.
    expect(collectionStore.findEnvironmentById('env-1')?.name).toBe('local')
  })

  it('resolves a root-level plain folder, a scenario and a request side by side', () => {
    // All three kinds the sidebar and the programmatic API can put at the root.
    // A guard that tolerates a scenario but chokes on a bare request (no
    // `items`) would pass a scenario-only test.
    collectionStore.setCollections([
      { id: 'plain', name: 'Plain folder', items: [], configuration: {} },
      { type: 'scenario', id: 'scn', name: 'Scn', tags: [], params: [], nodes: [], edges: [], items: [] },
      { type: 'http', id: 'req', name: 'Req' }
    ] as unknown as Parameters<typeof collectionStore.setCollections>[0])

    // A plain folder is its own root kind: `folderType` is the discriminator
    // every env-folder check relies on, so a folder without it stays a folder.
    const plain = collectionStore.findById('plain')
    expect(plain !== null && isFolder(plain)).toBe(true)
    expect(plain !== null && isEnvironmentFolder(plain)).toBe(false)
    const scn = collectionStore.findById('scn')
    expect(scn !== null && isScenario(scn)).toBe(true)
    const req = collectionStore.findById('req')
    expect(req !== null && isRequest(req)).toBe(true)
    // None of the three has a parent — the root is not a container.
    for (const id of ['plain', 'scn', 'req']) {
      expect(collectionStore.findParentFolder(id), `${id} should have no parent`).toBeNull()
    }
  })

  it('survives a root → folder → root round trip of the same scenario', () => {
    expect(collectionStore.moveItem('root-scn', 'coll', 0).ok).toBe(true)
    const inFolder = collectionStore.findById('root-scn')
    expect(inFolder !== null && isScenario(inFolder)).toBe(true)

    // Back to the root: `moveItem` can only target a container, so the trip
    // home goes through the same renderer mirror a drag to the root produces.
    const tree = JSON.parse(JSON.stringify(collectionStore.getCollections())) as unknown[]
    const coll = tree[0] as { items: { id: string }[] }
    const [moved] = coll.items.splice(coll.items.findIndex((i) => i.id === 'root-scn'), 1)
    tree.push(moved)
    collectionStore.setCollections(tree as Parameters<typeof collectionStore.setCollections>[0], 'user')

    const backAtRoot = collectionStore.findById('root-scn')
    expect(backAtRoot !== null && isScenario(backAtRoot)).toBe(true)
    expect(collectionStore.findParentFolder('root-scn')).toBeNull()
  })
})

describe('a plain folder at the root', () => {
  beforeEach(() => {
    collectionStore.setCollections([], 'file-load')
  })

  it('stays a plain folder instead of being coerced into a collection', () => {
    collectionStore.setCollections(
      [
        { id: 'plain-root', name: 'Plain root folder', configuration: {}, items: [] },
        { id: 'coll', name: 'A collection', folderType: 'environment', configuration: {}, items: [], environments: [] }
      ] as unknown as Parameters<typeof collectionStore.setCollections>[0],
      'file-load'
    )

    const [plain, collection] = collectionStore.getCollections()
    expect(isFolder(plain)).toBe(true)
    expect(isEnvironmentFolder(plain)).toBe(false)
    // the collection beside it is untouched
    expect(isEnvironmentFolder(collection)).toBe(true)
  })

  it('keeps the fields a picking reify used to drop', () => {
    collectionStore.setCollections(
      [
        {
          id: 'plain-root',
          name: 'Plain root folder',
          notes: 'kept',
          configuration: { someKey: 'kept' },
          items: []
        }
      ] as unknown as Parameters<typeof collectionStore.setCollections>[0],
      'file-load'
    )

    const [plain] = collectionStore.getCollections() as unknown as Record<string, unknown>[]
    expect(plain['notes']).toBe('kept')
    expect(plain['configuration']).toEqual({ someKey: 'kept' })
  })
})

describe('createFolder at the root honours the folder kind', () => {
  beforeEach(() => { collectionStore.setCollections([], 'file-load') })

  it('creates a plain folder at the root when asked for one', () => {
    const plain = collectionStore.createFolder(null, { name: 'Plain root' }, 'folder')
    expect(isFolder(plain)).toBe(true)
    expect(isEnvironmentFolder(plain)).toBe(false)
    expect(collectionStore.getCollections().map((c) => c.id)).toContain(plain.id)
  })

  it('still defaults to a collection at the root', () => {
    const coll = collectionStore.createFolder(null, { name: 'A collection' })
    expect(isEnvironmentFolder(coll)).toBe(true)
  })

  it('ignores the kind for a nested folder — only the root has two kinds', () => {
    const coll = collectionStore.createFolder(null, { name: 'Parent collection' })
    const nested = collectionStore.createFolder(coll.id, { name: 'Nested' }, 'env-folder')
    expect(isEnvironmentFolder(nested)).toBe(false)
    expect(isFolder(nested)).toBe(true)
  })
})
