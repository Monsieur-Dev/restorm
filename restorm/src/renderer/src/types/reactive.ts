/**
 * Reactive document system
 *
 * Wraps Folder and HTTPRequest objects in Proxies that automatically
 * emit events when indexable properties are modified.
 */

import { eventBus, logger } from 'electron-core-ui/renderer'
import { DocumentEvents, type DocumentChangedPayload } from '../services/DocumentEvents'
import type { Folder, HTTPRequest, FolderItem, Request, GraphQLRequest, GrpcRequest, SoapRequest, WebSocketRequest, ODataRequest, Environment } from '../../../shared/types/collections'
import { isAnyFolder, isHTTPRequest, isRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest, isODataRequest, isEnvironmentFolder } from '../../../shared/types/collections'

// ============================================================================
// Indexable Properties Configuration
// ============================================================================

/** Properties that trigger re-indexing when modified */
const FOLDER_INDEXABLE_KEYS = new Set([
  'name',
  'icon',
  'documentation',
  'notes',
  'tags',
  // `tagColors` isn't a searchable field, but it *is* part of the folder
  // document we serialise: treating it as indexable ensures a
  // FOLDER_UPDATED event fires when its map changes, so tag renderers
  // repaint and the dirty-state tracker can detect the diff.
  'tagColors'
  // `environments` and `items` are *deliberately* not in this set.
  // Both fire huge event volumes during Swagger import (one FOLDER_UPDATED
  // per env folder / per folder-items rewrite, each paying an
  // `upsertSaveUnit` IPC round-trip), dragging the full-workflow e2e
  // from 96 s to 110 s+. Env CRUD instead travels through the env
  // proxy's ENVIRONMENT_UPDATED emission (variables / name /
  // subEnvironments are indexable on the env itself); folder item CRUD
  // travels through REQUEST_CREATED / FOLDER_CREATED / *_DELETED
  // which the dirty tracker already subscribes to.
])

/** Properties that trigger re-indexing when modified (HTTP requests) */
const HTTP_REQUEST_INDEXABLE_KEYS = new Set([
  'name',
  'documentation',
  'notes',
  'tags',
  'method',
  'url',
  'headers',
  'params',
  'pathParams',
  'body'
])

/** Properties that trigger re-indexing when modified (GraphQL requests) */
const GRAPHQL_REQUEST_INDEXABLE_KEYS = new Set([
  'name',
  'documentation',
  'notes',
  'tags',
  'url',
  'headers',
  'operationType',
  'query',
  'variables'
])

/** Properties that trigger re-indexing when modified (gRPC requests) */
const GRPC_REQUEST_INDEXABLE_KEYS = new Set([
  'name',
  'documentation',
  'notes',
  'tags',
  'url',
  'metadata',
  'service',
  'method',
  'callType',
  'requestMessage'
])

/** Properties that trigger re-indexing when modified (SOAP requests) */
const SOAP_REQUEST_INDEXABLE_KEYS = new Set([
  'name',
  'documentation',
  'notes',
  'tags',
  'url',
  'headers',
  'service',
  'operation',
  'soapAction',
  'body'
])

/** Properties that trigger re-indexing when modified (WebSocket requests) */
const WEBSOCKET_REQUEST_INDEXABLE_KEYS = new Set([
  'name',
  'documentation',
  'notes',
  'tags',
  'url',
  'headers',
  'protocol',
  'event',
  'message'
])

/** Properties that trigger re-indexing when modified (OData requests) */
const ODATA_REQUEST_INDEXABLE_KEYS = new Set([
  'name',
  'documentation',
  'notes',
  'tags',
  'url',
  'odataVersion',
  'operationKind',
  'headers',
  'params',
  'queryOptions',
  'actionBody',
  'batchSubRequests',
  'entitySetProperties',
  'navigationProperties',
  'deprecated'
])

