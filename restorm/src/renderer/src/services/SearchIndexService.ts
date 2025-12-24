/**
 * SearchIndexService - Handles search indexing for Folder and HTTPRequest documents
 *
 * Listens to document events from the EventBus and updates the search index accordingly.
 */

import {
  eventBus,
  searchService,
  DocumentEvents,
  type DocumentChangedPayload,
  type DocumentDeletedPayload,
  type SearchDocument,
  type Subscription,
  type CategoryMeta,
  logger
} from 'electron-core-ui/renderer'

/** Search categories configuration for Restorm */
const RESTORM_SEARCH_CATEGORIES: Record<string, CategoryMeta> = {
  request: { label: 'search.categories.request', icon: 'cloud', order: 1 },
  folder: { label: 'search.categories.folder', icon: 'folder', order: 2 },
  environment: { label: 'search.categories.environment', icon: 'folder-library', order: 3 },
  settings: { label: 'search.categories.settings', icon: 'settings-gear', order: 4 },
  tag: { label: 'search.categories.tag', icon: 'tag', order: 5 }
}
import type { Folder, HTTPRequest, GraphQLRequest, GrpcRequest, SoapRequest, WebSocketRequest, Request } from '../types/collections'
import { isHTTPRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest, isRequest } from '../types/collections'

/** Metadata structure for search documents in restorm */
export interface RestormSearchMetadata {
  /** URL of the request */
  url?: string
  /** HTTP headers */
  headers?: { key: string; value: string }[]
  /** URL query parameters */
  params?: { key: string; value: string }[]
  /** URL path parameters */
  pathParams?: { key: string; value: string }[]
  /** Request body */
  body?: {
    type: 'text' | 'file' | 'form-data' | 'x-www-form-urlencoded'
    content?: string
    path?: string
    fields?: { key: string; value: string }[]
  }
  /** Tags */
  tags?: string[]
  /** Notes */
  notes?: string
}

/** Check if an item is a Folder */
function isFolder(item: unknown): item is Folder {
  return typeof item === 'object' && item !== null && 'items' in item && 'configuration' in item
}

/**
 * Convert a Folder to a SearchDocument
 */
function folderToSearchDocument(folder: Folder, parentPath: string[] = []): SearchDocument {
  return {
    id: folder.id,
    title: folder.name,
    ...(folder.documentation ? { description: folder.documentation } : {}),
    category: 'folder',
    icon: 'folder',
    keywords: folder.tags.join(' '),
    navigation: {
      type: 'folder',
      folderId: folder.id,
      path: [...parentPath, folder.id]
    },
    metadata: {
      tags: folder.tags,
      ...(folder.notes ? { notes: folder.notes } : {})
    }
  }
}

/**
 * Convert an HTTPRequest to a SearchDocument
 */
function getBodyContent(body: HTTPRequest['body']): string {
  if (!body) return ''
  switch (body.type) {
    case 'text':
      return body.content
    case 'file':
      return body.path
    case 'form-data':
    case 'x-www-form-urlencoded':
      return body.fields.map((f) => `${f.key} ${f.value}`).join(' ')
    default:
      return ''
  }
}

function httpRequestToSearchDocument(
  request: HTTPRequest,
  parentFolderId: string,
  parentPath: string[] = []
): SearchDocument {
  const keywords = [
    request.method,
    request.url,
    ...request.tags,
    ...request.headers.map((h) => `${h.key} ${h.value}`),
    ...request.params.map((p) => `${p.key} ${p.value}`),
    ...(request.pathParams?.map((p) => `${p.key} ${p.value}`) ?? []),
    getBodyContent(request.body),
    request.notes ?? ''
  ].join(' ')

  // Build body metadata
  let bodyMetadata: RestormSearchMetadata['body'] = undefined
  if (request.body) {
    switch (request.body.type) {
      case 'text':
        bodyMetadata = {
          type: 'text',
          content: request.body.content
        }
        break
      case 'file':
        bodyMetadata = {
          type: 'file',
          path: request.body.path
        }
        break
      case 'form-data':
      case 'x-www-form-urlencoded':
        bodyMetadata = {
          type: request.body.type,
          fields: request.body.fields.map((f) => ({
            key: f.key,
            value: f.value
          }))
        }
        break
    }
  }

  return {
    id: request.id,
    title: request.name,
    ...(request.documentation ? { description: request.documentation } : {}),
    category: 'request',
    icon: request.method.toLowerCase(),
    keywords,
    navigation: {
      type: 'request',
      folderId: parentFolderId,
      requestId: request.id,
      path: [...parentPath, request.id]
    },
    metadata: {
      requestType: 'http',
      method: request.method,
      url: request.url,
      headers: request.headers.map((h) => ({ key: h.key, value: h.value })),
      params: request.params.map((p) => ({ key: p.key, value: p.value })),
      ...(request.pathParams ? { pathParams: request.pathParams.map((p) => ({ key: p.key, value: p.value })) } : {}),
      ...(bodyMetadata ? { body: bodyMetadata } : {}),
      tags: request.tags,
      ...(request.notes ? { notes: request.notes } : {})
    }
  }
}

