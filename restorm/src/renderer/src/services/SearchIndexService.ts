/**
 * SearchIndexService - Client wrapper for search indexing (Renderer Process)
 *
 * The actual indexing is done in the main process. This service provides:
 * 1. Initial categories registration
 * 2. Bulk folder tree indexing at startup
 *
 * Document events (create/update/delete) are handled by the main process
 * via EventBus events sent from reactive.ts
 */

import {
  searchService,
  type CategoryMeta,
  logger
} from 'electron-core-ui/renderer'
import type { Folder, Scenario, HTTPRequest, GraphQLRequest, GrpcRequest, SoapRequest, WebSocketRequest, ODataRequest, AuthenticationRequest, Request } from '../../../shared/types/collections'
import { isHTTPRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest, isODataRequest, isAuthenticationRequest, isRequest, isScenario } from '../../../shared/types/collections'

/** Search categories configuration for Restorm */
const RESTORM_SEARCH_CATEGORIES: Record<string, CategoryMeta> = {
  request: { label: 'search.categories.request', icon: 'cloud', order: 1 },
  folder: { label: 'search.categories.folder', icon: 'folder', order: 2 },
  scenario: { label: 'search.categories.scenario', icon: 'circuit-board', order: 3 },
  environment: { label: 'search.categories.environment', icon: 'folder-library', order: 4 },
  settings: { label: 'search.categories.settings', icon: 'settings-gear', order: 5 },
  tag: { label: 'search.categories.tag', icon: 'tag', order: 6 }
}

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
  /** Breadcrumb path (parent folder names) */
  breadcrumb?: string[]
}

/** Check if an item is a Folder */
function isFolder(item: unknown): item is Folder {
  return typeof item === 'object' && item !== null && 'items' in item && 'configuration' in item
}

/**
 * Convert a Folder to a SearchDocument
 */
function folderToSearchDocument(folder: Folder, parentPath: string[] = [], parentNames: string[] = []): {
  id: string
  title: string
  description?: string
  category: string
  icon: string
  keywords: string
  navigation: Record<string, unknown>
  metadata: Record<string, unknown>
} {
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
      ...(folder.notes ? { notes: folder.notes } : {}),
      ...(parentNames.length > 0 ? { breadcrumb: parentNames } : {})
    }
  }
}

/**
 * Convert a Scenario to a SearchDocument. Mirrors the folder doc shape so
 * the search list treats scenarios as first-class navigable entries: the
 * same path / breadcrumb metadata, `type: 'scenario'` in the navigation so
 * the click handler can route through the same `handleItemClick` pipeline
 * as folders.
 */
function scenarioToSearchDocument(scenario: Scenario, parentPath: string[] = [], parentNames: string[] = []): {
  id: string
  title: string
  description?: string
  category: string
  icon: string
  keywords: string
  navigation: Record<string, unknown>
  metadata: Record<string, unknown>
} {
  return {
    id: scenario.id,
    title: scenario.name,
    category: 'scenario',
    // Per-item icon doubles as the badge label in the search list when
    // 'scenario' is in `badgedCategories` on the SearchBar — `mapToBadgeType`
    // turns `'scenario'` into the purple SCENARIO badge.
    icon: 'scenario',
    keywords: scenario.tags.join(' '),
    navigation: {
      type: 'scenario',
      scenarioId: scenario.id,
      path: [...parentPath, scenario.id]
    },
    metadata: {
      tags: scenario.tags,
      ...(scenario.notes ? { notes: scenario.notes } : {}),
      ...(parentNames.length > 0 ? { breadcrumb: parentNames } : {})
    }
  }
}

