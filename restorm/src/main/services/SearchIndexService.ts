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
import { pubsub, PUBSUB_TOPICS, collectionStore } from './CollectionStore'
import { protocolSpec } from '../../shared/protocolRegistry'
import { DESIGN_CODICON } from '../../shared/design/designSections'
import { RECORDING_CODICON } from '../../shared/recording/recordingSections'
import { composeRoutePath, groupChainBasePath } from '../../shared/design/apiDesignDoc'

/** Search categories configuration for Restorm. Kept aligned with the
 * renderer's map (which re-registers over this one at file open). */
const RESTORM_SEARCH_CATEGORIES: Record<string, CategoryMeta> = {
  request: { label: 'search.categories.request', icon: 'cloud', order: 1 },
  folder: { label: 'search.categories.folder', icon: 'folder', order: 2 },
  scenario: { label: 'search.categories.scenario', icon: 'circuit-board', order: 3 },
  design: { label: 'search.categories.design', icon: DESIGN_CODICON, order: 4 },
  environment: { label: 'search.categories.environment', icon: 'folder-library', order: 5 },
  settings: { label: 'search.categories.settings', icon: 'settings-gear', order: 6 },
  tag: { label: 'search.categories.tag', icon: 'tag', order: 7 }
}

/** Simplified folder type for indexing */
interface FolderData {
  id: string
  name: string
  tags: string[]
  notes?: string
  items: (FolderData | RequestData | ScenarioData | DesignData | RecordingData)[]
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
  name?: string
  items?: (FolderData | RequestData | ScenarioData | DesignData | RecordingData)[]
}

/** Check if an item is a Scenario (a container, but not a folder). */
function isScenarioData(item: unknown): item is ScenarioData {
  return typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'scenario'
}

/** Simplified recording-session type — a container like a scenario (its
 * deduced routes live in `items`), indexed as one document of its own. */
interface RecordingData {
  type: 'recording'
  id: string
  name: string
  notes?: string
  url: string
  whitelist?: string[]
  blacklist?: string[]
  items?: (FolderData | RequestData | ScenarioData | DesignData | RecordingData)[]
}

/** Check if an item is a recording session. MUST run before `isRequest` in
 * every dispatch, for the same reason as `isApiDesignData`. */
function isRecordingData(item: unknown): item is RecordingData {
  return typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'recording'
}

function recordingToSearchDocument(session: RecordingData, parentPath: string[] = [], parentNames: string[] = []): SearchDocument {
  return {
    id: session.id,
    title: session.name,
    ...(session.url !== '' ? { description: session.url } : {}),
    category: 'recording',
    icon: RECORDING_CODICON,
    keywords: [session.url, ...(session.whitelist ?? []), ...(session.blacklist ?? [])].filter((s) => s !== '').join(' '),
    navigation: { type: 'recording', recordingId: session.id, path: [...parentPath, session.id] },
    metadata: {
      ...(session.notes ? { notes: session.notes } : {}),
      ...(parentNames.length > 0 ? { breadcrumb: parentNames } : {})
    }
  }
}

/** Index a recording session (one document) + its deduced routes. */
function indexRecordingRecursively(session: RecordingData, parentPath: string[] = [], parentNames: string[] = []): void {
  searchService.indexDocument(recordingToSearchDocument(session, parentPath, parentNames))
  publishIndexUpdate('indexed', session.id, 'recording')
  const currentPath = [...parentPath, session.id]
  const currentNames = [...parentNames, session.name]
  for (const item of session.items ?? []) {
    if (isFolder(item)) {
      indexFolderRecursively(item, currentPath, currentNames)
    } else if (isScenarioData(item)) {
      indexScenarioRecursively(item, currentPath, currentNames)
    } else if (isApiDesignData(item)) {
      indexDesignDocuments(item, currentPath, currentNames)
    } else if (isRecordingData(item)) {
      indexRecordingRecursively(item, currentPath, currentNames)
    } else if (isRequest(item)) {
      searchService.indexDocument(requestToSearchDocument(item, session.id, currentPath))
      publishIndexUpdate('indexed', item.id, 'request')
    }
  }
}

