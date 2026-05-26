import { describe, it, expect, vi, beforeEach } from 'vitest'

// The renderer service collects documents from the tree and ships them to main
// via `searchService.indexDocuments`. Mock that singleton so we can assert which
// documents the load-time walk produces. This is the path App.tsx drives on
// project load — the one that must descend scenarios.
const { indexDocuments } = vi.hoisted(() => ({ indexDocuments: vi.fn<(docs: { id: string }[]) => Promise<void>>() }))

vi.mock('electron-core-ui/renderer', () => ({
  searchService: {
    indexDocuments,
    indexDocument: vi.fn(),
    removeDocument: vi.fn(),
    registerCategories: vi.fn(),
    clearIndex: vi.fn()
  },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { searchIndexService } from './SearchIndexService'

type FolderArg = Parameters<typeof searchIndexService.indexFolderTree>[0]

const indexedIds = (): string[] => indexDocuments.mock.calls.flatMap((c) => c[0].map((d) => d.id))

describe('SearchIndexService (renderer) — scenario container indexing on load', () => {
  beforeEach(() => { indexDocuments.mockClear(); indexDocuments.mockResolvedValue(undefined) })

  it('indexes a request authored inside a scenario nested under a folder', async () => {
    const childRequest = { id: 'scn-req', name: 'Inside scenario', type: 'http', method: 'GET', url: '', headers: [], params: [], pathParams: [], tags: [] }
    const scenario = { type: 'scenario', id: 'scn', name: 'My scenario', tags: [], params: [], nodes: [], edges: [], items: [childRequest] }
    const folder = { id: 'env', name: 'Env', tags: [], configuration: {}, items: [scenario] }

    await searchIndexService.indexFolderTree(folder as unknown as FolderArg)

    expect(indexedIds()).toContain('scn-req')
  })

  it('indexes children of a root-level scenario via indexScenarioTree', async () => {
    const childRequest = { id: 'root-scn-req', name: 'Inside root scenario', type: 'http', method: 'GET', url: '', headers: [], params: [], pathParams: [], tags: [] }
    const scenario = { type: 'scenario', id: 'root-scn', name: 'Root scenario', tags: [], params: [], nodes: [], edges: [], items: [childRequest] }

    await searchIndexService.indexScenarioTree(scenario as unknown as Parameters<typeof searchIndexService.indexScenarioTree>[0])

    expect(indexedIds()).toContain('root-scn-req')
  })
})
