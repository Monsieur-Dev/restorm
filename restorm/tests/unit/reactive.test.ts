/**
 * Tests for the reactive document system
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock electron-core-ui/renderer
vi.mock('electron-core-ui/renderer', () => {
  const handlers = new Map<string, Set<(payload: unknown) => void>>()

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
      emitLocalSync: vi.fn(),
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
    searchService: {
      indexDocument: vi.fn(),
      indexDocuments: vi.fn(),
      removeDocument: vi.fn(),
      clearIndex: vi.fn()
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }
  }
})

import { eventBus, DocumentEvents } from 'electron-core-ui/renderer'

// Type the mocked eventBus
const mockedEventBus = eventBus as {
  emitSync: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  emit: ReturnType<typeof vi.fn>
}

// Type the mocked DocumentEvents
const mockedDocumentEvents = DocumentEvents as {
  FOLDER_CREATED: string
  FOLDER_UPDATED: string
  FOLDER_DELETED: string
  REQUEST_CREATED: string
  REQUEST_UPDATED: string
  REQUEST_DELETED: string
}
import {
  makeReactiveFolder,
  makeReactiveRequest,
  emitFolderCreated,
  emitFolderDeleted,
  emitRequestCreated,
  emitRequestDeleted
} from '../../src/renderer/src/types/reactive'
import type { Folder, HTTPRequest } from '../../src/shared/types/collections'

describe('Reactive Document System', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const createTestFolder = (): Folder => ({
    id: 'folder-1',
    name: 'Test Folder',
    documentation: 'Test documentation',
    tags: ['test'],
    configuration: { environments: [] },
    items: []
  })

  const createTestRequest = (): HTTPRequest => ({
    type: 'http',
    id: 'request-1',
    name: 'Test Request',
    documentation: 'Test request documentation',
    tags: ['api'],
    method: 'GET',
    url: 'https://api.example.com/test',
    headers: [],
    params: []
  })

  describe('makeReactiveFolder', () => {
    it('should emit FOLDER_UPDATED when name is changed', () => {
      const folder = createTestFolder()
      const reactiveFolder = makeReactiveFolder(folder)

      reactiveFolder.name = 'New Name'

      // Wait for debounce
      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
        mockedDocumentEvents.FOLDER_UPDATED,
        expect.objectContaining({
          id: 'folder-1',
          type: 'folder'
        })
      )
    })

    it('should emit FOLDER_UPDATED when notes is changed', () => {
      const folder = createTestFolder()
      const reactiveFolder = makeReactiveFolder(folder)

      reactiveFolder.notes = 'coucou'

      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
        mockedDocumentEvents.FOLDER_UPDATED,
        expect.objectContaining({
          id: 'folder-1',
          type: 'folder'
        })
      )
    })

    it('should emit FOLDER_UPDATED when documentation is changed', () => {
      const folder = createTestFolder()
      const reactiveFolder = makeReactiveFolder(folder)

      reactiveFolder.documentation = 'New documentation'

      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
        mockedDocumentEvents.FOLDER_UPDATED,
        expect.objectContaining({
          id: 'folder-1',
          type: 'folder'
        })
      )
    })

    it('should debounce rapid changes', () => {
      const folder = createTestFolder()
      const reactiveFolder = makeReactiveFolder(folder)

      reactiveFolder.name = 'Name 1'
      reactiveFolder.name = 'Name 2'
      reactiveFolder.name = 'Name 3'

      vi.advanceTimersByTime(100)

      // Should only emit once due to debouncing
      expect(mockedEventBus.emitSync).toHaveBeenCalledTimes(1)
    })
  })

  describe('makeReactiveRequest', () => {
    it('should emit REQUEST_UPDATED when name is changed', () => {
      const request = createTestRequest()
      const reactiveRequest = makeReactiveRequest(request, 'parent-folder-1')

      reactiveRequest.name = 'New Request Name'

      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
        mockedDocumentEvents.REQUEST_UPDATED,
        expect.objectContaining({
          id: 'request-1',
          type: 'request',
          parentFolderId: 'parent-folder-1'
        })
      )
    })

    it('should emit REQUEST_UPDATED when notes is changed', () => {
      const request = createTestRequest()
      const reactiveRequest = makeReactiveRequest(request, 'parent-folder-1')

      reactiveRequest.notes = 'coucou'

      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
        mockedDocumentEvents.REQUEST_UPDATED,
        expect.objectContaining({
          id: 'request-1',
          type: 'request'
        })
      )
    })

    it('should emit REQUEST_UPDATED when method is changed', () => {
      const request = createTestRequest()
      const reactiveRequest = makeReactiveRequest(request, 'parent-folder-1')

      reactiveRequest.method = 'POST'

      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
        mockedDocumentEvents.REQUEST_UPDATED,
        expect.objectContaining({
          id: 'request-1',
          type: 'request'
        })
      )
    })
  })

  describe('Manual event emission', () => {
    it('should emit FOLDER_CREATED event', () => {
      const folder = createTestFolder()
      emitFolderCreated(folder)

      expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
        mockedDocumentEvents.FOLDER_CREATED,
        expect.objectContaining({
          id: 'folder-1',
          type: 'folder',
          document: folder
        })
      )
    })

    it('should emit FOLDER_DELETED event', () => {
      emitFolderDeleted('folder-1')

      expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
        mockedDocumentEvents.FOLDER_DELETED,
        expect.objectContaining({
          id: 'folder-1',
          type: 'folder'
        })
      )
    })

    it('should emit REQUEST_CREATED event', () => {
      const request = createTestRequest()
      emitRequestCreated(request, 'parent-folder-1')

      expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
        mockedDocumentEvents.REQUEST_CREATED,
        expect.objectContaining({
          id: 'request-1',
          type: 'request',
          document: request,
          parentFolderId: 'parent-folder-1'
        })
      )
    })

    it('should emit REQUEST_DELETED event', () => {
      emitRequestDeleted('request-1', 'parent-folder-1')

      expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
        mockedDocumentEvents.REQUEST_DELETED,
        expect.objectContaining({
          id: 'request-1',
          type: 'request',
          parentFolderId: 'parent-folder-1'
        })
      )
    })
  })

  describe('Nested reactive items', () => {
    it('should make child requests reactive', () => {
      const request = createTestRequest()
      const folder: Folder = {
        ...createTestFolder(),
        items: [request]
      }

      const reactiveFolder = makeReactiveFolder(folder)
      const reactiveRequest = reactiveFolder.items[0] as HTTPRequest

      reactiveRequest.notes = 'test notes'

      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
        mockedDocumentEvents.REQUEST_UPDATED,
        expect.objectContaining({
          id: 'request-1',
          type: 'request'
        })
      )
    })
  })
})