function graphqlRequestToSearchDocument(
  request: GraphQLRequest,
  parentFolderId: string,
  parentPath: string[] = []
): SearchDocument {
  const keywords = [
    'graphql',
    request.operationType,
    request.url,
    request.query,
    ...request.tags,
    ...request.headers.map((h) => `${h.key} ${h.value}`),
    request.variables ?? '',
    request.notes ?? ''
  ].join(' ')

  return {
    id: request.id,
    title: request.name,
    ...(request.documentation ? { description: request.documentation } : {}),
    category: 'request',
    icon: 'graphql',
    keywords,
    navigation: {
      type: 'request',
      folderId: parentFolderId,
      requestId: request.id,
      path: [...parentPath, request.id]
    },
    metadata: {
      requestType: 'graphql',
      url: request.url,
      operationType: request.operationType,
      query: request.query,
      ...(request.variables ? { variables: request.variables } : {}),
      headers: request.headers.map((h) => ({ key: h.key, value: h.value })),
      tags: request.tags,
      ...(request.notes ? { notes: request.notes } : {})
    }
  }
}

function grpcRequestToSearchDocument(
  request: GrpcRequest,
  parentFolderId: string,
  parentPath: string[] = []
): SearchDocument {
  const keywords = [
    'grpc',
    request.service,
    request.method,
    request.callType,
    request.url,
    request.requestMessage,
    ...request.tags,
    ...request.metadata.map((m) => `${m.key} ${m.value}`),
    request.notes ?? ''
  ].join(' ')

  return {
    id: request.id,
    title: request.name,
    ...(request.documentation ? { description: request.documentation } : {}),
    category: 'request',
    icon: 'grpc',
    keywords,
    navigation: {
      type: 'request',
      folderId: parentFolderId,
      requestId: request.id,
      path: [...parentPath, request.id]
    },
    metadata: {
      requestType: 'grpc',
      url: request.url,
      service: request.service,
      method: request.method,
      callType: request.callType,
      requestMessage: request.requestMessage,
      grpcMetadata: request.metadata.map((m) => ({ key: m.key, value: m.value })),
      tags: request.tags,
      ...(request.notes ? { notes: request.notes } : {})
    }
  }
}

function soapRequestToSearchDocument(
  request: SoapRequest,
  parentFolderId: string,
  parentPath: string[] = []
): SearchDocument {
  const keywords = [
    'soap',
    request.service,
    request.operation,
    request.soapAction,
    request.url,
    request.body,
    ...request.tags,
    ...request.headers.map((h) => `${h.key} ${h.value}`),
    request.notes ?? ''
  ].join(' ')

  return {
    id: request.id,
    title: request.name,
    ...(request.documentation ? { description: request.documentation } : {}),
    category: 'request',
    icon: 'soap',
    keywords,
    navigation: {
      type: 'request',
      folderId: parentFolderId,
      requestId: request.id,
      path: [...parentPath, request.id]
    },
    metadata: {
      requestType: 'soap',
      url: request.url,
      service: request.service,
      operation: request.operation,
      soapAction: request.soapAction,
      soapBody: request.body,
      headers: request.headers.map((h) => ({ key: h.key, value: h.value })),
      tags: request.tags,
      ...(request.notes ? { notes: request.notes } : {})
    }
  }
}

function websocketRequestToSearchDocument(
  request: WebSocketRequest,
  parentFolderId: string,
  parentPath: string[] = []
): SearchDocument {
  const keywords = [
    'websocket',
    request.protocol,
    request.url,
    request.event ?? '',
    request.message,
    ...request.tags,
    ...request.headers.map((h) => `${h.key} ${h.value}`),
    request.notes ?? ''
  ].join(' ')

  return {
    id: request.id,
    title: request.name,
    ...(request.documentation ? { description: request.documentation } : {}),
    category: 'request',
    icon: 'websocket',
    keywords,
    navigation: {
      type: 'request',
      folderId: parentFolderId,
      requestId: request.id,
      path: [...parentPath, request.id]
    },
    metadata: {
      requestType: 'websocket',
      url: request.url,
      protocol: request.protocol,
      ...(request.event ? { event: request.event } : {}),
      message: request.message,
      headers: request.headers.map((h) => ({ key: h.key, value: h.value })),
      tags: request.tags,
      ...(request.notes ? { notes: request.notes } : {})
    }
  }
}

