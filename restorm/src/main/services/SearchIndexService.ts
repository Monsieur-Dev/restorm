/**
 * SearchIndexService - Handles search indexing for Folder and Request documents (Main Process)
 *
 * Listens to document events from the EventBus and updates the search index accordingly.
 * Runs in the main process to avoid blocking the UI.
 */

import {
  eventBusService,
  searchService,
  type SearchDocument,
  type Subscription,
  type CategoryMeta,
  logger
} from 'electron-core-ui/main'
import {
  DocumentEvents,
  type DocumentChangedPayload,
  type DocumentDeletedPayload
} from './DocumentEvents'
import { pubsub, PUBSUB_TOPICS } from './CollectionStore'

/** Search categories configuration for Restorm */
const RESTORM_SEARCH_CATEGORIES: Record<string, CategoryMeta> = {
  request: { label: 'search.categories.request', icon: 'cloud', order: 1 },
  folder: { label: 'search.categories.folder', icon: 'folder', order: 2 },
  environment: { label: 'search.categories.environment', icon: 'folder-library', order: 3 },
  settings: { label: 'search.categories.settings', icon: 'settings-gear', order: 4 },
  tag: { label: 'search.categories.tag', icon: 'tag', order: 5 }
}

/** Simplified folder type for indexing */
interface FolderData {
  id: string
  name: string
  tags: string[]
  notes?: string
  items: (FolderData | RequestData)[]
  configuration?: unknown
}

/** Simplified request type for indexing */
interface RequestData {
  id: string
  name: string
  type: 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket'
  tags: string[]
  notes?: string
  url?: string
  method?: string
  headers?: { key: string; value: string }[]
  params?: { key: string; value: string }[]
  pathParams?: { key: string; value: string }[]
  body?: {
    type: string
    content?: string
    path?: string
    fields?: { key: string; value: string }[]
  }
  // GraphQL specific
  operationType?: string
  query?: string
  variables?: string
  // gRPC specific
  service?: string
  callType?: string
  requestMessage?: string
  metadata?: { key: string; value: string }[]
  // SOAP specific
  operation?: string
  soapAction?: string
  // WebSocket specific
  protocol?: string
  event?: string
  message?: string
}

/** Check if an item is a Folder */
function isFolder(item: unknown): item is FolderData {
  return typeof item === 'object' && item !== null && 'items' in item && 'configuration' in item
}

/** Check if an item is a Request */
function isRequest(item: unknown): item is RequestData {
  return typeof item === 'object' && item !== null && 'type' in item && !('items' in item)
}

/** Simplified scenario type — a scenario doubles as a folder-like container,
 * so the indexer descends it to index the requests authored inside it. */
interface ScenarioData {
  type: 'scenario'
  id: string
  items?: (FolderData | RequestData | ScenarioData)[]
}

/** Check if an item is a Scenario (a container, but not a folder). */
function isScenarioData(item: unknown): item is ScenarioData {
  return typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'scenario'
}

/**
 * Convert a Folder to a SearchDocument
 */