/**
 * Get body content for keywords
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
      return body.fields.map((f) => `${f.key} ${f.value.toString()}`).join(' ')
    default:
      return ''
  }
}

function httpRequestToSearchDocument(
  request: HTTPRequest,
  parentFolderId: string,
  parentPath: string[] = [],
  parentNames: string[] = []
): {
  id: string
  title: string
  description?: string
  category: string
  icon: string
  keywords: string
  navigation: Record<string, unknown>
  metadata: Record<string, unknown>
} {
  const keywords = [
    request.method,
    request.url,
    ...request.tags,
    ...request.headers.map((h) => `${h.key} ${h.value.toString()}`),
    ...request.params.map((p) => `${p.key} ${p.value.toString()}`),
    ...(request.pathParams?.map((p) => `${p.key} ${p.value.toString()}`) ?? []),
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
            value: f.value.toString()
          }))
        }
        break
    }
  }

  return {
    id: request.id,
    title: request.name,
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
      headers: request.headers.map((h) => ({ key: h.key, value: h.value.toString() })),
      params: request.params.map((p) => ({ key: p.key, value: p.value.toString() })),
      ...(request.pathParams ? { pathParams: request.pathParams.map((p) => ({ key: p.key, value: p.value.toString() })) } : {}),
      ...(bodyMetadata ? { body: bodyMetadata } : {}),
      tags: request.tags,
      ...(request.notes ? { notes: request.notes } : {}),
      ...(parentNames.length > 0 ? { breadcrumb: parentNames } : {})
    }
  }
}

function authenticationRequestToSearchDocument(
  request: AuthenticationRequest,
  parentFolderId: string,
  parentPath: string[] = [],
  parentNames: string[] = []
): {
  id: string
  title: string
  description?: string
  category: string
  icon: string
  keywords: string
  navigation: Record<string, unknown>
  metadata: Record<string, unknown>
} {
  const keywords = [
    'auth',
    request.method,
    request.url,
    ...request.tags,
    ...request.headers.map((h) => `${h.key} ${h.value.toString()}`),
    ...request.params.map((p) => `${p.key} ${p.value.toString()}`),
    ...(request.pathParams?.map((p) => `${p.key} ${p.value.toString()}`) ?? []),
    getBodyContent(request.body),
    request.notes ?? ''
  ].join(' ')

  // Body metadata mirrors the HTTP shape — auth requests carry the
  // same body payload (text / form-data / x-www-form-urlencoded /
  // file) as a regular HTTP request.
  let bodyMetadata: RestormSearchMetadata['body'] = undefined
  if (request.body) {
    switch (request.body.type) {
      case 'text':
        bodyMetadata = { type: 'text', content: request.body.content }
        break
      case 'file':
        bodyMetadata = { type: 'file', path: request.body.path }
        break
      case 'form-data':
      case 'x-www-form-urlencoded':
        bodyMetadata = {
          type: request.body.type,
          fields: request.body.fields.map((f) => ({ key: f.key, value: f.value.toString() }))
        }
        break
    }
  }

  return {
    id: request.id,
    title: request.name,
    category: 'request',
    // `icon: 'auth'` → `mapToBadgeType('AUTH')` → 'AUTH' badge
    // (matches the sidebar's auth badge styling). The search
    // tooltip's request branch wraps this in `<Badge type=…/>`.
    icon: 'auth',
    keywords,
    navigation: {
      type: 'request',
      folderId: parentFolderId,
      requestId: request.id,
      path: [...parentPath, request.id]
    },
    metadata: {
      // The search tooltip's Handlebars template (`request-details.hbs`)
      // dispatches on `requestType`. There's no `auth` branch — but
      // an auth request renders identically to an HTTP one (method,
      // URL, headers, params, body), so we tell the template it's
      // `http`. The badge stays `AUTH` because that comes from
      // `icon`, not `requestType`.
      requestType: 'http',
      method: request.method,
      url: request.url,
      headers: request.headers.map((h) => ({ key: h.key, value: h.value.toString() })),
      params: request.params.map((p) => ({ key: p.key, value: p.value.toString() })),
      ...(request.pathParams ? { pathParams: request.pathParams.map((p) => ({ key: p.key, value: p.value.toString() })) } : {}),
      ...(bodyMetadata ? { body: bodyMetadata } : {}),
      tags: request.tags,
      ...(request.notes ? { notes: request.notes } : {}),
      ...(parentNames.length > 0 ? { breadcrumb: parentNames } : {})
    }
  }
}

function graphqlRequestToSearchDocument(
  request: GraphQLRequest,
  parentFolderId: string,
  parentPath: string[] = [],
  parentNames: string[] = []
): {
  id: string
  title: string
  description?: string
  category: string
  icon: string
  keywords: string
  navigation: Record<string, unknown>
  metadata: Record<string, unknown>
} {
  const keywords = [
    'graphql',
    request.operationType,
    request.url,
    request.query,
    ...request.tags,
    ...request.headers.map((h) => `${h.key} ${h.value.toString()}`),
    request.variables ?? '',
    request.notes ?? ''
  ].join(' ')

  return {
    id: request.id,
    title: request.name,
    category: 'request',
    icon: request.operationType,
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
      ...(request.notes ? { notes: request.notes } : {}),
      ...(parentNames.length > 0 ? { breadcrumb: parentNames } : {})
    }
  }
}

function grpcRequestToSearchDocument(
  request: GrpcRequest,
  parentFolderId: string,
  parentPath: string[] = [],
  parentNames: string[] = []
): {
  id: string
  title: string
  description?: string
  category: string
  icon: string
  keywords: string
  navigation: Record<string, unknown>
  metadata: Record<string, unknown>
} {
  const keywords = [
    'grpc',
    request.service,
    request.method,
    request.callType,
    request.url,
    request.requestMessage,
    ...request.tags,
    ...request.metadata.map((m) => `${m.key} ${m.value.toString()}`),
    request.notes ?? ''
  ].join(' ')

  return {
    id: request.id,
    title: request.name,
    category: 'request',
    icon: request.callType,
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
      ...(request.notes ? { notes: request.notes } : {}),
      ...(parentNames.length > 0 ? { breadcrumb: parentNames } : {})
    }
  }
}

function soapRequestToSearchDocument(
  request: SoapRequest,
  parentFolderId: string,
  parentPath: string[] = [],
  parentNames: string[] = []
): {
  id: string
  title: string
  description?: string
  category: string
  icon: string
  keywords: string
  navigation: Record<string, unknown>
  metadata: Record<string, unknown>
} {
  const keywords = [
    'soap',
    request.service,
    request.operation,
    request.soapAction,
    request.url,
    request.body,
    ...request.tags,
    ...request.headers.map((h) => `${h.key} ${h.value.toString()}`),
    request.notes ?? ''
  ].join(' ')

  return {
    id: request.id,
    title: request.name,
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
      ...(request.notes ? { notes: request.notes } : {}),
      ...(parentNames.length > 0 ? { breadcrumb: parentNames } : {})
    }
  }
}

function websocketRequestToSearchDocument(
  request: WebSocketRequest,
  parentFolderId: string,
  parentPath: string[] = [],
  parentNames: string[] = []
): {
  id: string
  title: string
  description?: string
  category: string
  icon: string
  keywords: string
  navigation: Record<string, unknown>
  metadata: Record<string, unknown>
} {
  const keywords = [
    'websocket',
    request.protocol,
    request.url,
    request.event ?? '',
    request.message,
    ...request.tags,
    ...request.headers.map((h) => `${h.key} ${h.value.toString()}`),
    request.notes ?? ''
  ].join(' ')

  return {
    id: request.id,
    title: request.name,
    category: 'request',
    icon: request.protocol,
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
      ...(request.notes ? { notes: request.notes } : {}),
      ...(parentNames.length > 0 ? { breadcrumb: parentNames } : {})
    }
  }
}

function odataRequestToSearchDocument(
  request: ODataRequest,
  parentFolderId: string,
  parentPath: string[] = [],
  parentNames: string[] = []
): {
  id: string
  title: string
  description?: string
  category: string
  icon: string
  keywords: string
  navigation: Record<string, unknown>
  metadata: Record<string, unknown>
} {
  const filter = request.queryOptions.filter ?? ''
  const select = (request.queryOptions.select ?? []).join(' ')
  const keywords = [
    'odata',
    request.odataVersion,
    request.operationKind,
    request.url,
    filter,
    select,
    ...request.tags,
    ...request.headers.map((h) => `${h.key} ${h.value.toString()}`),
    request.notes ?? ''
  ].join(' ')

  return {
    id: request.id,
    title: request.name,
    category: 'request',
    icon: 'odata',
    keywords,
    navigation: {
      type: 'request',
      folderId: parentFolderId,
      requestId: request.id,
      path: [...parentPath, request.id]
    },
    metadata: {
      requestType: 'odata',
      url: request.url,
      odataVersion: request.odataVersion,
      operationKind: request.operationKind,
      headers: request.headers.map((h) => ({ key: h.key, value: h.value })),
      tags: request.tags,
      ...(request.notes ? { notes: request.notes } : {}),
      ...(parentNames.length > 0 ? { breadcrumb: parentNames } : {})
    }
  }
}

function requestToSearchDocument(
  request: Request,
  parentFolderId: string,
  parentPath: string[] = [],
  parentNames: string[] = []
): {
  id: string
  title: string
  description?: string
  category: string
  icon: string
  keywords: string
  navigation: Record<string, unknown>
  metadata: Record<string, unknown>
} {
  if (isHTTPRequest(request)) {
    return httpRequestToSearchDocument(request, parentFolderId, parentPath, parentNames)
  } else if (isGraphQLRequest(request)) {
    return graphqlRequestToSearchDocument(request, parentFolderId, parentPath, parentNames)
  } else if (isGrpcRequest(request)) {
    return grpcRequestToSearchDocument(request, parentFolderId, parentPath, parentNames)
  } else if (isSoapRequest(request)) {
    return soapRequestToSearchDocument(request, parentFolderId, parentPath, parentNames)
  } else if (isWebSocketRequest(request)) {
    return websocketRequestToSearchDocument(request, parentFolderId, parentPath, parentNames)
  } else if (isODataRequest(request)) {
    return odataRequestToSearchDocument(request, parentFolderId, parentPath, parentNames)
  } else if (isAuthenticationRequest(request)) {
    return authenticationRequestToSearchDocument(request, parentFolderId, parentPath, parentNames)
  }
  // Fallback for unknown types
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
    metadata: {
      tags: unknownRequest.tags,
      ...(parentNames.length > 0 ? { breadcrumb: parentNames } : {})
    }
  }
}

/**
 * Recursively collect all documents from a folder tree
 */
