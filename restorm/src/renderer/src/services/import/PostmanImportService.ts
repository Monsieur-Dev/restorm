/**
 * Service for importing Postman Collection v2.1.0 files into Restorm collections
 * 
 * Supports:
 * - HTTP requests (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
 * - Various body types (raw, formdata, urlencoded, file, graphql)
 * - Authentication (oauth2, apikey, bearer, basic, digest, hawk, aws, ntlm)
 * - Nested folders
 * - Variables
 * - Pre-request and test scripts (stored in documentation)
 * - Example responses
 */

import type {
  Folder,
  EnvironmentFolder,
  Environment,
  HTTPRequest,
  HTTPMethod,
  HTTPRequestBody,
  KeyValue,
  GraphQLRequest,
  Request
} from '../../types/collections'

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

/** Generate a deterministic ID from a seed string */
function generateId(seed?: string): string {
  if (!seed) {
    return crypto.randomUUID()
  }
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0')
  return `${hex}-${seed.length.toString(16).padStart(4, '0')}-4000-8000-${hex}${hex.slice(0, 4)}`
}

/** Convert Postman HTTP method to HTTPMethod type */
function toHTTPMethod(method?: string): HTTPMethod {
  if (!method) return 'GET'
  const upper = method.toUpperCase()
  const validMethods: HTTPMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
  if (validMethods.includes(upper as HTTPMethod)) {
    return upper as HTTPMethod
  }
  return 'GET'
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
    .map(q => ({
      key: q.key,
      value: q.value ?? '',
      description: extractDescription(q.description) || undefined
    }))

  // Extract path variables (Postman uses :variable or {{variable}} syntax)
  const pathParams: KeyValue[] = (url.variable ?? []).map(v => ({
    key: v.key,
    value: v.value ?? '',
    description: extractDescription(v.description) || undefined
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
    .map(h => ({
      key: h.key,
      value: h.value,
      description: extractDescription(h.description) || undefined
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
          .map(f => ({
            key: f.key,
            value: f.value ?? '',
            description: extractDescription(f.description) || undefined
          }))
      }

    case 'urlencoded':
      return {
        type: 'x-www-form-urlencoded',
        fields: (body.urlencoded ?? [])
          .filter(f => !f.disabled)
          .map(f => ({
            key: f.key,
            value: f.value ?? '',
            description: extractDescription(f.description) || undefined
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

/** Build authentication documentation from Postman auth */
function buildAuthDocumentation(auth: PostmanAuth | undefined): string {
  if (!auth || auth.type === 'noauth') return ''

  const lines: string[] = ['## Authentication', '', `**Type:** ${auth.type}`, '']

  const authParams = auth[auth.type as keyof Omit<PostmanAuth, 'type'>]
  if (authParams && authParams.length > 0) {
    lines.push('| Parameter | Value |')
    lines.push('|-----------|-------|')
    for (const param of authParams) {
      const value = param.value ?? ''
      // Mask sensitive values
      const displayValue = param.key.toLowerCase().includes('secret') || 
                          param.key.toLowerCase().includes('password') ||
                          param.key.toLowerCase().includes('token')
        ? '***' : value
      lines.push(`| ${param.key} | ${displayValue} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/** Build scripts documentation from Postman events */
function buildScriptsDocumentation(events: PostmanEvent[] | undefined): string {
  if (!events || events.length === 0) return ''

  const lines: string[] = []

  const prerequest = events.find(e => e.listen === 'prerequest')
  if (prerequest?.script?.exec && prerequest.script.exec.length > 0) {
    const code = prerequest.script.exec.join('\n')
    if (code.trim()) {
      lines.push('## Pre-request Script', '', '```javascript', code, '```', '')
    }
  }

  const test = events.find(e => e.listen === 'test')
  if (test?.script?.exec && test.script.exec.length > 0) {
    const code = test.script.exec.join('\n')
    if (code.trim()) {
      lines.push('## Test Script', '', '```javascript', code, '```', '')
    }
  }

  return lines.join('\n')
}

/** Build example responses documentation */
function buildResponsesDocumentation(responses: PostmanResponse[] | undefined): string {
  if (!responses || responses.length === 0) return ''

  const lines: string[] = ['## Example Responses', '']

  for (const response of responses) {
    const name = response.name ?? 'Response'
    const status = response.status ?? 'Unknown'
    const code = response.code ?? 0
    
    lines.push(`### ${name}`, '')
    lines.push(`**Status:** ${code} ${status}`, '')
    
    if (response.body) {
      const lang = response._postman_previewlanguage ?? 'text'
      lines.push('```' + lang)
      lines.push(response.body)
      lines.push('```', '')
    }
  }

  return lines.join('\n')
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
  
  // Build documentation
  const docParts: string[] = []
  
  const description = extractDescription(item.description ?? request?.description)
  if (description) {
    docParts.push(description, '')
  }

  const authDoc = buildAuthDocumentation(request?.auth)
  if (authDoc) {
    docParts.push(authDoc)
  }

  const scriptsDoc = buildScriptsDocumentation(item.event)
  if (scriptsDoc) {
    docParts.push(scriptsDoc)
  }

  const responsesDoc = buildResponsesDocumentation(item.response)
  if (responsesDoc) {
    docParts.push(responsesDoc)
  }

  const httpRequest: HTTPRequest = {
    type: 'http',
    id: generateId(`postman:request:${pathPrefix}:${item.name}`),
    name: item.name,
    documentation: docParts.join('\n').trim(),
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

  // Build documentation
  const docParts: string[] = []
  const description = extractDescription(item.description ?? request?.description)
  if (description) {
    docParts.push(description, '')
  }

  const authDoc = buildAuthDocumentation(request?.auth)
  if (authDoc) {
    docParts.push(authDoc)
  }

  const scriptsDoc = buildScriptsDocumentation(item.event)
  if (scriptsDoc) {
    docParts.push(scriptsDoc)
  }

  const responsesDoc = buildResponsesDocumentation(item.response)
  if (responsesDoc) {
    docParts.push(responsesDoc)
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
    documentation: docParts.join('\n').trim(),
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
      documentation: extractDescription(item.description),
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

  // Add collection variables
  for (const v of collection.variable ?? []) {
    if (v.key && v.value !== undefined) {
      // If user provided a baseUrl, skip the collection's baseUrl
      if (v.key === 'baseUrl' && baseUrl) {
        continue
      }
      variables.push({
        key: v.key,
        value: v.value,
        description: extractDescription(v.description) || undefined
      })
    }
  }

  // If baseUrl provided, add it at the beginning
  if (baseUrl) {
    variables.unshift({
      key: 'baseUrl',
      value: baseUrl
    })
  }

  // Extract domain name for environment name
  const baseUrlVar = variables.find(v => v.key === 'baseUrl')
  let envName = 'Default'
  if (baseUrlVar?.value) {
    try {
      const url = new URL(baseUrlVar.value.replace(/\{\{.*?\}\}/g, 'placeholder'))
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
}

/**
 * Import a Postman Collection v2.1.0 and convert it to a Folder structure
 */
export function importPostman(
  collection: PostmanCollection,
  options: PostmanImportOptions = {}
): EnvironmentFolder {
  // Validate collection schema
  const schema = collection.info.schema
  if (!schema.includes('v2.1.0') && !schema.includes('v2.0.0')) {
    throw new Error(`Unsupported Postman collection schema: ${schema}. Only v2.0.0 and v2.1.0 are supported.`)
  }

  // Create environment from collection variables
  const environment = extractEnvironment(collection, options.baseUrl)

  // Convert all items
  const items = collection.item.map(item => convertItem(item, ''))

  // Build collection documentation
  const docParts: string[] = []
  
  const description = extractDescription(collection.info.description)
  if (description) {
    docParts.push(description, '')
  }

  const scriptsDoc = buildScriptsDocumentation(collection.event)
  if (scriptsDoc) {
    docParts.push('## Collection Scripts', '', scriptsDoc)
  }

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
  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    id: generateId(`postman:root:${collection.info.name}`),
    name: collection.info.name,
    documentation: docParts.join('\n').trim(),
    tags: [],
    configuration: {},
    environments: [environment],
    items
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
