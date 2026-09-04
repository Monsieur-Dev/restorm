import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture what gets indexed. The service calls the `searchService` singleton
// from electron-core-ui/main; mock it (and the other runtime imports) so we can
// assert the indexing walk without a real search backend.
const { indexDocument, removeDocument } = vi.hoisted(() => ({
  indexDocument: vi.fn<(doc: { id: string }) => void>(),
  removeDocument: vi.fn<(id: string) => void>()
}))

vi.mock('electron-core-ui/main', () => ({
  searchService: {
    indexDocument,
    removeDocument,
    registerCategories: vi.fn(),
    clearIndex: vi.fn()
  },
  eventBusService: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('./CollectionStore', () => ({ pubsub: { publish: vi.fn() }, PUBSUB_TOPICS: {} }))

import { searchIndexService } from './SearchIndexService'

type FolderArg = Parameters<typeof searchIndexService.indexFolderTree>[0]

describe('SearchIndexService — scenario as a container', () => {
  beforeEach(() => { indexDocument.mockClear() })

  it('indexes a request authored inside a scenario (scenario is descended)', () => {
    const childRequest = { id: 'scn-req', name: 'Inside scenario', type: 'http', tags: [] }
    const scenario = { type: 'scenario', id: 'scn', name: 'My scenario', items: [childRequest] }
    const envFolder = { id: 'env', name: 'Env', tags: [], configuration: {}, items: [scenario] }

    searchIndexService.indexFolderTree(envFolder as unknown as FolderArg)

    const indexedIds = indexDocument.mock.calls.map((c) => c[0].id)
    expect(indexedIds).toContain('scn-req')
  })

  it('indexes a request nested in a sub-folder of a scenario', () => {
    const deep = { id: 'deep-req', name: 'Deep', type: 'http', tags: [] }
    const subFolder = { id: 'sub', name: 'Sub', tags: [], configuration: {}, items: [deep] }
    const scenario = { type: 'scenario', id: 'scn', name: 'My scenario', items: [subFolder] }
    const envFolder = { id: 'env', name: 'Env', tags: [], configuration: {}, items: [scenario] }

    searchIndexService.indexFolderTree(envFolder as unknown as FolderArg)

    const indexedIds = indexDocument.mock.calls.map((c) => c[0].id)
    expect(indexedIds).toContain('deep-req')
  })
})

describe('SearchIndexService — design indexing', () => {
  beforeEach(() => { indexDocument.mockClear(); removeDocument.mockClear() })

  const designWith = (models: { id: string; doc: { name: string }; properties: never[] }[]): Record<string, unknown> => ({
    type: 'design',
    id: 'dsg',
    name: 'Petstore design',
    tags: [],
    info: { title: 'Petstore' },
    models,
    enums: [],
    routeGroups: [{
      id: 'g1',
      doc: { name: 'Pets' },
      routes: [{ id: 'r1', doc: { summary: 'List pets', match: { urlPattern: '/pets', method: 'GET' } } }]
    }]
  })

  it('walks a design into composite-id documents without derailing sibling requests', () => {
    // Regression: the request guard ('type' in item && !('items' in
    // item)) also matches a design — before the design branch, the walk
    // crashed on protocolSpec('design') and lost the whole folder.
    const sibling = { id: 'req-after', name: 'After the design', type: 'http', tags: [] }
    const folder = { id: 'env', name: 'Env', tags: [], configuration: {}, items: [designWith([{ id: 'm1', doc: { name: 'Pet' }, properties: [] }]), sibling] }

    searchIndexService.indexFolderTree(folder as unknown as FolderArg)

    const indexedIds = indexDocument.mock.calls.map((c) => c[0].id)
    expect(indexedIds).toContain('dsg')
    expect(indexedIds).toContain('dsg::model:m1')
    expect(indexedIds).toContain('dsg::route:r1')
    expect(indexedIds).toContain('req-after')
  })

  it('sweeps stale entity documents on re-index (no phantom results)', () => {
    const folder = (design: Record<string, unknown>): FolderArg =>
      ({ id: 'env', name: 'Env', tags: [], configuration: {}, items: [design] }) as unknown as FolderArg
    searchIndexService.indexFolderTree(folder(designWith([{ id: 'm1', doc: { name: 'Pet' }, properties: [] }])))
    expect(indexDocument.mock.calls.map((c) => c[0].id)).toContain('dsg::model:m1')

    searchIndexService.indexFolderTree(folder(designWith([])))
    expect(removeDocument.mock.calls.map((c) => c[0])).toContain('dsg::model:m1')
  })
})
