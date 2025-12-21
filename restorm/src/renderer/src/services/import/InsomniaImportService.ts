/**
 * Service for importing Insomnia export files (v4 format) into Restorm collections
 * 
 * Supports:
 * - HTTP requests (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
 * - GraphQL requests
 * - Various body types (JSON, form-data, urlencoded, file, binary)
 * - Authentication (basic, bearer, oauth2, apikey, aws, hawk, digest, ntlm)
 * - Environments and environment variables
 * - Nested folders (request groups)
 * - Request descriptions and documentation
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
  Request,
  FolderItem
} from '../../types/collections'

// ============================================================================
// Insomnia Export v4 Types
// ============================================================================

interface InsomniaExport {
  _type: 'export'
  __export_format: number
  __export_date?: string
  __export_source?: string
  resources: InsomniaResource[]
}

type InsomniaResource =
  | InsomniaWorkspace
  | InsomniaEnvironment
  | InsomniaRequestGroup
  | InsomniaRequest
  | InsomniaGrpcRequest
  | InsomniaWebSocketRequest

interface InsomniaBaseResource {
  _id: string
  parentId: string | null
  modified?: number
  created?: number
  name: string
  description?: string
  metaSortKey?: number
}

interface InsomniaWorkspace extends InsomniaBaseResource {
  _type: 'workspace'
  scope?: 'design' | 'collection'
}

interface InsomniaEnvironment extends InsomniaBaseResource {
  _type: 'environment'
  data: Record<string, unknown>
  dataPropertyOrder?: Record<string, string[]> | null
  color?: string | null
  isPrivate?: boolean
}

interface InsomniaRequestGroup extends InsomniaBaseResource {
  _type: 'request_group'
  environment?: Record<string, unknown>
  environmentPropertyOrder?: Record<string, string[]> | null
}

interface InsomniaHeader {
  name: string
  value: string
  description?: string
  disabled?: boolean
}

interface InsomniaParameter {
  name: string
  value: string
  description?: string
  disabled?: boolean
}

interface InsomniaBodyFormData {
  name: string
  value: string
  description?: string
  type?: 'text' | 'file'
  fileName?: string
  disabled?: boolean
}

interface InsomniaBody {
  mimeType?: string
  text?: string
  params?: InsomniaBodyFormData[]
  fileName?: string
}

interface InsomniaAuth {
  type: 'basic' | 'bearer' | 'oauth2' | 'apikey' | 'aws' | 'hawk' | 'digest' | 'ntlm' | 'none' | 'asap' | 'netrc'
  username?: string
  password?: string
  token?: string
  prefix?: string
  accessTokenUrl?: string
  authorizationUrl?: string
  clientId?: string
  clientSecret?: string
  scope?: string
  grantType?: string
  key?: string
  value?: string
  addTo?: 'header' | 'queryParams'
  disabled?: boolean
}

interface InsomniaRequest extends InsomniaBaseResource {
  _type: 'request'
  method: string
  url: string
  body?: InsomniaBody
  parameters?: InsomniaParameter[]
  headers?: InsomniaHeader[]
  authentication?: InsomniaAuth
  settingEncodeUrl?: boolean
  settingDisableRenderRequestBody?: boolean
  settingFollowRedirects?: string
  settingSendCookies?: boolean
  settingStoreCookies?: boolean
  settingRebuildPath?: boolean
  isPrivate?: boolean
}

interface InsomniaGrpcRequest extends InsomniaBaseResource {
  _type: 'grpc_request'
  protoFileId?: string
  protoMethodName?: string
  body?: { text?: string }
  metadata?: InsomniaHeader[]
  url?: string
}

interface InsomniaWebSocketRequest extends InsomniaBaseResource {
  _type: 'websocket_request'
  url?: string
  headers?: InsomniaHeader[]
  authentication?: InsomniaAuth
  parameters?: InsomniaParameter[]
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Extract text from description */
function extractDescription(desc: string | undefined): string {
  return desc ?? ''
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

/** Convert Insomnia HTTP method to HTTPMethod type */
function toHTTPMethod(method?: string): HTTPMethod {
  if (!method) return 'GET'
  const upper = method.toUpperCase()
  const validMethods: HTTPMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
  if (validMethods.includes(upper as HTTPMethod)) {
    return upper as HTTPMethod
  }
  return 'GET'
}

/** Convert Insomnia headers to KeyValue array */
function parseHeaders(headers: InsomniaHeader[] | undefined): KeyValue[] {
  if (!headers) return []
  
  return headers
    .filter(h => !h.disabled)
    .map(h => ({
      key: h.name,
      value: h.value,
      description: h.description ?? undefined
    }))
}

/** Convert Insomnia parameters to KeyValue array */
function parseParams(params: InsomniaParameter[] | undefined): KeyValue[] {
  if (!params) return []
  
  return params
    .filter(p => !p.disabled)
    .map(p => ({
      key: p.name,
      value: p.value,
      description: p.description ?? undefined
    }))
}

/** Convert Insomnia body to HTTPRequestBody */
function parseBody(body: InsomniaBody | undefined): HTTPRequestBody | undefined {
  if (!body) return undefined

  const mimeType = body.mimeType ?? ''

  // Form data (multipart)
  if (mimeType.includes('multipart/form-data') && body.params) {
    return {
      type: 'form-data',
      fields: body.params
        .filter(p => !p.disabled)
        .map(p => ({
          key: p.name,
          value: p.value,
          description: p.description ?? undefined
        }))
    }
  }

  // URL encoded
  if (mimeType.includes('application/x-www-form-urlencoded') && body.params) {
    return {
      type: 'x-www-form-urlencoded',
      fields: body.params
        .filter(p => !p.disabled)
        .map(p => ({
          key: p.name,
          value: p.value,
          description: p.description ?? undefined
        }))
    }
  }

  // File
  if (body.fileName) {
    return {
      type: 'file',
      path: body.fileName
    }
  }

  // Raw text (JSON, XML, etc.)
  if (body.text !== undefined) {
    return {
      type: 'text',
      content: body.text
    }
  }

  return undefined
}

/** Build authentication documentation from Insomnia auth */
function buildAuthDocumentation(auth: InsomniaAuth | undefined): string {
  if (!auth || auth.type === 'none' || auth.disabled) return ''

  const lines: string[] = ['## Authentication', '', `**Type:** ${auth.type}`, '']

  switch (auth.type) {
    case 'basic':
      lines.push(`- Username: ${auth.username ?? ''}`)
      lines.push(`- Password: ***`)
      break
    case 'bearer':
      lines.push(`- Token: ***`)
      if (auth.prefix) {
        lines.push(`- Prefix: ${auth.prefix}`)
      }
      break
    case 'oauth2':
      if (auth.grantType) lines.push(`- Grant Type: ${auth.grantType}`)
      if (auth.accessTokenUrl) lines.push(`- Access Token URL: ${auth.accessTokenUrl}`)
      if (auth.authorizationUrl) lines.push(`- Authorization URL: ${auth.authorizationUrl}`)
      if (auth.clientId) lines.push(`- Client ID: ${auth.clientId}`)
      if (auth.scope) lines.push(`- Scope: ${auth.scope}`)
      break
    case 'apikey':
      lines.push(`- Key: ${auth.key ?? ''}`)
      lines.push(`- Add to: ${auth.addTo ?? 'header'}`)
      break
    case 'aws':
    case 'hawk':
    case 'digest':
    case 'ntlm':
      lines.push(`- Configuration: See request settings`)
      break
  }

  lines.push('')
  return lines.join('\n')
}

/** Check if a request is a GraphQL request */
function isGraphQLRequest(request: InsomniaRequest): boolean {
  const mimeType = request.body?.mimeType ?? ''
  return mimeType.includes('application/graphql') || 
         (mimeType.includes('application/json') && (request.body?.text?.includes('"query"') ?? false))
}

/** Convert Insomnia request to HTTPRequest */
function requestToHTTPRequest(request: InsomniaRequest): HTTPRequest {
  // Extract path parameters from URL ({{variable}} format)
  const pathParamMatches = request.url.match(/\{\{([^}]+)\}\}/g) ?? []
  const pathParams: KeyValue[] = [...new Set(pathParamMatches)].map(match => ({
    key: match.slice(2, -2),
    value: ''
  }))

  // Build documentation
  const docParts: string[] = []
  
  const description = extractDescription(request.description)
  if (description) {
    docParts.push(description, '')
  }

  const authDoc = buildAuthDocumentation(request.authentication)
  if (authDoc) {
    docParts.push(authDoc)
  }

  const httpRequest: HTTPRequest = {
    type: 'http',
    id: generateId(`insomnia:request:${request._id}`),
    name: request.name,
    documentation: docParts.join('\n').trim(),
    tags: [],
    method: toHTTPMethod(request.method),
    url: request.url,
    headers: parseHeaders(request.headers),
    params: parseParams(request.parameters)
  }

  if (pathParams.length > 0) {
    httpRequest.pathParams = pathParams
  }

  const body = parseBody(request.body)
  if (body) {
    httpRequest.body = body
  }

  return httpRequest
}

