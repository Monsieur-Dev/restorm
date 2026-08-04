/**
 * Service for importing Thunder Client collection exports into Restorm collections
 *
 * Supports:
 * - HTTP requests (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
 * - GraphQL requests (body type `graphql`)
 * - Body types: none, json, xml, formdata, form-encoded, graphql, binary
 * - Query params and path params (Thunder Client's `params[].isPath` flag)
 * - Nested folders, linked to requests via `containerId`
 * - `{{var}}` variables (already Handlebars-compatible — passed through as-is)
 * - Test assertions (`.tests[]`) and docs (`.docs`), kept as request notes /
 *   documentation (assertions are not executed — see the format doc)
 *
 * Out of scope: Thunder Client environment files (a separate export), and
 * anything beyond a base HTTP/GraphQL request (e.g. its own pre-request
 * script feature).
 */

import {
  Folder,
  EnvironmentFolder,
  Environment,
  HTTPRequest,
  GraphQLRequest,
  type HTTPRequestBody,
  type KeyValue,
  type Request,
  type FolderItem
} from '../../../shared/models'
import { toHTTPMethod } from './httpMethodValidator'
import { createTypedKeyValue } from '../../../shared/utils/createTypedKeyValue'
import { stableImportId as generateId } from './stableImportId'

// ============================================================================
// Thunder Client Collection Types
// ============================================================================

interface ThunderClientFolder {
  id?: string
  _id?: string
  name: string
  /** Parent folder id, or `''`/absent for a root-level folder. */
  containerId?: string
  sortNum?: number
}

interface ThunderClientKeyValue {
  name: string
  value?: string
  isDisabled?: boolean
}

/** `requests[].params` entries double as query AND path params, told apart by `isPath`. */
interface ThunderClientParam extends ThunderClientKeyValue {
  isPath?: boolean
}

interface ThunderClientFormDataField {
  name: string
  value?: string
  type?: 'text' | 'file'
  isDisabled?: boolean
}

interface ThunderClientGraphQLBody {
  query?: string
  variables?: string
}

interface ThunderClientBody {
  type?: 'none' | 'json' | 'xml' | 'formdata' | 'form-encoded' | 'graphql' | 'binary'
  raw?: string
  form?: ThunderClientKeyValue[]
  formdata?: ThunderClientFormDataField[]
  graphql?: ThunderClientGraphQLBody
  fileName?: string
}

interface ThunderClientTest {
  type?: string
  action?: string
  value?: string
}

interface ThunderClientRequest {
  id?: string
  _id?: string
  name: string
  url?: string
  method?: string
  /** Parent folder id, or `''`/absent for a root-level request. */
  containerId?: string
  sortNum?: number
  headers?: ThunderClientKeyValue[]
  params?: ThunderClientParam[]
  body?: ThunderClientBody
  tests?: ThunderClientTest[]
  docs?: string
}

