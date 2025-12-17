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
  logger
} from 'electron-core-ui/renderer'
import type { Folder, HTTPRequest } from '../types/collections'

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

/** Check if an item is an HTTPRequest */
function isHTTPRequest(item: unknown): item is HTTPRequest {
  return typeof item === 'object' && item !== null && 'method' in item && 'url' in item
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

function requestToSearchDocument(
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
    getBodyContent(request.body)
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
    } else if (isHTTPRequest(item)) {
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
        if (isHTTPRequest(payload.document) && payload.parentFolderId) {
          searchService.indexDocument(
            requestToSearchDocument(payload.document, payload.parentFolderId)
          )
        }
      })
    )

    this.subscriptions.push(
      eventBus.subscribe<DocumentChangedPayload>(DocumentEvents.REQUEST_UPDATED, (payload) => {
        logger.debug('[SearchIndexService] REQUEST_UPDATED received', { id: payload.id, parentFolderId: payload.parentFolderId })
        if (isHTTPRequest(payload.document) && payload.parentFolderId) {
          searchService.indexDocument(
            requestToSearchDocument(payload.document, payload.parentFolderId)
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

