/**
 * Reactive document system
 *
 * Wraps Folder and HTTPRequest objects in Proxies that automatically
 * emit events when indexable properties are modified.
 */

import { eventBus, DocumentEvents, type DocumentChangedPayload, logger } from 'electron-core-ui/renderer'
import type { Folder, HTTPRequest, FolderItem, Request, GraphQLRequest, GrpcRequest, SoapRequest, WebSocketRequest } from './collections'
import { isAnyFolder, isHTTPRequest, isRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest } from './collections'

// ============================================================================
// Indexable Properties Configuration
// ============================================================================

/** Properties that trigger re-indexing when modified */
const FOLDER_INDEXABLE_KEYS = new Set([
  'name',
  'documentation',
  'notes',
  'tags'
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
  docType: 'folder' | 'request',
  docId: string,
  document: Folder | Request,
  parentFolderId?: string
): void {
  // Clear any pending emission for this document
  const pending = pendingEmissions.get(docId)
  if (pending) {
    clearTimeout(pending)
  }

  // Schedule new emission
  const timeoutId = setTimeout(() => {
    pendingEmissions.delete(docId)

    const event = docType === 'folder'
      ? DocumentEvents.FOLDER_UPDATED
      : DocumentEvents.REQUEST_UPDATED

    const payload: DocumentChangedPayload = {
      id: docId,
      type: docType,
      document
    }

    if (parentFolderId !== undefined) {
      payload.parentFolderId = parentFolderId
    }

    logger.debug(`[Reactive] Emitting ${event} for ${docType} ${docId}`)
    eventBus.emitSync(event, payload)
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
  docType: 'folder' | 'request',
  docId: string,
  rootDocument: () => Folder | Request,
  parentFolderId?: string
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
            emitUpdate(docType, docId, rootDocument(), parentFolderId)
            return result
          }
        }
      }

      return value
    },

    set(target, prop, value, receiver) {
      const result = Reflect.set(target, prop, value, receiver)
      if (typeof prop !== 'symbol' && prop !== 'length') {
        emitUpdate(docType, docId, rootDocument(), parentFolderId)
      }
      return result
    },

    deleteProperty(target, prop) {
      const result = Reflect.deleteProperty(target, prop)
      emitUpdate(docType, docId, rootDocument(), parentFolderId)
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
      const result = Reflect.set(target, prop, value, receiver)

      // Emit event if an indexable property changed
      if (indexableKeys.has(prop as string)) {
        emitUpdate(docType, target.id, target, parentFolderId)
      }

      return result
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

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
  eventBus.emitSync<DocumentChangedPayload>(DocumentEvents.FOLDER_CREATED, {
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
  eventBus.emitSync<DocumentChangedPayload>(DocumentEvents.REQUEST_CREATED, {
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