/** Remove a recording session's document + its deduced routes. */
function removeRecordingRecursively(session: RecordingData): void {
  searchService.removeDocument(session.id)
  publishIndexUpdate('removed', session.id, 'recording')
  for (const item of session.items ?? []) {
    if (isFolder(item)) {
      removeFolderRecursively(item)
    } else if (isScenarioData(item)) {
      removeScenarioRecursively(item)
    } else if (isApiDesignData(item)) {
      removeDesignDocuments(item.id)
    } else if (isRecordingData(item)) {
      removeRecordingRecursively(item)
    } else {
      searchService.removeDocument(item.id)
      publishIndexUpdate('removed', item.id, 'request')
    }
  }
}

/** Simplified API-design type for indexing — the design + its models /
 * enums / routes each become one search document. */
interface DesignData {
  type: 'design'
  id: string
  name: string
  tags: string[]
  notes?: string
  info: { title: string; description?: string; version?: string }
  server?: { basePath?: string }
  models: { id: string; doc: { name: string; description?: string }; properties: { doc: { name: string } }[] }[]
  enums: { id: string; doc: { name: string; description?: string; enumValues?: unknown[] } }[]
  routeGroups: {
    id: string
    doc: { name: string; description?: string }
    design?: { basePath?: string; versionPrefix?: string }
    routes: { id: string; doc: { summary?: string; description?: string; match: { urlPattern: string; method?: string } } }[]
  }[]
}

/** Check if an item is an API design. MUST run before `isRequest` in
 * every dispatch: the request guard (`'type' in item && !('items' in
 * item)`) matches a design too, and `protocolSpec('design')` has no
 * entry — a design falling into the request path throws and aborts
 * the whole folder index pass. */
function isApiDesignData(item: unknown): item is DesignData {
  return typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'design'
}

/** The last index pass's document ids, per design. `removeDocument`
 * only takes exact ids (no prefix removal), so deleting a design — or
 * dropping one of its entities on an update — needs the previous
 * sub-document ids to sweep. */
const designSubDocIds = new Map<string, string[]>()

/** Walk a design into its search documents (mirrors the renderer's
 * `designToSearchDocuments` — the two files deliberately share no code
 * today, same as folders/requests). */