function collectFolderDocuments(
  folder: Folder,
  parentPath: string[] = [],
  parentNames: string[] = []
): {
  id: string
  title: string
  description?: string
  category: string
  icon: string
  keywords: string
  navigation: Record<string, unknown>
  metadata: Record<string, unknown>
}[] {
  const currentPath = [...parentPath, folder.id]
  const currentNames = [...parentNames, folder.name]
  const documents: {
    id: string
    title: string
    description?: string
    category: string
    icon: string
    keywords: string
    navigation: Record<string, unknown>
    metadata: Record<string, unknown>
  }[] = []

  // Add the folder itself
  documents.push(folderToSearchDocument(folder, parentPath, parentNames))

  // Add all items
  for (const item of folder.items) {
    if (isFolder(item)) {
      documents.push(...collectFolderDocuments(item, currentPath, currentNames))
    } else if (isScenario(item)) {
      documents.push(...collectScenarioDocuments(item, currentPath, currentNames))
    } else if (isRequest(item)) {
      documents.push(requestToSearchDocument(item, folder.id, currentPath, currentNames))
    }
  }

  return documents
}

/**
 * A scenario is both a searchable document AND a folder-like container.
 * Returns the scenario's own doc first (so the search list surfaces it
 * directly by name), then the docs for the requests / sub-folders /
 * sub-scenarios authored inside it — with the scenario in their path so
 * a child request's breadcrumb shows the owning scenario.
 */
