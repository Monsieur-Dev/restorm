/**
 * Service for importing Postman Collection v2.1.0 files into Restorm collections
 * 
 * Supports:
 * - HTTP requests (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
 * - Various body types (raw, formdata, urlencoded, file, graphql)
 * - Authentication (oauth2, apikey, bearer, basic, digest, hawk, aws, ntlm)
 * - Nested folders
 * - Variables
 * - Pre-request and test scripts (kept in documentation AND, when a collection
 *   carries scripts, lowered into an executable workflow scenario whose `code`
 *   nodes run them verbatim — see `buildPostmanWorkflowScenario`)
 * - Example responses
 */

import {
  Folder,
  EnvironmentFolder,
  Environment,
  HTTPRequest,
  GraphQLRequest,
  type HTTPRequestBody,
  type KeyValue,
  type Request
} from '../../../shared/models'
import { toHTTPMethod } from './httpMethodValidator'
import { createTypedKeyValue } from '../../../shared/utils/createTypedKeyValue'
import { postmanToApiDocumentation } from './transformers/postmanToApiDocumentation'
import { workflowToScenario, type WorkflowRequestStep } from './workflowToScenario'
import type { Scenario } from '../../../shared/types/scenario'
import { stableImportId as generateId } from './stableImportId'

// ============================================================================
// Postman Collection v2.1.0 Types
// ============================================================================

interface PostmanInfo {
  _postman_id?: string
  name: string
  description?: string
  schema: string
  _exporter_id?: string
}

interface PostmanVariable {
  key: string
  value?: string
  type?: string
  description?: string | { content: string; type: string }
}

interface PostmanUrl {
  raw?: string
  protocol?: string
  host?: string[] | string
  port?: string
  path?: string[] | string
  query?: PostmanQueryParam[]
  variable?: PostmanVariable[]
  hash?: string
}

interface PostmanQueryParam {
  key: string
  value?: string
  description?: string | { content: string; type: string }
  disabled?: boolean
}

interface PostmanHeader {
  key: string
  value: string
  description?: string | { content: string; type: string }
  disabled?: boolean
}

interface PostmanFormDataParam {
  key: string
  value?: string
  type?: 'text' | 'file'
  description?: string | { content: string; type: string }
  src?: string | string[]
  disabled?: boolean
}

interface PostmanUrlEncodedParam {
  key: string
  value?: string
  description?: string | { content: string; type: string }
  disabled?: boolean
}

interface PostmanBodyOptions {
  raw?: {
    language?: string
    headerFamily?: string
  }
}

interface PostmanGraphQLBody {
  query?: string
  variables?: string
}

interface PostmanBody {
  mode?: 'raw' | 'formdata' | 'urlencoded' | 'file' | 'graphql'
  raw?: string
  formdata?: PostmanFormDataParam[]
  urlencoded?: PostmanUrlEncodedParam[]
  file?: { src?: string; content?: string }
  graphql?: PostmanGraphQLBody
  options?: PostmanBodyOptions
}

interface PostmanAuthParam {
  key: string
  value?: string
  type?: string
}

interface PostmanAuth {
  type: 'oauth2' | 'apikey' | 'bearer' | 'basic' | 'digest' | 'hawk' | 'aws' | 'ntlm' | 'edgegrid' | 'noauth'
  oauth2?: PostmanAuthParam[]
  apikey?: PostmanAuthParam[]
  bearer?: PostmanAuthParam[]
  basic?: PostmanAuthParam[]
  digest?: PostmanAuthParam[]
  hawk?: PostmanAuthParam[]
  awsv4?: PostmanAuthParam[]
  ntlm?: PostmanAuthParam[]
  edgegrid?: PostmanAuthParam[]
}

interface PostmanRequest {
  method?: string
  header?: PostmanHeader[] | string
  body?: PostmanBody
  url?: PostmanUrl | string
  auth?: PostmanAuth
  description?: string | { content: string; type: string }
}