function designSearchDocuments(design: DesignData, parentPath: string[] = [], parentNames: string[] = []): SearchDocument[] {
  const path = [...parentPath, design.id]
  // Same breadcrumb convention as the renderer walker: the design doc
  // carries its parents, each entity carries parents + the design.
  const entityBreadcrumb = { breadcrumb: [...parentNames, design.name] }
  const documents: SearchDocument[] = [{
    id: design.id,
    title: design.name,
    ...(design.info.description !== undefined ? { description: design.info.description } : {}),
    category: 'design',
    icon: DESIGN_CODICON,
    keywords: [design.info.title, design.info.version ?? ''].filter((s) => s !== '').join(' '),
    navigation: { type: 'design', designId: design.id, path },
    metadata: {
      ...(design.notes ? { notes: design.notes } : {}),
      ...(parentNames.length > 0 ? { breadcrumb: parentNames } : {})
    }
  }]
  for (const model of design.models) {
    documents.push({
      id: `${design.id}::model:${model.id}`,
      title: model.doc.name,
      ...(model.doc.description !== undefined ? { description: model.doc.description } : {}),
      category: 'design',
      icon: 'symbol-class',
      keywords: model.properties.map((p) => p.doc.name).join(' '),
      navigation: { type: 'design', designId: design.id, section: 'models', entityId: model.id, path },
      metadata: entityBreadcrumb
    })
  }
  for (const enumEntity of design.enums) {
    documents.push({
      id: `${design.id}::enum:${enumEntity.id}`,
      title: enumEntity.doc.name,
      ...(enumEntity.doc.description !== undefined ? { description: enumEntity.doc.description } : {}),
      category: 'design',
      icon: 'symbol-enum',
      keywords: (enumEntity.doc.enumValues ?? []).map((v) => String(v)).join(' '),
      navigation: { type: 'design', designId: design.id, section: 'enums', entityId: enumEntity.id, path },
      metadata: entityBreadcrumb
    })
  }
  for (const group of design.routeGroups) {
    for (const route of group.routes) {
      const summary = route.doc.summary
      const title = summary !== undefined && summary !== '' ? summary : route.doc.match.urlPattern
      const fullPath = composeRoutePath({
        ...(design.server?.basePath !== undefined ? { designBasePath: design.server.basePath } : {}),
        groupBasePath: groupChainBasePath(design, group)
      }, route.doc.match.urlPattern)
      documents.push({
        id: `${design.id}::route:${route.id}`,
        title,
        ...(route.doc.description !== undefined ? { description: route.doc.description } : {}),
        category: 'design',
        icon: 'type-hierarchy-sub',
        keywords: [route.doc.match.method ?? 'GET', fullPath, group.doc.name].join(' '),
        navigation: { type: 'design', designId: design.id, section: 'routes', entityId: route.id, path },
        metadata: entityBreadcrumb
      })
    }
  }
  return documents
}

/** Index a design's documents, sweeping the previous pass's leftovers
 * (a deleted model's doc must not linger after an update). */
function indexDesignDocuments(design: DesignData, parentPath: string[] = [], parentNames: string[] = []): void {
  const documents = designSearchDocuments(design, parentPath, parentNames)
  const newIds = documents.map((doc) => doc.id)
  // Set lookup: DESIGN_UPDATED fires on every debounced edit while a
  // design tab is open, and a realistic design carries hundreds of
  // entities — the O(n²) includes-in-filter shape would burn there.
  const newIdSet = new Set(newIds)
  const staleIds = (designSubDocIds.get(design.id) ?? []).filter((id) => !newIdSet.has(id))
  for (const id of staleIds) {
    searchService.removeDocument(id)
    publishIndexUpdate('removed', id, 'design')
  }
  for (const doc of documents) {
    searchService.indexDocument(doc)
  }
  designSubDocIds.set(design.id, newIds)
  publishIndexUpdate('indexed', design.id, 'design')
}

