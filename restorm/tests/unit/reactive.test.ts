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
      REQUEST_DELETED: 'document:request:deleted',
      ENVIRONMENT_CREATED: 'document:environment:created',
      ENVIRONMENT_UPDATED: 'document:environment:updated',
      ENVIRONMENT_DELETED: 'document:environment:deleted'
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
  ENVIRONMENT_UPDATED: string
}
import {
  makeReactiveFolder,
  makeReactiveRequest,
  makeReactiveEnvironment,
  emitFolderCreated,
  emitFolderDeleted,
  emitRequestCreated,
  emitRequestDeleted
} from '../../src/renderer/src/types/reactive'
import type { Folder, HTTPRequest, EnvironmentFolder, Environment, Request } from '../../src/shared/types/collections'
import { StringValue } from '../../src/shared/types/valueTypes'

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
    tags: ['test'],
    configuration: { environments: [] },
    items: []
  })

  const createTestRequest = (): HTTPRequest => ({
    type: 'http',
    id: 'request-1',
    name: 'Test Request',
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

  describe('makeReactiveRequest — every request type emits on a type-specific edit', () => {
    // One representative UI-edited key per request type. A type missing
    // from the reactive dispatch (or a key missing from its indexable
    // set) stores the value SILENTLY: no REQUEST_UPDATED, document never
    // dirty, autosave never fires, edit lost on close.
    const CASES: { type: string; key: string; value: unknown }[] = [
      { type: 'http', key: 'followRedirects', value: false },
      { type: 'http', key: 'timeout', value: 5000 },
      { type: 'graphql', key: 'query', value: '{ hero { name } }' },
      { type: 'grpc', key: 'transport', value: 'grpc-web' },
      { type: 'soap', key: 'mockOperations', value: [{ name: 'op' }] },
      { type: 'websocket', key: 'mqttSubscribe', value: true },
      { type: 'websocket', key: 'qos', value: 1 },
      { type: 'odata', key: 'mockData', value: '{}' },
      { type: 'auth', key: 'expirationExpression', value: 'exp' },
      { type: 'sse', key: 'headers', value: [{ key: 'Accept', value: 'text/event-stream' }] },
      { type: 'stomp', key: 'sendDestination', value: '/queue/foo' },
      { type: 'jsonrpc', key: 'rpcId', value: '42' },
      { type: 'jsonrpcBatch', key: 'children', value: [] },
      { type: 'trpc', key: 'procedure', value: 'post.byId' },
      { type: 'amqp', key: 'routingKey', value: 'orders.created' },
      { type: 'redis', key: 'command', value: 'GET' },
      { type: 'kafka', key: 'topic', value: 'events' }
    ]

    for (const { type, key, value } of CASES) {
      it(`${type}: setting "${key}" emits REQUEST_UPDATED`, () => {
        const request = {
          type,
          id: `request-${type}`,
          name: `${type} request`,
          tags: [],
          url: 'proto://example'
        } as Request
        const reactiveRequest = makeReactiveRequest(request, 'parent-folder-1') as Record<string, unknown>

        reactiveRequest[key] = value

        vi.advanceTimersByTime(100)

        expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
          mockedDocumentEvents.REQUEST_UPDATED,
          expect.objectContaining({
            id: `request-${type}`,
            type: 'request'
          })
        )
      })
    }
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

    it('should emit REQUEST_UPDATED when followRedirects is toggled off', () => {
      // Optional execution options (`followRedirects?`, `timeout?`) never
      // exist on a fresh request object — the proxy must still treat their
      // first assignment as a real, indexable change. Left out of the
      // indexable set, the value is stored SILENTLY: no event, document
      // never dirty, autosave never fires, and the edit is lost on close.
      const request = createTestRequest()
      const reactiveRequest = makeReactiveRequest(request, 'parent-folder-1') as HTTPRequest

      reactiveRequest.followRedirects = false

      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
        mockedDocumentEvents.REQUEST_UPDATED,
        expect.objectContaining({
          id: 'request-1',
          type: 'request'
        })
      )
    })

    it('should emit REQUEST_UPDATED when timeout is set', () => {
      const request = createTestRequest()
      const reactiveRequest = makeReactiveRequest(request, 'parent-folder-1') as HTTPRequest

      reactiveRequest.timeout = 5000

      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
        mockedDocumentEvents.REQUEST_UPDATED,
        expect.objectContaining({
          id: 'request-1',
          type: 'request'
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

  describe('EnvironmentFolder reactivity', () => {
    const createTestEnvironmentFolder = (): EnvironmentFolder => ({
      id: 'envfolder-1',
      folderType: 'environment',
      fileFormatVersion: 1,
      name: 'Envs',
      tags: [],
      configuration: { environments: [] },
      items: [],
      environments: [
        { id: 'env-1', name: 'dev', variables: [] }
      ]
    })

    // `environments` and `items` are BOTH deliberately out of
    // FOLDER_INDEXABLE_KEYS: treating them as indexable flooded
    // `upsertSaveUnit` during Swagger import (one IPC per env folder
    // / folder items rewrite) and turned a 96 s e2e into 110 s+.
    // Env CRUD dirty-tracking instead rides on explicit emits
    // (`emitEnvironmentCreated` / `emitEnvironmentDeleted` /
    // `emitEnvironmentUpdated`) from the env-folder view, and on the
    // env proxy's own ENVIRONMENT_UPDATED emission for name / variables /
    // subEnvironments mutations. The three assertions below pin that
    // contract — any refactor that silently re-indexes these keys
    // would re-introduce the perf regression.
    it('does NOT emit FOLDER_UPDATED when the environments array is replaced', () => {
      const folder = createTestEnvironmentFolder()
      const reactiveFolder = makeReactiveFolder(folder) as EnvironmentFolder

      reactiveFolder.environments = [
        ...reactiveFolder.environments,
        { id: 'env-2', name: 'staging', variables: [] }
      ]

      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).not.toHaveBeenCalledWith(
        mockedDocumentEvents.FOLDER_UPDATED,
        expect.objectContaining({ id: 'envfolder-1', type: 'folder' })
      )
    })

    it('does NOT emit FOLDER_UPDATED when the items array is replaced', () => {
      const folder = createTestEnvironmentFolder()
      const reactiveFolder = makeReactiveFolder(folder)

      reactiveFolder.items = [createTestRequest()]

      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).not.toHaveBeenCalledWith(
        mockedDocumentEvents.FOLDER_UPDATED,
        expect.objectContaining({ id: 'envfolder-1', type: 'folder' })
      )
    })

    it('does NOT emit FOLDER_UPDATED when an environment is pushed onto environments', () => {
      const folder = createTestEnvironmentFolder()
      const reactiveFolder = makeReactiveFolder(folder) as EnvironmentFolder

      reactiveFolder.environments.push({ id: 'env-3', name: 'prod', variables: [] })

      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).not.toHaveBeenCalledWith(
        mockedDocumentEvents.FOLDER_UPDATED,
        expect.objectContaining({ id: 'envfolder-1', type: 'folder' })
      )
    })
  })

  describe('makeReactiveEnvironment', () => {
    it('emits ENVIRONMENT_UPDATED when the name is changed', () => {
      const env: Environment = { id: 'env-1', name: 'dev', variables: [] }
      const reactive = makeReactiveEnvironment(env, 'envfolder-1')

      reactive.name = 'development'

      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
        mockedDocumentEvents.ENVIRONMENT_UPDATED,
        expect.objectContaining({ id: 'env-1', type: 'environment', parentFolderId: 'envfolder-1' })
      )
    })

    // `color` / `icon` are deliberately NOT in ENVIRONMENT_INDEXABLE_KEYS —
    // the dirty flip for them travels through `folder.environments` being
    // re-assigned with a new POJO in `handleEnvColorChange` /
    // `handleIconChange`, which the folder-level proxy catches. Making
    // them indexable would emit one ENVIRONMENT_UPDATED per tweak and
    // tank the full-workflow import step (perf regression).
    it('does NOT emit ENVIRONMENT_UPDATED when color changes in place', () => {
      const env: Environment = { id: 'env-1', name: 'dev', variables: [] }
      const reactive = makeReactiveEnvironment(env, 'envfolder-1')

      reactive.color = '#ff8800'
      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).not.toHaveBeenCalledWith(
        mockedDocumentEvents.ENVIRONMENT_UPDATED,
        expect.objectContaining({ id: 'env-1', type: 'environment' })
      )
    })

    it('does NOT emit ENVIRONMENT_UPDATED when icon changes in place', () => {
      const env: Environment = { id: 'env-1', name: 'dev', variables: [] }
      const reactive = makeReactiveEnvironment(env, 'envfolder-1')

      reactive.icon = { type: 'codicon', value: 'globe' }
      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).not.toHaveBeenCalledWith(
        mockedDocumentEvents.ENVIRONMENT_UPDATED,
        expect.objectContaining({ id: 'env-1', type: 'environment' })
      )
    })

    it('emits ENVIRONMENT_UPDATED when a variable is pushed', () => {
      const env: Environment = { id: 'env-1', name: 'dev', variables: [] }
      const reactive = makeReactiveEnvironment(env, 'envfolder-1')

      reactive.variables.push({ key: 'API_URL', value: new StringValue('https://example.com') })

      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
        mockedDocumentEvents.ENVIRONMENT_UPDATED,
        expect.objectContaining({ id: 'env-1', type: 'environment' })
      )
    })

    it('tags a sub-environment with its parent environment id', () => {
      const env: Environment = {
        id: 'env-1',
        name: 'dev',
        variables: [],
        subEnvironments: [{ id: 'env-1-sub', name: 'sub', variables: [] }]
      }
      const reactive = makeReactiveEnvironment(env, 'envfolder-1')

      const subs = reactive.subEnvironments
      if (!subs) throw new Error('expected sub-environments on reactive env')
      subs[0].name = 'sub-renamed'

      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
        mockedDocumentEvents.ENVIRONMENT_UPDATED,
        expect.objectContaining({
          id: 'env-1-sub',
          type: 'environment',
          parentFolderId: 'envfolder-1',
          parentEnvironmentId: 'env-1'
        })
      )
    })

    // EnvironmentFolderView's tree rewriters (`addSubEnvironment`,
    // `deleteEnvironmentById`, etc.) spread `{...env}` on the path to
    // the changed node, which strips the proxy from ancestors. The
    // view's `updateEnvironments` helper re-wraps via
    // `makeReactiveEnvironment` before persisting — that call must
    // remain idempotent on an already-reactive subtree and still
    // proxify a plain ancestor while leaving reactive descendants
    // alone. This test locks both invariants.
    it('re-wraps a spread-stripped parent while preserving reactive children', () => {
      const original: Environment = {
        id: 'env-parent',
        name: 'parent',
        variables: [],
        subEnvironments: [{ id: 'env-child', name: 'child', variables: [] }]
      }
      const reactive = makeReactiveEnvironment(original, 'envfolder-1')
      const reactiveChild = reactive.subEnvironments?.[0]
      if (!reactiveChild) throw new Error('expected reactive child')

      // Simulate the spread-leak: build a fresh plain parent that
      // references the still-reactive child.
      const spreadParent: Environment = { ...reactive, subEnvironments: [reactiveChild] }
      const rewrapped = makeReactiveEnvironment(spreadParent, 'envfolder-1')

      // Mutating the re-wrapped parent must fire on the parent id.
      rewrapped.name = 'parent-renamed'
      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
        mockedDocumentEvents.ENVIRONMENT_UPDATED,
        expect.objectContaining({ id: 'env-parent', type: 'environment' })
      )

      // And mutations on the already-reactive child must still fire
      // on the child id (proving the re-wrap did not double-wrap and
      // shadow the inner proxy).
      mockedEventBus.emitSync.mockClear()
      const rewrappedChild = rewrapped.subEnvironments?.[0]
      if (!rewrappedChild) throw new Error('expected rewrapped child')
      rewrappedChild.name = 'child-renamed'
      vi.advanceTimersByTime(100)

      expect(mockedEventBus.emitSync).toHaveBeenCalledWith(
        mockedDocumentEvents.ENVIRONMENT_UPDATED,
        expect.objectContaining({ id: 'env-child', type: 'environment' })
      )
    })
  })
})