interface PostmanResponse {
  name?: string
  originalRequest?: PostmanRequest
  status?: string
  code?: number
  _postman_previewlanguage?: string
  header?: PostmanHeader[]
  cookie?: unknown[]
  body?: string
}

interface PostmanScript {
  type?: string
  exec?: string[]
  packages?: Record<string, unknown>
}

interface PostmanEvent {
  listen: 'prerequest' | 'test'
  script?: PostmanScript
}

interface PostmanItem {
  name: string
  description?: string | { content: string; type: string }
  item?: PostmanItem[]
  request?: PostmanRequest
  response?: PostmanResponse[]
  event?: PostmanEvent[]
  variable?: PostmanVariable[]
  auth?: PostmanAuth
}

interface PostmanCollection {
  info: PostmanInfo
  item: PostmanItem[]
  event?: PostmanEvent[]
  variable?: PostmanVariable[]
  auth?: PostmanAuth
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Extract text from Postman description (can be string or object) */
function extractDescription(desc: string | { content: string; type: string } | undefined): string {
  if (!desc) return ''
  if (typeof desc === 'string') return desc
  return desc.content
}

/** Parse Postman URL into components */
function parsePostmanUrl(url: PostmanUrl | string | undefined): {
  rawUrl: string
  params: KeyValue[]
  pathParams: KeyValue[]
} {
  if (!url) {
    return { rawUrl: '', params: [], pathParams: [] }
  }

  if (typeof url === 'string') {
    return { rawUrl: url, params: [], pathParams: [] }
  }

  // Build URL from parts
  let rawUrl = url.raw ?? ''
  
  if (!rawUrl && url.host) {
    const protocol = url.protocol ? `${url.protocol}://` : ''
    const host = Array.isArray(url.host) ? url.host.join('.') : url.host
    const port = url.port ? `:${url.port}` : ''
    const path = url.path ? (Array.isArray(url.path) ? `/${url.path.join('/')}` : `/${url.path}`) : ''
    rawUrl = `${protocol}${host}${port}${path}`
  }

  // Extract query params
  const params: KeyValue[] = (url.query ?? [])
    .filter(q => !q.disabled)
    .map(q => createTypedKeyValue({
      key: q.key,
      value: q.value ?? '',
      description: extractDescription(q.description) || undefined,
      enabled: true
    }))

  // Extract path variables (Postman uses :variable or {{variable}} syntax)
  const pathParams: KeyValue[] = (url.variable ?? []).map(v => createTypedKeyValue({
    key: v.key,
    value: v.value ?? '',
    description: extractDescription(v.description) || undefined,
    enabled: true
  }))

  // Convert Postman path variables (:var) to Restorm format ({{var}})
  // Also handle already templated variables {{var}}
  rawUrl = rawUrl.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{{$1}}')

  return { rawUrl, params, pathParams }
}

/** Convert Postman headers to KeyValue array */
function parseHeaders(headers: PostmanHeader[] | string | undefined): KeyValue[] {
  if (!headers) return []
  if (typeof headers === 'string') return []
  
  return headers
    .filter(h => !h.disabled)
    .map(h => createTypedKeyValue({
      key: h.key,
      value: h.value,
      description: extractDescription(h.description) || undefined,
      enabled: true
    }))
}

/** Convert Postman body to HTTPRequestBody */
function parseBody(body: PostmanBody | undefined): HTTPRequestBody | undefined {
  if (!body?.mode) return undefined

  switch (body.mode) {
    case 'raw':
      return {
        type: 'text',
        content: body.raw ?? ''
      }

    case 'formdata':
      return {
        type: 'form-data',
        fields: (body.formdata ?? [])
          .filter(f => !f.disabled)
          .map(f => createTypedKeyValue({
            key: f.key,
            value: f.value ?? '',
            description: extractDescription(f.description) || undefined,
            enabled: true
          }))
      }

    case 'urlencoded':
      return {
        type: 'x-www-form-urlencoded',
        fields: (body.urlencoded ?? [])
          .filter(f => !f.disabled)
          .map(f => createTypedKeyValue({
            key: f.key,
            value: f.value ?? '',
            description: extractDescription(f.description) || undefined,
            enabled: true
          }))
      }

    case 'file':
      return {
        type: 'file',
        path: body.file?.src ?? ''
      }

    case 'graphql':
      // GraphQL body is stored as text with the query
      return {
        type: 'text',
        content: body.graphql?.query ?? ''
      }

    default:
      return undefined
  }
}

/** Check if a request is a GraphQL request */
function isGraphQLRequest(item: PostmanItem): boolean {
  const body = item.request?.body
  return body?.mode === 'graphql' || 
         (body?.mode === 'raw' && body.options?.raw?.language === 'graphql')
}

/** Convert Postman item to HTTPRequest */
function itemToHTTPRequest(item: PostmanItem, pathPrefix: string): HTTPRequest {
  const request = item.request
  const { rawUrl, params, pathParams } = parsePostmanUrl(request?.url)

  const httpRequest: HTTPRequest = {
    type: 'http',
    id: generateId(`postman:request:${pathPrefix}:${item.name}`),
    name: item.name,
    tags: [],
    method: toHTTPMethod(request?.method),
    url: rawUrl,
    headers: parseHeaders(request?.header),
    params
  }

  // Add optional properties only if they have values
  if (pathParams.length > 0) {
    httpRequest.pathParams = pathParams
  }

  const body = parseBody(request?.body)
  if (body) {
    httpRequest.body = body
  }

  return httpRequest
}

/** Convert Postman item to GraphQLRequest */
function itemToGraphQLRequest(item: PostmanItem, pathPrefix: string): GraphQLRequest {
  const request = item.request
  const { rawUrl } = parsePostmanUrl(request?.url)
  const body = request?.body
  
  // Extract GraphQL query and variables
  let query = ''
  let variables: string | undefined

  if (body?.mode === 'graphql' && body.graphql) {
    query = body.graphql.query ?? ''
    variables = body.graphql.variables
  } else if (body?.mode === 'raw' && body.raw) {
    // Try to parse raw body as GraphQL
    query = body.raw
  }

  // Determine operation type from query
  let operationType: 'query' | 'mutation' | 'subscription' = 'query'
  const queryLower = query.trim().toLowerCase()
  if (queryLower.startsWith('mutation')) {
    operationType = 'mutation'
  } else if (queryLower.startsWith('subscription')) {
    operationType = 'subscription'
  }

  const graphqlRequest: GraphQLRequest = {
    type: 'graphql',
    id: generateId(`postman:graphql:${pathPrefix}:${item.name}`),
    name: item.name,
    tags: [],
    url: rawUrl,
    operationType,
    query,
    headers: parseHeaders(request?.header)
  }

  // Add optional properties only if they have values
  if (variables) {
    graphqlRequest.variables = variables
  }

  return graphqlRequest
}

/** Convert Postman item (folder or request) to Restorm folder/request */
function convertItem(item: PostmanItem, pathPrefix: string): Folder | Request {
  // If item has nested items, it's a folder
  if (item.item && item.item.length > 0) {
    const folderPath = `${pathPrefix}/${item.name}`
    
    const folder: Folder = {
      id: generateId(`postman:folder:${folderPath}`),
      name: item.name,
      tags: [],
      configuration: {},
      items: item.item.map(child => convertItem(child, folderPath))
    }

    return folder
  }

  // It's a request
  if (isGraphQLRequest(item)) {
    return itemToGraphQLRequest(item, pathPrefix)
  }
  
  return itemToHTTPRequest(item, pathPrefix)
}

/** Extract variables from Postman collection into Environment */
function extractEnvironment(
  collection: PostmanCollection,
  baseUrl?: string
): Environment {
  const variables: KeyValue[] = []

  // Add collection variables. `createTypedKeyValue` promotes any value
  // containing `{{...}}` to an `ExpressionValue` so Postman templates
  // (`{{protocol}}://{{host}}`, `{{token}}`, …) actually substitute at
  // runtime instead of being persisted as literal strings.
  for (const v of collection.variable ?? []) {
    if (v.key && v.value !== undefined) {
      // If user provided a baseUrl, skip the collection's baseUrl
      if (v.key === 'baseUrl' && baseUrl) {
        continue
      }
      const description = extractDescription(v.description)
      variables.push(createTypedKeyValue({
        key: v.key,
        value: typeof v.value === 'string' ? v.value : String(v.value),
        enabled: true,
        ...(description ? { description } : {})
      }))
    }
  }

  // If baseUrl provided, add it at the beginning
  if (baseUrl) {
    variables.unshift(createTypedKeyValue({
      key: 'baseUrl',
      value: baseUrl,
      enabled: true
    }))
  }

  // Extract domain name for environment name
  const baseUrlVar = variables.find(v => v.key === 'baseUrl')
  let envName = 'Default'
  if (baseUrlVar?.value) {
    try {
      const baseUrlString = typeof baseUrlVar.value === 'string' ? baseUrlVar.value : String(baseUrlVar.value)
      const url = new URL(baseUrlString.replace(/\{\{.*?\}\}/g, 'placeholder'))
      envName = url.hostname
    } catch {
      envName = 'Default'
    }
  }

  return {
    id: generateId(`postman:env:${collection.info.name}`),
    name: envName,
    variables
  }
}

// ============================================================================
// Main Service
// ============================================================================

export interface PostmanImportOptions {
  /** Base URL to use if not defined in collection variables */
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
  /** Original URL the Postman collection was fetched from (stored on ApiDocumentation.sourceUrl). */
  sourceUrl?: string
}

/**
 * Import a Postman Collection v2.1.0 and convert it to a Folder structure
 */
/** Join a Postman event list's `exec` lines into a single verbatim script. */
function eventsScript(events: PostmanEvent[] | undefined, listen: 'prerequest' | 'test'): string {
  const exec = events?.find((e) => e.listen === listen)?.script?.exec
  if (Array.isArray(exec)) return exec.join('\n')
  return typeof exec === 'string' ? exec : ''
}

/** Concatenate the verbatim scripts that run at one point, dropping empties. */
function joinScripts(parts: string[]): string {
  return parts.map((p) => p.trim()).filter((p) => p !== '').join('\n\n')
}

/** Walk the Postman item tree in order (mirroring {@link convertItem}'s id +
 * path logic) collecting one workflow step per HTTP request. Collection- and
 * folder-level scripts are INHERITED into each request the way Postman runs them:
 * pre-request = collection → folders (outer→inner) → request; test = request →
 * folders (inner→outer) → collection. GraphQL requests are skipped. */
function collectPostmanWorkflowSteps(
  items: PostmanItem[],
  pathPrefix: string,
  out: WorkflowRequestStep[],
  inheritedPre: string[],
  inheritedTest: string[]
): void {
  for (const item of items) {
    if (item.item && item.item.length > 0) {
      // Folder: accumulate its level scripts for descendants.
      collectPostmanWorkflowSteps(
        item.item,
        `${pathPrefix}/${item.name}`,
        out,
        [...inheritedPre, eventsScript(item.event, 'prerequest')],
        [...inheritedTest, eventsScript(item.event, 'test')]
      )
    } else if (item.request && !isGraphQLRequest(item)) {
      out.push({
        requestId: generateId(`postman:request:${pathPrefix}:${item.name}`),
        name: item.name,
        // collection + folders (outer→inner) + request
        prerequest: joinScripts([...inheritedPre, eventsScript(item.event, 'prerequest')]),
        // request + folders (inner→outer) + collection
        postresponse: joinScripts([eventsScript(item.event, 'test'), ...inheritedTest.slice().reverse()]),
        source: 'postman'
      })
    }
  }
}

/** Build a workflow scenario from a Postman collection — but ONLY when at least
 * one request carries a pre/post script, INCLUDING inherited collection-/folder-
 * level scripts (the "this is a workflow" signal). A fully script-free collection
 * returns null (it imports as plain requests, unchanged). */
function buildPostmanWorkflowScenario(collection: PostmanCollection): Scenario | null {
  const steps: WorkflowRequestStep[] = []
  collectPostmanWorkflowSteps(
    collection.item,
    '',
    steps,
    [eventsScript(collection.event, 'prerequest')],
    [eventsScript(collection.event, 'test')]
  )
  const hasScripts = steps.some((s) => (s.prerequest ?? '').trim() !== '' || (s.postresponse ?? '').trim() !== '')
  if (!hasScripts) return null
  return workflowToScenario({
    id: generateId(`postman:scenario:${collection.info.name}`),
    name: `${collection.info.name} — Workflow`,
    steps
  })
}

export function importPostman(
  collection: PostmanCollection,
  options: PostmanImportOptions = {}
): EnvironmentFolder {
  // Validate collection schema. Guard the deref so a malformed collection
  // (no info / no schema) reports the real reason instead of a TypeError on
  // `.includes` of undefined. The `info` field is typed required, but the
  // collection arrives from untrusted JSON, so check it at runtime.
  const schema = (collection.info as { schema?: unknown } | undefined)?.schema
  if (typeof schema !== 'string') {
    throw new Error('Invalid Postman collection: missing info.schema')
  }
  if (!schema.includes('v2.1.0') && !schema.includes('v2.0.0')) {
    throw new Error(`Unsupported Postman collection schema: ${schema}. Only v2.0.0 and v2.1.0 are supported.`)
  }

  // Create environment from collection variables
  const environment = extractEnvironment(collection, options.baseUrl)

  // Convert all items
  const baseItems = collection.item.map(item => convertItem(item, ''))
  // Detect a workflow (requests with pre/post scripts) → an executable scenario
  // appended alongside the requests; null for a script-free collection.
  const workflowScenario = buildPostmanWorkflowScenario(collection)
  const items = workflowScenario ? [...baseItems, workflowScenario] : baseItems

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
  const apiDocumentation = postmanToApiDocumentation(
    collection,
    options.sourceUrl !== undefined ? { sourceUrl: options.sourceUrl } : {}
  )

  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    importSource: 'postman',
    id: generateId(`postman:root:${collection.info.name}`),
    name: collection.info.name,
    tags: [],
    configuration: {},
    environments: [environment],
    items,
    apiDocumentation
  }