/** Convert Insomnia GraphQL request to GraphQLRequest */
function requestToGraphQLRequest(request: InsomniaRequest): GraphQLRequest {
  let query = ''
  let variables: string | undefined

  // Try to parse GraphQL from body
  if (request.body?.text) {
    try {
      const parsed = JSON.parse(request.body.text) as { query?: string; variables?: unknown }
      query = parsed.query ?? ''
      if (parsed.variables) {
        variables = JSON.stringify(parsed.variables, null, 2)
      }
    } catch {
      // If not valid JSON, treat as raw query
      query = request.body.text
    }
  }

  // Build documentation
  const docParts: string[] = []
  const description = extractDescription(request.description)
  if (description) {
    docParts.push(description, '')
  }

  const authDoc = buildAuthDocumentation(request.authentication)
  if (authDoc) {
    docParts.push(authDoc)
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
    id: generateId(`insomnia:graphql:${request._id}`),
    name: request.name,
    documentation: docParts.join('\n').trim(),
    tags: [],
    url: request.url,
    operationType,
    query,
    headers: parseHeaders(request.headers)
  }

  if (variables) {
    graphqlRequest.variables = variables
  }

  return graphqlRequest
}

/** Build folder tree from Insomnia resources */
function buildFolderTree(
  resources: InsomniaResource[],
  parentId: string | null
): FolderItem[] {
  const items: FolderItem[] = []

  // Find all request groups (folders) with this parent
  const groups = resources.filter(
    (r): r is InsomniaRequestGroup => r._type === 'request_group' && r.parentId === parentId
  )

  // Sort by metaSortKey if available
  groups.sort((a, b) => (a.metaSortKey ?? 0) - (b.metaSortKey ?? 0))

  for (const group of groups) {
    const folder: Folder = {
      id: generateId(`insomnia:folder:${group._id}`),
      name: group.name,
      documentation: extractDescription(group.description),
      tags: [],
      configuration: {},
      items: buildFolderTree(resources, group._id)
    }
    items.push(folder)
  }

  // Find all requests with this parent
  const requests = resources.filter(
    (r): r is InsomniaRequest => r._type === 'request' && r.parentId === parentId
  )

  // Sort by metaSortKey if available
  requests.sort((a, b) => (a.metaSortKey ?? 0) - (b.metaSortKey ?? 0))

  for (const request of requests) {
    let convertedRequest: Request
    
    if (isGraphQLRequest(request)) {
      convertedRequest = requestToGraphQLRequest(request)
    } else {
      convertedRequest = requestToHTTPRequest(request)
    }
    
    items.push(convertedRequest)
  }

  return items
}