/** Remove a design + every sub-document of its last index pass. */
function removeDesignDocuments(designId: string): void {
  const ids = designSubDocIds.get(designId) ?? [designId]
  for (const id of ids) {
    searchService.removeDocument(id)
  }
  designSubDocIds.delete(designId)
  publishIndexUpdate('removed', designId, 'design')
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

  // Determine icon based on request type. HTTP derives its icon from the
  // method; every other protocol declares a fixed `searchIcon` in the registry
  // (any protocol without one falls back to the generic `file` icon).
  let icon = 'file'
  if (request.type === 'http') {
    icon = request.method?.toLowerCase() ?? 'get'
  } else {
    const spec = protocolSpec(request.type)
    // Fall back to the protocol's fixed badge before the generic `file`
    // icon: a protocol can declare a badge (`REDIS`, `STOMP`, …) without a
    // `searchIcon`, and `file` gives a search result a grey FILE badge
    // instead of the protocol's own. The badge value round-trips through
    // `mapToBadgeType` (which uppercases any unknown token), so `redis`
    // lands back as the `REDIS` badge.
    icon = spec.searchIcon
      ?? (spec.badge.kind === 'fixed' ? spec.badge.value.toLowerCase() : 'file')
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
function indexFolderRecursively(folder: FolderData, parentPath: string[] = [], parentNames: string[] = []): void {
  const currentPath = [...parentPath, folder.id]
  const currentNames = [...parentNames, folder.name]

  // Index the folder
  searchService.indexDocument(folderToSearchDocument(folder, parentPath))
  publishIndexUpdate('indexed', folder.id, 'folder')

  // Index all items. The design guard MUST run before the request
  // guard — see `isApiDesignData`.
  for (const item of folder.items) {
    if (isFolder(item)) {
      indexFolderRecursively(item, currentPath, currentNames)
    } else if (isScenarioData(item)) {
      indexScenarioRecursively(item, currentPath, currentNames)
    } else if (isApiDesignData(item)) {
      indexDesignDocuments(item, currentPath, currentNames)
    } else if (isRecordingData(item)) {
      indexRecordingRecursively(item, currentPath, currentNames)
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
function indexScenarioRecursively(scenario: ScenarioData, parentPath: string[] = [], parentNames: string[] = []): void {
  const currentPath = [...parentPath, scenario.id]
  const currentNames = scenario.name !== undefined ? [...parentNames, scenario.name] : parentNames
  for (const item of scenario.items ?? []) {
    if (isFolder(item)) {
      indexFolderRecursively(item, currentPath, currentNames)
    } else if (isScenarioData(item)) {
      indexScenarioRecursively(item, currentPath, currentNames)
    } else if (isApiDesignData(item)) {
      indexDesignDocuments(item, currentPath, currentNames)
    } else if (isRecordingData(item)) {
      indexRecordingRecursively(item, currentPath, currentNames)
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
    } else if (isApiDesignData(item)) {
      removeDesignDocuments(item.id)
    } else if (isRecordingData(item)) {
      removeRecordingRecursively(item)
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
    } else if (isApiDesignData(item)) {
      removeDesignDocuments(item.id)
    } else if (isRecordingData(item)) {
      removeRecordingRecursively(item)
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

    // Subscribe to design events: create/update re-walk the design's
    // documents (sweeping entities dropped since the last pass);
    // delete removes the design + every sub-document. Parent NAMES are
    // resolved from the live store so the event path emits the same
    // breadcrumbs as the load-time walk (they'd otherwise diverge on
    // the first edit — the event only carries `parentFolderId`).
    const designAncestry = (designId: string): { path: string[]; names: string[] } => {
      const path: string[] = []
      const names: string[] = []
      let parent = collectionStore.findParentFolder(designId)
      while (parent !== null) {
        path.unshift(parent.id)
        names.unshift(parent.name)
        parent = collectionStore.findParentFolder(parent.id)
      }
      return { path, names }
    }

    this.subscriptions.push(
      eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.DESIGN_CREATED, (payload) => {
        logger.debug('[SearchIndexService] DESIGN_CREATED', { id: payload.id })
        if (isApiDesignData(payload.document)) {
          const ancestry = designAncestry(payload.id)
          indexDesignDocuments(payload.document, ancestry.path, ancestry.names)
        }
      })
    )

    this.subscriptions.push(
      eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.DESIGN_UPDATED, (payload) => {
        logger.debug('[SearchIndexService] DESIGN_UPDATED', { id: payload.id })
        if (isApiDesignData(payload.document)) {
          const ancestry = designAncestry(payload.id)
          indexDesignDocuments(payload.document, ancestry.path, ancestry.names)
        }
      })
    )

    this.subscriptions.push(
      eventBusService.subscribe<DocumentDeletedPayload>(DocumentEvents.DESIGN_DELETED, (payload) => {
        logger.debug('[SearchIndexService] DESIGN_DELETED', { id: payload.id })
        removeDesignDocuments(payload.id)
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
    // The per-design sub-document ledger exists to make removals
    // EXACT — it must reset with the index it describes, or entries
    // from a previous project linger for the whole session.
    designSubDocIds.clear()
  }
}

/** Singleton instance */
export const searchIndexService = new SearchIndexService()