function collectScenarioDocuments(
  scenario: Scenario,
  parentPath: string[] = [],
  parentNames: string[] = []
): ReturnType<typeof collectFolderDocuments> {
  const currentPath = [...parentPath, scenario.id]
  const currentNames = [...parentNames, scenario.name]
  const documents: ReturnType<typeof collectFolderDocuments> = [
    scenarioToSearchDocument(scenario, parentPath, parentNames)
  ]
  for (const item of scenario.items ?? []) {
    if (isFolder(item)) {
      documents.push(...collectFolderDocuments(item, currentPath, currentNames))
    } else if (isScenario(item)) {
      documents.push(...collectScenarioDocuments(item, currentPath, currentNames))
    } else if (isRequest(item)) {
      documents.push(requestToSearchDocument(item, scenario.id, currentPath, currentNames))
    }
  }
  return documents
}

/**
 * SearchIndexService class - client wrapper for search operations
 */
class SearchIndexService {
  private initialized = false

  /**
   * Initialize the service (registers categories in main process)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    logger.debug('[SearchIndexService] Initializing (registering categories)...')
    await searchService.registerCategories(RESTORM_SEARCH_CATEGORIES)
    this.initialized = true
    logger.debug('[SearchIndexService] Initialized')
  }

  /**
   * Index a folder tree (for initial load)
   * Sends all documents to main process in batch
   */
  async indexFolderTree(folder: Folder): Promise<void> {
    logger.debug('[SearchIndexService] Indexing folder tree', { folderId: folder.id, folderName: folder.name })
    try {
      const documents = collectFolderDocuments(folder)
      // Convert to plain objects to avoid IPC serialization issues with Proxies
      const plainDocuments = JSON.parse(JSON.stringify(documents)) as typeof documents
      await searchService.indexDocuments(plainDocuments)
      logger.debug('[SearchIndexService] Indexed folder tree', { documentCount: documents.length })
    } catch (error) {
      logger.error('[SearchIndexService] Error indexing folder tree', { error: String(error), folderId: folder.id })
    }
  }