  return rootFolder
}

/**
 * Import a Postman Collection from a JSON string
 */
export function importPostmanFromJson(
  json: string,
  options: PostmanImportOptions = {}
): EnvironmentFolder {
  const collection = JSON.parse(json) as PostmanCollection
  return importPostman(collection, options)
}

/**
 * Fetch and import a Postman Collection from a URL
 */
export async function importPostmanFromUrl(
  url: string,
  options: PostmanImportOptions = {}
): Promise<EnvironmentFolder> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch Postman collection: ${response.status} ${response.statusText}`)
  }

  const collection = (await response.json()) as PostmanCollection
  return importPostman(collection, options)
}

// ============================================================================
// Provider registration
// ============================================================================

import { importProviders } from './registry'

function canImport(content: string, _filePath?: string, parsed?: unknown): boolean {
  try {
    const json: unknown = parsed !== undefined ? parsed : JSON.parse(content.trim())
    if (typeof json === 'object' && json !== null && 'info' in json) {
      const info = (json as Record<string, unknown>).info
      if (typeof info === 'object' && info !== null && 'schema' in info) {
        const schema = (info as Record<string, unknown>).schema
        return typeof schema === 'string' && schema.includes('postman')
      }
    }
  } catch { /* not JSON */ }
  return false
}

importProviders.push({ format: 'postman', canImport, parse: (content, opts) => importPostmanFromJson(content, opts) })