function requestToSearchDocument(
  request: Request,
  parentFolderId: string,
  parentPath: string[] = []
): SearchDocument {
  if (isHTTPRequest(request)) {
    return httpRequestToSearchDocument(request, parentFolderId, parentPath)
  } else if (isGraphQLRequest(request)) {
    return graphqlRequestToSearchDocument(request, parentFolderId, parentPath)
  } else if (isGrpcRequest(request)) {
    return grpcRequestToSearchDocument(request, parentFolderId, parentPath)
  } else if (isSoapRequest(request)) {
    return soapRequestToSearchDocument(request, parentFolderId, parentPath)
  } else if (isWebSocketRequest(request)) {
    return websocketRequestToSearchDocument(request, parentFolderId, parentPath)
  }
  // Fallback for unknown types - should never happen but satisfies exhaustiveness
  const unknownRequest = request as { id: string; name: string; tags: string[] }
  return {
    id: unknownRequest.id,
    title: unknownRequest.name,
    category: 'request',
    icon: 'file',
    keywords: unknownRequest.name,
    navigation: {
      type: 'request',
      folderId: parentFolderId,
      requestId: unknownRequest.id,
      path: [...parentPath, unknownRequest.id]
    },
    metadata: { tags: unknownRequest.tags }
  }
}

/**
 * Recursively index a folder and all its contents
 */
function indexFolderRecursively(folder: Folder, parentPath: string[] = []): void {
  const currentPath = [...parentPath, folder.id]

  // Index the folder
  searchService.indexDocument(folderToSearchDocument(folder, parentPath))

  // Index all items
  for (const item of folder.items) {
    if (isFolder(item)) {
      indexFolderRecursively(item, currentPath)
    } else if (isRequest(item)) {
      searchService.indexDocument(requestToSearchDocument(item, folder.id, currentPath))
    }
  }
}

/**
 * Recursively remove a folder and all its contents from the index
 */
function removeFolderRecursively(folder: Folder): void {
  // Remove the folder
  searchService.removeDocument(folder.id)

  // Remove all items
  for (const item of folder.items) {
    if (isFolder(item)) {
      removeFolderRecursively(item)
    } else {
      searchService.removeDocument(item.id)
    }
  }
}

/**
 * SearchIndexService class - manages search index subscriptions
 */
class SearchIndexService {
  private subscriptions: Subscription[] = []
  private initialized = false

  /**
   * Initialize the service and start listening to events
   */
  initialize(): void {
    if (this.initialized) {
      return
    }

    // Register search categories
    searchService.registerCategories(RESTORM_SEARCH_CATEGORIES)

    // Subscribe to folder events
    this.subscriptions.push(
      eventBus.subscribe<DocumentChangedPayload>(DocumentEvents.FOLDER_CREATED, (payload) => {
        if (isFolder(payload.document)) {
          indexFolderRecursively(payload.document)
        }
      })
    )

    this.subscriptions.push(
      eventBus.subscribe<DocumentChangedPayload>(DocumentEvents.FOLDER_UPDATED, (payload) => {
        if (isFolder(payload.document)) {
          searchService.indexDocument(folderToSearchDocument(payload.document))
        }
      })
    )

    this.subscriptions.push(
      eventBus.subscribe<DocumentDeletedPayload>(DocumentEvents.FOLDER_DELETED, (payload) => {
        searchService.removeDocument(payload.id)
      })
    )

    // Subscribe to request events
    this.subscriptions.push(
      eventBus.subscribe<DocumentChangedPayload>(DocumentEvents.REQUEST_CREATED, (payload) => {
        const doc = payload.document as Request
        if (isRequest(doc) && payload.parentFolderId) {
          searchService.indexDocument(
            requestToSearchDocument(doc, payload.parentFolderId)
          )
        }
      })
    )

    this.subscriptions.push(
      eventBus.subscribe<DocumentChangedPayload>(DocumentEvents.REQUEST_UPDATED, (payload) => {
        logger.debug('[SearchIndexService] REQUEST_UPDATED received', { id: payload.id, parentFolderId: payload.parentFolderId })
        const doc = payload.document as Request
        if (isRequest(doc) && payload.parentFolderId) {
          searchService.indexDocument(
            requestToSearchDocument(doc, payload.parentFolderId)
          )
        }
      })
    )

    this.subscriptions.push(
      eventBus.subscribe<DocumentDeletedPayload>(DocumentEvents.REQUEST_DELETED, (payload) => {
        searchService.removeDocument(payload.id)
      })
    )

    this.initialized = true
  }

  /**
   * Cleanup subscriptions
   */
  destroy(): void {
    logger.debug('[SearchIndexService] destroy() called', { subscriptionsCount: this.subscriptions.length })
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe()
    }
    this.subscriptions = []
    this.initialized = false
  }

  /**
   * Index a folder tree (for initial load)
   */
  indexFolderTree(folder: Folder): void {
    indexFolderRecursively(folder)
  }

  /**
   * Remove a folder tree from the index
   */
  removeFolderTree(folder: Folder): void {
    removeFolderRecursively(folder)
  }

  /**
   * Clear the entire search index
   */
  clearIndex(): void {
    searchService.clearIndex()
  }
}

/** Singleton instance */
export const searchIndexService = new SearchIndexService()