interface ThunderClientCollection {
  clientName?: string
  /** Real-world Thunder Client exports have been seen using either key. */
  client?: string
  collectionName?: string
  collectionId?: string
  version?: string
  folders?: ThunderClientFolder[]
  requests?: ThunderClientRequest[]
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Stable key for a folder — Thunder Client uses `id` in some exports, `_id` in others. */
function folderKey(folder: ThunderClientFolder): string {
  return folder.id ?? folder._id ?? folder.name
}

/** Stable key for a request — falls back to its position when no id is present. */
function requestKey(request: ThunderClientRequest, parentKey: string): string {
  return request.id ?? request._id ?? `${parentKey}:${request.name}:${request.method ?? ''}:${request.url ?? ''}`
}

/** Convert Thunder Client headers to a KeyValue array, dropping disabled rows. */
function parseHeaders(headers: ThunderClientKeyValue[] | undefined): KeyValue[] {
  return (headers ?? [])
    .filter(h => h.isDisabled !== true)
    .map(h => createTypedKeyValue({ key: h.name, value: h.value ?? '', enabled: true }))
}

/** Split Thunder Client's combined `params[]` into query params and path params. */
function parseParams(params: ThunderClientParam[] | undefined): { params: KeyValue[]; pathParams: KeyValue[] } {
  const enabled = (params ?? []).filter(p => p.isDisabled !== true)
  return {
    params: enabled
      .filter(p => p.isPath !== true)
      .map(p => createTypedKeyValue({ key: p.name, value: p.value ?? '', enabled: true })),
    pathParams: enabled
      .filter(p => p.isPath === true)
      .map(p => createTypedKeyValue({ key: p.name, value: p.value ?? '', enabled: true }))
  }
}

/** Convert a Thunder Client body to an HTTPRequestBody. */
function parseBody(body: ThunderClientBody | undefined): HTTPRequestBody | undefined {
  if (!body?.type || body.type === 'none') return undefined

  switch (body.type) {
    case 'json':
    case 'xml':
      return { type: 'text', content: body.raw ?? '' }

    case 'formdata':
      return {
        type: 'form-data',
        fields: (body.formdata ?? [])
          .filter(f => f.isDisabled !== true)
          .map(f => createTypedKeyValue({ key: f.name, value: f.value ?? '', enabled: true }))
      }

    case 'form-encoded':
      return {
        type: 'x-www-form-urlencoded',
        fields: (body.form ?? [])
          .filter(f => f.isDisabled !== true)
          .map(f => createTypedKeyValue({ key: f.name, value: f.value ?? '', enabled: true }))
      }

    case 'graphql':
      // Unreachable in practice — a `graphql` body routes through
      // `requestToGraphQLRequest` before `parseBody` ever runs. Kept for
      // completeness in case a future caller inspects the body directly.
      return { type: 'text', content: body.graphql?.query ?? '' }

    case 'binary':
      return { type: 'file', path: body.fileName ?? '' }

    default:
      return undefined
  }
}

/** Check if a request's body marks it as GraphQL. */
function isGraphQLRequest(request: ThunderClientRequest): boolean {
  return request.body?.type === 'graphql'
}

/** Render `.tests[]` assertions as read-only notes — Thunder Client's test
 * scripts are documentation only here, never executed (see the format doc). */
function formatTests(tests: ThunderClientTest[] | undefined): string | undefined {
  if (!tests || tests.length === 0) return undefined
  const lines = tests.map(t => [`[${t.type ?? 'test'}]`, t.action, t.value].filter(p => p !== undefined && p !== '').join(' '))
  return lines.join('\n')
}

/** Convert a Thunder Client request into an HTTPRequest. */
function requestToHTTPRequest(request: ThunderClientRequest, parentKey: string): HTTPRequest {
  const { params, pathParams } = parseParams(request.params)

  const httpRequest: HTTPRequest = {
    type: 'http',
    id: generateId(`thunder-client:request:${requestKey(request, parentKey)}`),
    name: request.name,
    tags: [],
    method: toHTTPMethod(request.method),
    url: request.url ?? '',
    headers: parseHeaders(request.headers),
    params
  }

  if (pathParams.length > 0) {
    httpRequest.pathParams = pathParams
  }

  const body = parseBody(request.body)
  if (body) {
    httpRequest.body = body
  }

  const documentation = request.docs?.trim()
  if (documentation) {
    httpRequest.documentation = documentation
  }

  const notes = formatTests(request.tests)
  if (notes) {
    httpRequest.notes = notes
  }

  return httpRequest
}

/** Convert a Thunder Client GraphQL request (`body.type === 'graphql'`) into a GraphQLRequest. */
function requestToGraphQLRequest(request: ThunderClientRequest, parentKey: string): GraphQLRequest {
  const graphql = request.body?.graphql
  const query = graphql?.query ?? ''

  let operationType: 'query' | 'mutation' | 'subscription' = 'query'
  const queryLower = query.trim().toLowerCase()
  if (queryLower.startsWith('mutation')) {
    operationType = 'mutation'
  } else if (queryLower.startsWith('subscription')) {
    operationType = 'subscription'
  }

  const graphqlRequest: GraphQLRequest = {
    type: 'graphql',
    id: generateId(`thunder-client:graphql:${requestKey(request, parentKey)}`),
    name: request.name,
    tags: [],
    url: request.url ?? '',
    operationType,
    query,
    headers: parseHeaders(request.headers)
  }

  if (graphql?.variables) {
    graphqlRequest.variables = graphql.variables
  }

  const documentation = request.docs?.trim()
  if (documentation) {
    graphqlRequest.documentation = documentation
  }

  const notes = formatTests(request.tests)
  if (notes) {
    graphqlRequest.notes = notes
  }

  return graphqlRequest
}

/** Build the folder tree for one `containerId`, recursing into sub-folders. */
function buildFolderTree(
  folders: ThunderClientFolder[],
  requests: ThunderClientRequest[],
  parentId: string
): FolderItem[] {
  const items: FolderItem[] = []

  const childFolders = folders
    .filter(f => (f.containerId ?? '') === parentId)
    .sort((a, b) => (a.sortNum ?? 0) - (b.sortNum ?? 0))

  for (const folder of childFolders) {
    const key = folderKey(folder)
    const folderItem: Folder = {
      id: generateId(`thunder-client:folder:${key}`),
      name: folder.name,
      tags: [],
      configuration: {},
      items: buildFolderTree(folders, requests, key)
    }
    items.push(folderItem)
  }

  const childRequests = requests
    .filter(r => (r.containerId ?? '') === parentId)
    .sort((a, b) => (a.sortNum ?? 0) - (b.sortNum ?? 0))

  for (const request of childRequests) {
    const converted: Request = isGraphQLRequest(request)
      ? requestToGraphQLRequest(request, parentId)
      : requestToHTTPRequest(request, parentId)
    items.push(converted)
  }

  return items
}

/** Build the default environment — Thunder Client's own variables live in a
 * separate environment export, so this only seeds a caller-supplied baseUrl. */
function extractEnvironment(collection: ThunderClientCollection, baseUrl?: string): Environment {
  return {
    id: generateId(`thunder-client:env:${collection.collectionId ?? collection.collectionName ?? 'default'}`),
    name: 'Default',
    variables: baseUrl ? [createTypedKeyValue({ key: 'baseUrl', value: baseUrl, enabled: true })] : []
  }
}

// ============================================================================
// Main Service
// ============================================================================

export interface ThunderClientImportOptions {
  /** Base URL to use if the collection carries no baseUrl variable of its own. */
  baseUrl?: string
  /**
   * Existing EnvironmentFolder to add the environment to.
   * If not provided, a new EnvironmentFolder will be created as root.
   */
  environmentFolder?: EnvironmentFolder
  /**
   * Parent folder where requests will be imported.
   * If provided with environmentFolder, requests will be imported here instead of environmentFolder.
   */
  parentFolder?: Folder
  /** Original URL the Thunder Client export was fetched from. */
  sourceUrl?: string
}

/**
 * Import a Thunder Client collection export and convert it to a Folder structure
 */
export function importThunderClient(
  collection: ThunderClientCollection,
  options: ThunderClientImportOptions = {}
): EnvironmentFolder {
  if (!Array.isArray(collection.folders) || !Array.isArray(collection.requests)) {
    throw new Error('Invalid Thunder Client collection: missing "folders" or "requests" array')
  }

  const environment = extractEnvironment(collection, options.baseUrl)
  const items = buildFolderTree(collection.folders, collection.requests, '')

  // Case: parentFolder provided without environmentFolder - error
  if (options.parentFolder && !options.environmentFolder) {
    throw new Error('parentFolder requires an environmentFolder to store the environment configuration')
  }

  // Case: environmentFolder provided (with or without parentFolder)
  if (options.environmentFolder) {
    options.environmentFolder.environments = [
      ...options.environmentFolder.environments,
      environment
    ]

    const targetFolder = options.parentFolder ?? options.environmentFolder
    targetFolder.items = [...targetFolder.items, ...items]

    return options.environmentFolder
  }

  // Case: No options - create new EnvironmentFolder as root
  const collectionName = collection.collectionName ?? 'Thunder Client Import'

  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    importSource: 'thunder-client',
    id: generateId(`thunder-client:root:${collection.collectionId ?? collectionName}`),
    name: collectionName,
    tags: [],
    configuration: {},
    environments: [environment],
    items
  }