/** Extract environments from Insomnia resources */
function extractEnvironments(
  resources: InsomniaResource[],
  baseUrl?: string
): Environment[] {
  const environments: Environment[] = []

  const envResources = resources.filter(
    (r): r is InsomniaEnvironment => r._type === 'environment'
  )

  for (const env of envResources) {
    const variables: KeyValue[] = []

    // Convert environment data to KeyValue pairs
    for (const [key, value] of Object.entries(env.data)) {
      // Skip baseUrl if user provided one
      if (key === 'baseUrl' && baseUrl) {
        continue
      }
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        variables.push({
          key,
          value: String(value)
        })
      } else if (value !== null && typeof value === 'object') {
        variables.push({
          key,
          value: JSON.stringify(value)
        })
      }
    }

    // Add user-provided baseUrl at the beginning
    if (baseUrl) {
      variables.unshift({ key: 'baseUrl', value: baseUrl })
    }

    environments.push({
      id: generateId(`insomnia:env:${env._id}`),
      name: env.name,
      variables
    })
  }

  // If no environments found, create a default one
  if (environments.length === 0) {
    environments.push({
      id: generateId('insomnia:env:default'),
      name: 'Default',
      variables: baseUrl ? [{ key: 'baseUrl', value: baseUrl }] : []
    })
  }

  return environments
}