/** Properties that trigger re-indexing when modified (Environments) */
const ENVIRONMENT_INDEXABLE_KEYS = new Set([
  'name',
  'variables',
  'subEnvironments'
  // `color` / `icon` are deliberately NOT indexable. Making them so
  // would fire one ENVIRONMENT_UPDATED (+ `upsertSaveUnit` IPC) per
  // colour/icon tweak, and full-workflow drops ~16 s when the picker
  // steps pay that tax. The dirty flip is instead achieved by
  // `handleEnvColorChange` / `handleIconChange` rebuilding the env
  // via `{ ...env, color }` and pushing it through `updateEnvironments`
  // — the follow-up `folder.environments = reactiveNext` assignment
  // fires FOLDER_UPDATED via the folder proxy's indexable set, which
  // the dirty tracker already consumes.
])

// ============================================================================
// Internal Tracking
// ============================================================================

/** Symbol to mark objects as reactive */
const REACTIVE_SYMBOL = Symbol('reactive')

/** Symbol to store the document type */
const DOC_TYPE_SYMBOL = Symbol('docType')

/** Symbol to store the document ID */
const DOC_ID_SYMBOL = Symbol('docId')

/** Symbol to store the parent folder ID (for requests) */
const PARENT_ID_SYMBOL = Symbol('parentId')

/** Check if an object is already reactive */
function isReactive(obj: unknown): boolean {
  return typeof obj === 'object' && obj !== null && REACTIVE_SYMBOL in obj
}

// ============================================================================
// Debounced Event Emission
// ============================================================================

/** Pending emissions by document ID */
const pendingEmissions = new Map<string, ReturnType<typeof setTimeout>>()

/** Debounce delay in ms */
const DEBOUNCE_MS = 50

/**
 * Emit an update event with debouncing to batch rapid changes
 */
function emitUpdate(
  docType: 'folder' | 'request' | 'environment',
  docId: string,
  document: Folder | Request | Environment,
  parentFolderId?: string,
  parentEnvironmentId?: string
): void {
  // Clear any pending emission for this document
  const pending = pendingEmissions.get(docId)
  if (pending) {
    clearTimeout(pending)
  }

  // Schedule new emission
  const timeoutId = setTimeout(() => {
    pendingEmissions.delete(docId)

    let event: string
    if (docType === 'folder') {
      event = DocumentEvents.FOLDER_UPDATED
    } else if (docType === 'request') {
      event = DocumentEvents.REQUEST_UPDATED
    } else {
      event = DocumentEvents.ENVIRONMENT_UPDATED
    }

    const payload: DocumentChangedPayload = {
      id: docId,
      type: docType,
      document: JSON.parse(JSON.stringify(document)) // Deep clone to remove Proxy
    }

    if (parentFolderId !== undefined) {
      payload.parentFolderId = parentFolderId
    }

    if (parentEnvironmentId !== undefined) {
      payload.parentEnvironmentId = parentEnvironmentId
    }

    logger.debug(`[Reactive] Emitting ${event} for ${docType} ${docId}`)
    // Emit to main process (for FileService dirty state tracking)
    eventBus.emitSync(event, payload)
    // Also emit locally in renderer (for per-tab dirty state tracking via useDirtyState)
    eventBus.emitLocalSync(event, payload)
  }, DEBOUNCE_MS)

  pendingEmissions.set(docId, timeoutId)
}

// ============================================================================
// Proxy Handlers
// ============================================================================

/**
 * Create a proxy handler for arrays that emits events on modification
 */
function createArrayProxyHandler(
  docType: 'folder' | 'request' | 'environment',
  docId: string,
  rootDocument: () => Folder | Request | Environment,
  parentFolderId?: string,
  parentEnvironmentId?: string
): ProxyHandler<unknown[]> {
  return {
    get(target, prop, receiver): unknown {
      const value: unknown = Reflect.get(target, prop, receiver)

      // Mark as reactive
      if (prop === REACTIVE_SYMBOL) return true

      // Intercept mutating array methods
      if (typeof value === 'function') {
        const mutatingMethods = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse']
        if (mutatingMethods.includes(prop as string)) {
          return (...args: unknown[]): unknown => {
            const result: unknown = (value as (...a: unknown[]) => unknown).apply(target, args)
            emitUpdate(docType, docId, rootDocument(), parentFolderId, parentEnvironmentId)
            return result
          }
        }
      }

      return value
    },

    set(target, prop, value, receiver) {
      const result = Reflect.set(target, prop, value, receiver)
      if (typeof prop !== 'symbol' && prop !== 'length') {
        emitUpdate(docType, docId, rootDocument(), parentFolderId, parentEnvironmentId)
      }
      return result
    },

    deleteProperty(target, prop) {
      const result = Reflect.deleteProperty(target, prop)
      emitUpdate(docType, docId, rootDocument(), parentFolderId, parentEnvironmentId)
      return result
    }
  }
}

