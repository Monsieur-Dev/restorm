/**
 * Integration tests for search indexing with reactive documents
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Create a real search service implementation for testing
interface SearchDocument {
  id: string
  title: string
  description: string
  category: string
  icon: string
  keywords: string
  navigation: {
    type: string
    folderId: string
    requestId?: string
    path: string[]
  }
}


// Mock electron-core-ui/renderer with real search service
vi.mock('electron-core-ui/renderer', async () => {
  const handlers = new Map<string, Set<(payload: unknown) => void>>()

  // Import MiniSearch inside the factory
  const MiniSearchModule = await import('minisearch')
  const MiniSearchClass = MiniSearchModule.default

  interface MockSearchDocument {
    id: string
    title: string
    description: string
    category: string
    icon: string
    keywords: string
    navigation: {
      type: string
      folderId: string
      requestId?: string
      path: string[]
    }
  }

  let miniSearch = new MiniSearchClass<MockSearchDocument>({
    fields: ['title', 'description', 'keywords'],
    storeFields: ['title', 'description', 'category', 'icon', 'navigation'],
    searchOptions: {
      boost: { title: 2 },
      fuzzy: 0.2,
      prefix: true
    }
  })

  const searchService = {
    indexDocument(doc: MockSearchDocument): void {
      if (miniSearch.has(doc.id)) {
        miniSearch.discard(doc.id)
      }
      miniSearch.add(doc)
    },
    indexDocuments(docs: MockSearchDocument[]): void {
      for (const doc of docs) {
        if (miniSearch.has(doc.id)) {
          miniSearch.discard(doc.id)
        }
        miniSearch.add(doc)
      }
    },
    removeDocument(id: string): void {
      if (miniSearch.has(id)) {
        miniSearch.discard(id)
      }
    },
    search(query: string): MockSearchDocument[] {
      return miniSearch.search(query) as unknown as MockSearchDocument[]
    },
    clearIndex(): void {
      miniSearch = new MiniSearchClass<MockSearchDocument>({
        fields: ['title', 'description', 'keywords'],
        storeFields: ['title', 'description', 'category', 'icon', 'navigation'],
        searchOptions: {
          boost: { title: 2 },
          fuzzy: 0.2,
          prefix: true
        }
      })
    }
  }

  return {
    eventBus: {
      subscribe: vi.fn((event: string, handler: (payload: unknown) => void) => {
        if (!handlers.has(event)) {
          handlers.set(event, new Set())
        }
        const eventHandlers = handlers.get(event)
        if (eventHandlers) {
          eventHandlers.add(handler)
        }
        return {
          unsubscribe: (): void => {
            handlers.get(event)?.delete(handler)
          }
        }
      }),
      emitSync: vi.fn((event: string, payload: unknown) => {
        const eventHandlers = handlers.get(event)
        if (eventHandlers) {
          eventHandlers.forEach((h) => {
            h(payload)
          })
        }
      }),
      emit: vi.fn()
    },
    DocumentEvents: {
      FOLDER_CREATED: 'document:folder:created',
      FOLDER_UPDATED: 'document:folder:updated',
      FOLDER_DELETED: 'document:folder:deleted',
      REQUEST_CREATED: 'document:request:created',
      REQUEST_UPDATED: 'document:request:updated',
      REQUEST_DELETED: 'document:request:deleted'
    },
    searchService,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }
  }
})

import { searchService } from 'electron-core-ui/renderer'
import { importSwaggerFromJson } from '../../src/renderer/src/services/import/SwaggerImportService'
import { searchIndexService } from '../../src/renderer/src/services/SearchIndexService'
import { makeReactiveFolder } from '../../src/renderer/src/types/reactive'
import type { Folder, HTTPRequest } from '../../src/renderer/src/types/collections'
import { isAnyFolder, isRequest, isHTTPRequest } from '../../src/renderer/src/types/collections'
import swaggerPetstore from './swagger-petstore.json'

// Type the mocked search service
const mockedSearchService = searchService as {
  indexDocument: (doc: SearchDocument) => void
  indexDocuments: (docs: SearchDocument[]) => void
  removeDocument: (id: string) => void
  search: (query: string) => SearchDocument[]
  clearIndex: () => void
}

describe('Search Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockedSearchService.clearIndex()
    searchIndexService.initialize()
  })

  afterEach(() => {
    searchIndexService.destroy()
    vi.useRealTimers()
  })

  /**
   * Helper to find a request by name in a folder tree
   */
  function findRequestByName(folder: Folder, name: string): HTTPRequest | undefined {
    for (const item of folder.items) {
      if (isAnyFolder(item)) {
        const found = findRequestByName(item, name)
        if (found) return found
      } else if (isRequest(item) && isHTTPRequest(item) && item.name.includes(name)) {
        return item
      }
    }
    return undefined
  }

  it('should import swagger petstore and search for "store"', () => {
    // Import swagger
    const folder = importSwaggerFromJson(JSON.stringify(swaggerPetstore))

    // Make it reactive
    const reactiveFolder = makeReactiveFolder(folder)

    // Index it
    searchIndexService.indexFolderTree(reactiveFolder)

    // Search for "store"
    const results = mockedSearchService.search('store')

    // Should find results (petstore has "store" related endpoints)
    expect(results.length).toBeGreaterThan(0)
  })

  it('should reindex when notes are modified and find new content', () => {
    // Import swagger
    const folder = importSwaggerFromJson(JSON.stringify(swaggerPetstore))

    // Make it reactive
    const reactiveFolder = makeReactiveFolder(folder)

    // Index it
    searchIndexService.indexFolderTree(reactiveFolder)

    // Search for "restorm" - should NOT find anything
    let results = mockedSearchService.search('restorm')
    expect(results.length).toBe(0)

    // Find a request to modify (e.g., one with "pet" in the name)
    const request = findRequestByName(reactiveFolder, 'pet')
    if (!request) {
      throw new Error('Expected to find a request with "pet" in the name')
    }

    // Modify the notes to include "restorm"
    request.notes = 'This is a test note with restorm keyword'

    // Wait for debounce to trigger the reindex event
    vi.advanceTimersByTime(100)

    // Search for "restorm" - should find the modified request
    results = mockedSearchService.search('restorm')
    expect(results.length).toBe(1)
    expect(results[0].id).toBe(request.id)
  })

  it('should find multiple store-related items in petstore', () => {
    // Import swagger
    const folder = importSwaggerFromJson(JSON.stringify(swaggerPetstore))

    // Make it reactive
    const reactiveFolder = makeReactiveFolder(folder)

    // Index it
    searchIndexService.indexFolderTree(reactiveFolder)

    // Search for "store"
    const results = mockedSearchService.search('store')

    // Log what we found for debugging
    const titles = results.map((r) => r.title)

    // Petstore should have store-related endpoints
    expect(results.length).toBeGreaterThan(0)

    // Check that at least one result is store-related
    const hasStoreResult = titles.some(
      (t) => t.toLowerCase().includes('store') || t.toLowerCase().includes('inventory')
    )
    expect(hasStoreResult).toBe(true)
  })
})