// ============================================================================
// Main Service
// ============================================================================

export interface InsomniaImportOptions {
  /** Base URL to use if not defined in environment variables */
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
 * Import an Insomnia export file (v4 format) and convert it to a Folder structure
 */
export function importInsomnia(
  exportData: InsomniaExport,
  options: InsomniaImportOptions = {}
): EnvironmentFolder {
  // Validate export format (cast to unknown first to allow runtime check)
  const exportType = (exportData as unknown as { _type: unknown })._type
  if (exportType !== 'export') {
    throw new Error('Invalid Insomnia export: missing "_type": "export"')
  }

  if (exportData.__export_format < 4) {
    throw new Error(`Unsupported Insomnia export format: ${exportData.__export_format}. Only format 4+ is supported.`)
  }

  const resources = exportData.resources

  // Find the workspace
  const workspace = resources.find(
    (r): r is InsomniaWorkspace => r._type === 'workspace'
  )

  const workspaceName = workspace?.name ?? 'Insomnia Import'
  const workspaceDescription = workspace?.description ?? ''

  // Find the workspace ID to use as root parent
  const rootParentId = workspace?._id ?? null

  // Extract environments
  const environments = extractEnvironments(resources, options.baseUrl)

  // Build folder tree starting from workspace
  const items = buildFolderTree(resources, rootParentId)

  // Case: parentFolder provided without environmentFolder - error
  if (options.parentFolder && !options.environmentFolder) {
    throw new Error('parentFolder requires an environmentFolder to store the environment configuration')
  }

  // Case: environmentFolder provided (with or without parentFolder)
  if (options.environmentFolder) {
    options.environmentFolder.environments = [
      ...options.environmentFolder.environments,
      ...environments
    ]

    const targetFolder = options.parentFolder ?? options.environmentFolder
    targetFolder.items = [...targetFolder.items, ...items]

    return options.environmentFolder
  }

  // Case: No options - create new EnvironmentFolder as root
  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    id: generateId(`insomnia:root:${workspaceName}`),
    name: workspaceName,
    documentation: workspaceDescription,
    tags: [],
    configuration: {},
    environments,
    items
  }

  return rootFolder
}

/**
 * Import an Insomnia export from a JSON string
 */
export function importInsomniaFromJson(
  json: string,
  options: InsomniaImportOptions = {}
): EnvironmentFolder {
  const exportData = JSON.parse(json) as InsomniaExport
  return importInsomnia(exportData, options)
}

/**
 * Fetch and import an Insomnia export from a URL
 */
export async function importInsomniaFromUrl(
  url: string,
  options: InsomniaImportOptions = {}
): Promise<EnvironmentFolder> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch Insomnia export: ${response.status} ${response.statusText}`)
  }

  const exportData = (await response.json()) as InsomniaExport
  return importInsomnia(exportData, options)
}