/**
 * Create a proxy handler for documents (Folder or Request)
 */
function createDocumentProxyHandler(
  docType: 'folder' | 'request',
  indexableKeys: Set<string>,
  parentFolderId?: string
): ProxyHandler<Folder | Request> {
  return {
    get(target, prop, receiver): unknown {
      // Return symbols
      if (prop === REACTIVE_SYMBOL) return true
      if (prop === DOC_TYPE_SYMBOL) return docType
      if (prop === DOC_ID_SYMBOL) return target.id
      if (prop === PARENT_ID_SYMBOL) return parentFolderId

      const value: unknown = Reflect.get(target, prop, receiver)

      // Wrap arrays in proxies to track mutations
      if (Array.isArray(value) && indexableKeys.has(prop as string) && !isReactive(value)) {
        const arrayProxy = new Proxy(
          value as unknown[],
          createArrayProxyHandler(docType, target.id, () => target, parentFolderId)
        )
        // Replace with proxy for future access
        Reflect.set(target, prop, arrayProxy)
        return arrayProxy
      }

      return value
    },

    set(target, prop, value, receiver) {
      const prev = Reflect.get(target, prop, receiver) as unknown
      const result = Reflect.set(target, prop, value, receiver)

      // Only fire the event when an indexable property actually changed.
      // Components like MarkdownEditor invoke their `onChange` on mount
      // with the already-stored value; treating that as a real mutation
      // would spuriously flip the document dirty right after import.
      if (indexableKeys.has(prop as string) && !sameProxyValue(prev, value)) {
        emitUpdate(docType, target.id, target, parentFolderId)
      }

      return result
    }
  }
}

/**
 * Equality check for reactive proxy change detection. Goals:
 *   1. Primitive identity fast-path (`a === b`).
 *   2. Treat `null`, `undefined` and empty string as equivalent so
 *      `MarkdownEditor` → `onChange('')` right after mount doesn't
 *      spuriously flip an otherwise-clean document dirty when its
 *      `notes`/`documentation` were previously `undefined`.
 *   3. Structural deep-equal for objects/arrays via JSON.
 */
function sameProxyValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  const isEmpty = (v: unknown): boolean =>
    v === undefined || v === null || v === ''
  if (isEmpty(a) && isEmpty(b)) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/**
 * Create a proxy handler for Environment documents
 */