  /**
   * Index a scenario that lives at the root of the collection — indexes the
   * requests/sub-folders authored inside it (a scenario doubles as a container).
   * Nested scenarios go through {@link collectFolderDocuments} via their folder.
   */
  async indexScenarioTree(scenario: Scenario): Promise<void> {
    try {
      const documents = collectScenarioDocuments(scenario)
      const plainDocuments = JSON.parse(JSON.stringify(documents)) as typeof documents
      await searchService.indexDocuments(plainDocuments)
    } catch (error) {
      logger.error('[SearchIndexService] Error indexing scenario tree', { error: String(error), scenarioId: scenario.id })
    }
  }

  /**
   * Index a single request that lives at the root of the collection
   * (e.g. an attached auth route). Regular requests reach the index
   * through their parent folder's recursive walk; root-level requests
   * don't have a parent to ride along with.
   */
  async indexRootRequest(request: Request): Promise<void> {
    logger.debug('[SearchIndexService] Indexing root request', { requestId: request.id, requestName: request.name })
    try {
      // Use the request's own id as `parentFolderId` — there is no
      // folder above it; the search document's navigation only uses
      // this to drive "jump to parent", which a root-level request
      // simply short-circuits to itself.
      const doc = requestToSearchDocument(request, request.id)
      const plainDoc = JSON.parse(JSON.stringify(doc)) as typeof doc
      await searchService.indexDocuments([plainDoc])
    } catch (error) {
      logger.error('[SearchIndexService] Error indexing root request', { error: String(error), requestId: request.id })
    }
  }

  /**
   * Clear the entire search index
   */
  async clearIndex(): Promise<void> {
    await searchService.clearIndex()
  }

  /**
   * Destroy the service (for testing)
   */
  destroy(): void {
    this.initialized = false
  }
}

/** Singleton instance */
export const searchIndexService = new SearchIndexService()
