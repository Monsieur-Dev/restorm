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