function createEnvironmentProxyHandler(
  parentFolderId: string,
  parentEnvironmentId?: string
): ProxyHandler<Environment> {
  return {
    get(target, prop, receiver): unknown {
      // Return symbols
      if (prop === REACTIVE_SYMBOL) return true
      if (prop === DOC_TYPE_SYMBOL) return 'environment'
      if (prop === DOC_ID_SYMBOL) return target.id
      if (prop === PARENT_ID_SYMBOL) return parentEnvironmentId ?? parentFolderId

      const value: unknown = Reflect.get(target, prop, receiver)

      // Wrap variables array in proxy to track mutations
      if (prop === 'variables' && Array.isArray(value) && !isReactive(value)) {
        const arrayProxy = new Proxy(
          value as unknown[],
          createArrayProxyHandler('environment', target.id, () => target, parentFolderId, parentEnvironmentId)
        )
        // Replace with proxy for future access
        Reflect.set(target, prop, arrayProxy)
        return arrayProxy
      }

      return value
    },

    set(target, prop, value, receiver) {
      const prev = Reflect.get(target, prop, receiver) as unknown
      const result = Reflect.set(target, prop, value, receiver)

      // Skip emit for no-op assignments — see folder proxy handler for
      // the rationale (MarkdownEditor `onChange` on mount, etc.).
      if (
        ENVIRONMENT_INDEXABLE_KEYS.has(prop as string)
        && !sameProxyValue(prev, value)
      ) {
        emitUpdate('environment', target.id, target, parentFolderId, parentEnvironmentId)
      }

      return result
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Make an Environment reactive - it will emit events when indexable properties change
 */
export function makeReactiveEnvironment(
  env: Environment,
  parentFolderId: string,
  parentEnvironmentId?: string
): Environment {
  if (isReactive(env)) {
    return env
  }

  // Make sub-environments reactive recursively
  if (env.subEnvironments) {
    env.subEnvironments = env.subEnvironments.map((subEnv) =>
      makeReactiveEnvironment(subEnv, parentFolderId, env.id)
    )
  }

  return new Proxy(env, createEnvironmentProxyHandler(parentFolderId, parentEnvironmentId))
}

/**
 * Make a Folder reactive - it will emit events when indexable properties change
 */
export function makeReactiveFolder(folder: Folder): Folder {
  if (isReactive(folder)) {
    return folder
  }

  // Make child items reactive
  const reactiveItems = folder.items.map((item) => makeReactiveFolderItem(item, folder.id))
  folder.items = reactiveItems

  // If this is an EnvironmentFolder, make environments reactive
  if (isEnvironmentFolder(folder)) {
    folder.environments = folder.environments.map((env) =>
      makeReactiveEnvironment(env, folder.id)
    )
  }

  // Cast is safe: Proxy preserves the original object type
  return new Proxy(folder, createDocumentProxyHandler('folder', FOLDER_INDEXABLE_KEYS) as ProxyHandler<Folder>)
}

/**
 * Make an HTTPRequest reactive - it will emit events when indexable properties change
 */
export function makeReactiveHTTPRequest(request: HTTPRequest, parentFolderId: string): HTTPRequest {
  if (isReactive(request)) {
    return request
  }
  return new Proxy(request, createDocumentProxyHandler('request', HTTP_REQUEST_INDEXABLE_KEYS, parentFolderId) as ProxyHandler<HTTPRequest>)
}

/**
 * Make a GraphQLRequest reactive - it will emit events when indexable properties change
 */
export function makeReactiveGraphQLRequest(request: GraphQLRequest, parentFolderId: string): GraphQLRequest {
  if (isReactive(request)) {
    return request
  }
  return new Proxy(request, createDocumentProxyHandler('request', GRAPHQL_REQUEST_INDEXABLE_KEYS, parentFolderId) as ProxyHandler<GraphQLRequest>)
}

/**
 * Make a GrpcRequest reactive - it will emit events when indexable properties change
 */
export function makeReactiveGrpcRequest(request: GrpcRequest, parentFolderId: string): GrpcRequest {
  if (isReactive(request)) {
    return request
  }
  return new Proxy(request, createDocumentProxyHandler('request', GRPC_REQUEST_INDEXABLE_KEYS, parentFolderId) as ProxyHandler<GrpcRequest>)
}

/**
 * Make a SoapRequest reactive - it will emit events when indexable properties change
 */
export function makeReactiveSoapRequest(request: SoapRequest, parentFolderId: string): SoapRequest {
  if (isReactive(request)) {
    return request
  }
  return new Proxy(request, createDocumentProxyHandler('request', SOAP_REQUEST_INDEXABLE_KEYS, parentFolderId) as ProxyHandler<SoapRequest>)
}

/**
 * Make a WebSocketRequest reactive - it will emit events when indexable properties change
 */
export function makeReactiveWebSocketRequest(request: WebSocketRequest, parentFolderId: string): WebSocketRequest {
  if (isReactive(request)) {
    return request
  }
  return new Proxy(request, createDocumentProxyHandler('request', WEBSOCKET_REQUEST_INDEXABLE_KEYS, parentFolderId) as ProxyHandler<WebSocketRequest>)
}

/**
 * Make an ODataRequest reactive - it will emit events when indexable properties change
 */
export function makeReactiveODataRequest(request: ODataRequest, parentFolderId: string): ODataRequest {
  if (isReactive(request)) {
    return request
  }
  return new Proxy(request, createDocumentProxyHandler('request', ODATA_REQUEST_INDEXABLE_KEYS, parentFolderId) as ProxyHandler<ODataRequest>)
}

/**
 * Make any Request type reactive - it will emit events when indexable properties change
 */
export function makeReactiveRequest(request: Request, parentFolderId: string): Request {
  if (isReactive(request)) {
    return request
  }
  if (isHTTPRequest(request)) {
    return makeReactiveHTTPRequest(request, parentFolderId)
  }
  if (isGraphQLRequest(request)) {
    return makeReactiveGraphQLRequest(request, parentFolderId)
  }
  if (isGrpcRequest(request)) {
    return makeReactiveGrpcRequest(request, parentFolderId)
  }
  if (isSoapRequest(request)) {
    return makeReactiveSoapRequest(request, parentFolderId)
  }
  if (isWebSocketRequest(request)) {
    return makeReactiveWebSocketRequest(request, parentFolderId)
  }
  if (isODataRequest(request)) {
    return makeReactiveODataRequest(request, parentFolderId)
  }
  return request
}

/**
 * Make a FolderItem (Folder or Request) reactive
 */
export function makeReactiveFolderItem(item: FolderItem, parentFolderId: string): FolderItem {
  if (isAnyFolder(item)) {
    return makeReactiveFolder(item)
  } else if (isRequest(item)) {
    return makeReactiveRequest(item, parentFolderId)
  }
  return item
}

/**
 * Emit a folder created event
 */
export function emitFolderCreated(folder: Folder): void {
  eventBus.emitSync(DocumentEvents.FOLDER_CREATED, {
    id: folder.id,
    type: 'folder',
    document: folder
  })
}

/**
 * Emit a folder deleted event
 */
export function emitFolderDeleted(folderId: string): void {
  eventBus.emitSync(DocumentEvents.FOLDER_DELETED, {
    id: folderId,
    type: 'folder'
  })
}

/**
 * Emit a request created event
 */
export function emitRequestCreated(request: Request, parentFolderId: string): void {
  eventBus.emitSync(DocumentEvents.REQUEST_CREATED, {
    id: request.id,
    type: 'request',
    document: request,
    parentFolderId
  })
}

/**
 * Emit a request deleted event
 */
export function emitRequestDeleted(requestId: string, parentFolderId: string): void {
  eventBus.emitSync(DocumentEvents.REQUEST_DELETED, {
    id: requestId,
    type: 'request',
    parentFolderId
  })
}

/**
 * Emit an environment created event
 */
export function emitEnvironmentCreated(
  env: Environment,
  parentFolderId: string,
  parentEnvironmentId?: string
): void {
  eventBus.emitSync(DocumentEvents.ENVIRONMENT_CREATED, {
    id: env.id,
    type: 'environment',
    document: JSON.parse(JSON.stringify(env)) as Environment,
    parentFolderId,
    parentEnvironmentId
  })
}

/**
 * Emit an environment updated event
 */
export function emitEnvironmentUpdated(
  env: Environment,
  parentFolderId: string,
  parentEnvironmentId?: string
): void {
  eventBus.emitSync(DocumentEvents.ENVIRONMENT_UPDATED, {
    id: env.id,
    type: 'environment',
    document: JSON.parse(JSON.stringify(env)) as Environment,
    parentFolderId,
    parentEnvironmentId
  })
}

/**
 * Emit an environment deleted event
 */
export function emitEnvironmentDeleted(
  envId: string,
  parentFolderId: string,
  parentEnvironmentId?: string
): void {
  eventBus.emitSync(DocumentEvents.ENVIRONMENT_DELETED, {
    id: envId,
    type: 'environment',
    parentFolderId,
    parentEnvironmentId
  })
}