  return rootFolder
}

/**
 * Import a Thunder Client collection from a JSON string
 */
export function importThunderClientFromJson(
  json: string,
  options: ThunderClientImportOptions = {}
): EnvironmentFolder {
  const collection = JSON.parse(json) as ThunderClientCollection
  return importThunderClient(collection, options)
}

/**
 * Fetch and import a Thunder Client collection from a URL
 */
export async function importThunderClientFromUrl(
  url: string,
  options: ThunderClientImportOptions = {}
): Promise<EnvironmentFolder> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch Thunder Client collection: ${response.status} ${response.statusText}`)
  }

  const collection = (await response.json()) as ThunderClientCollection
  return importThunderClient(collection, options)
}

// ============================================================================
// Provider registration
// ============================================================================

import { importProviders } from './registry'

function canImport(content: string, _filePath?: string, parsed?: unknown): boolean {
  try {
    const json: unknown = parsed !== undefined ? parsed : JSON.parse(content.trim())
    if (typeof json !== 'object' || json === null) return false
    const obj = json as Record<string, unknown>
    if (obj.clientName === 'Thunder Client' || obj.client === 'Thunder Client') return true

    // Tiebreaker vs. Postman, which shares the same top-level shape family
    // but always carries `info.schema`.
    const info = obj.info
    const hasPostmanSchema = typeof info === 'object' && info !== null && 'schema' in info
    return Array.isArray(obj.folders) && Array.isArray(obj.requests) && !hasPostmanSchema
  } catch { /* not JSON */ }
  return false
}

importProviders.push({
  format: 'thunder-client',
  canImport,
  parse: (content, opts) => importThunderClientFromJson(content, opts)
})