function folderToSearchDocument(folder: FolderData, parentPath: string[] = []): SearchDocument {
  return {
    id: folder.id,
    title: folder.name,
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
 * Get body content for keywords
 */
function getBodyContent(body: RequestData['body']): string {
  if (!body) return ''
  switch (body.type) {
    case 'text':
      return body.content ?? ''
    case 'file':
      return body.path ?? ''
    case 'form-data':
    case 'x-www-form-urlencoded':
      return body.fields?.map((f) => `${f.key} ${f.value}`).join(' ') ?? ''
    default:
      return ''
  }
}

/**
 * Convert a Request to a SearchDocument
 */
function requestToSearchDocument(
  request: RequestData,
  parentFolderId: string,
  parentPath: string[] = []
): SearchDocument {
  const keywordParts: string[] = [
    request.type,
    request.url ?? '',
    ...request.tags,
    request.notes ?? ''
  ]

  // Add type-specific keywords
  if (request.method) keywordParts.push(request.method)
  if (request.headers) keywordParts.push(...request.headers.map((h) => `${h.key} ${h.value}`))
  if (request.params) keywordParts.push(...request.params.map((p) => `${p.key} ${p.value}`))
  if (request.pathParams) keywordParts.push(...request.pathParams.map((p) => `${p.key} ${p.value}`))
  if (request.body) keywordParts.push(getBodyContent(request.body))
  if (request.query) keywordParts.push(request.query)
  if (request.variables) keywordParts.push(request.variables)
  if (request.service) keywordParts.push(request.service)
  if (request.operation) keywordParts.push(request.operation)
  if (request.requestMessage) keywordParts.push(request.requestMessage)
  if (request.message) keywordParts.push(request.message)
  if (request.metadata) keywordParts.push(...request.metadata.map((m) => `${m.key} ${m.value}`))

  // Determine icon based on request type
  let icon = 'file'
  switch (request.type) {
    case 'http':
      icon = request.method?.toLowerCase() ?? 'get'
      break
    case 'graphql':
      icon = 'graphql'
      break
    case 'grpc':
      icon = 'grpc'
      break
    case 'soap':
      icon = 'soap'
      break
    case 'websocket':
      icon = 'websocket'
      break
  }

  return {
    id: request.id,
    title: request.name,
    category: 'request',
    icon,
    keywords: keywordParts.filter(Boolean).join(' '),
    navigation: {
      type: 'request',
      folderId: parentFolderId,
      requestId: request.id,
      path: [...parentPath, request.id]
    },
    metadata: {
      requestType: request.type,
      ...(request.url ? { url: request.url } : {}),
      ...(request.method ? { method: request.method } : {}),
      tags: request.tags,
      ...(request.notes ? { notes: request.notes } : {})
    }
  }
}

/**
 * Publish search index update to GraphQL subscribers
 */
function publishIndexUpdate(action: 'indexed' | 'removed', documentId: string, documentType: string): void {
  pubsub.publish(PUBSUB_TOPICS.SEARCH_INDEX_UPDATED, {
    action,
    documentId,
    documentType
  })
}

/**
 * Recursively index a folder and all its contents
 */
function indexFolderRecursively(folder: FolderData, parentPath: string[] = []): void {
  const currentPath = [...parentPath, folder.id]

  // Index the folder
  searchService.indexDocument(folderToSearchDocument(folder, parentPath))
  publishIndexUpdate('indexed', folder.id, 'folder')

  // Index all items
  for (const item of folder.items) {
    if (isFolder(item)) {
      indexFolderRecursively(item, currentPath)
    } else if (isScenarioData(item)) {
      indexScenarioRecursively(item, currentPath)
    } else if (isRequest(item)) {
      searchService.indexDocument(requestToSearchDocument(item, folder.id, currentPath))
      publishIndexUpdate('indexed', item.id, 'request')
    }
  }
}

/**
 * A scenario isn't a searchable document itself, but it's a container: descend
 * it so the requests (and sub-folders) authored inside it are indexed with the
 * scenario in their path — keeping scenario-child requests searchable after a
 * project is reopened, not just at creation time.
 */
function indexScenarioRecursively(scenario: ScenarioData, parentPath: string[] = []): void {
  const currentPath = [...parentPath, scenario.id]
  for (const item of scenario.items ?? []) {
    if (isFolder(item)) {
      indexFolderRecursively(item, currentPath)
    } else if (isScenarioData(item)) {
      indexScenarioRecursively(item, currentPath)
    } else if (isRequest(item)) {
      searchService.indexDocument(requestToSearchDocument(item, scenario.id, currentPath))
      publishIndexUpdate('indexed', item.id, 'request')
    }
  }
}

/**
 * Recursively remove a folder and all its contents from the index
 */
function removeFolderRecursively(folder: FolderData): void {
  // Remove the folder
  searchService.removeDocument(folder.id)
  publishIndexUpdate('removed', folder.id, 'folder')

  // Remove all items
  for (const item of folder.items) {
    if (isFolder(item)) {
      removeFolderRecursively(item)
    } else if (isScenarioData(item)) {
      removeScenarioRecursively(item)
    } else {
      searchService.removeDocument(item.id)
      publishIndexUpdate('removed', item.id, 'request')
    }
  }
}

/** Remove a scenario's indexed children (the scenario itself isn't indexed). */
function removeScenarioRecursively(scenario: ScenarioData): void {
  for (const item of scenario.items ?? []) {
    if (isFolder(item)) {
      removeFolderRecursively(item)
    } else if (isScenarioData(item)) {
      removeScenarioRecursively(item)
    } else {
      searchService.removeDocument(item.id)
      publishIndexUpdate('removed', item.id, 'request')
    }
  }
}

/**
 * SearchIndexService class - manages search index subscriptions (Main Process)
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

    logger.info('[SearchIndexService] Initializing...')

    // Register search categories
    searchService.registerCategories(RESTORM_SEARCH_CATEGORIES)

    // Subscribe to folder events
    this.subscriptions.push(
      eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.FOLDER_CREATED, (payload) => {
        logger.debug('[SearchIndexService] FOLDER_CREATED', { id: payload.id })
        if (isFolder(payload.document)) {
          indexFolderRecursively(payload.document)
        }
      })
    )

    this.subscriptions.push(
      eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.FOLDER_UPDATED, (payload) => {
        logger.debug('[SearchIndexService] FOLDER_UPDATED', { id: payload.id })
        if (isFolder(payload.document)) {
          // Re-index the whole subtree, not just the folder itself: a folder
          // update can be a MOVE, which changes the navigation.path of every
          // descendant. Indexing only the folder would leave children keyed on
          // a stale path. (Mirrors FOLDER_CREATED's recursive indexing.)
          indexFolderRecursively(payload.document)
        }
      })
    )

    this.subscriptions.push(
      eventBusService.subscribe<DocumentDeletedPayload>(DocumentEvents.FOLDER_DELETED, (payload) => {
        logger.debug('[SearchIndexService] FOLDER_DELETED', { id: payload.id })
        searchService.removeDocument(payload.id)
        publishIndexUpdate('removed', payload.id, 'folder')
      })
    )

    // Subscribe to request events
    this.subscriptions.push(
      eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.REQUEST_CREATED, (payload) => {
        logger.debug('[SearchIndexService] REQUEST_CREATED', { id: payload.id })
        if (isRequest(payload.document)) {
          // Root-level requests (created via the empty-area sidebar
          // context menu, attached auth routes at the top of a
          // collection, etc.) carry no `parentFolderId`. Mirror the
          // renderer's `indexRootRequest` shim and key the search
          // document on the request's own id so the entry still lands
          // in the index. Without this, search would silently lose
          // root-level requests on every CREATE / UPDATE.
          const parentId = payload.parentFolderId ?? payload.id
          searchService.indexDocument(
            requestToSearchDocument(payload.document, parentId)
          )
          publishIndexUpdate('indexed', payload.id, 'request')
        }
      })
    )

    this.subscriptions.push(
      eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.REQUEST_UPDATED, (payload) => {
        logger.debug('[SearchIndexService] REQUEST_UPDATED', { id: payload.id })
        if (isRequest(payload.document)) {
          const parentId = payload.parentFolderId ?? payload.id
          searchService.indexDocument(
            requestToSearchDocument(payload.document, parentId)
          )
          publishIndexUpdate('indexed', payload.id, 'request')
        }
      })
    )

    this.subscriptions.push(
      eventBusService.subscribe<DocumentDeletedPayload>(DocumentEvents.REQUEST_DELETED, (payload) => {
        logger.debug('[SearchIndexService] REQUEST_DELETED', { id: payload.id })
        searchService.removeDocument(payload.id)
        publishIndexUpdate('removed', payload.id, 'request')
      })
    )

    this.initialized = true
    logger.info('[SearchIndexService] Initialized successfully')
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
  indexFolderTree(folder: FolderData): void {
    indexFolderRecursively(folder)
  }

  /**
   * Remove a folder tree from the index
   */
  removeFolderTree(folder: FolderData): void {
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
