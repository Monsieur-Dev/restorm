/**
 * Service for importing Bruno API client files into Restorm collections
 * 
 * Supports:
 * - .bru file format (single request)
 * - bruno.json collection metadata
 * - HTTP requests (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
 * - Various body types (json, text, xml, form-urlencoded, multipart-form, graphql)
 * - Authentication (bearer, basic, apikey, oauth2, awsv4, digest)
 * - Query and path parameters
 * - Headers
 * - Pre-request and test scripts (stored in documentation)
 * - Variables
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

// ============================================================================
// Bruno Types
// ============================================================================

interface BrunoMeta {
  name: string
  type?: string
  seq?: number
}

interface BrunoAuth {
  type: 'bearer' | 'basic' | 'apikey' | 'oauth2' | 'awsv4' | 'digest' | 'none'
  bearer?: { token: string }
  basic?: { username: string; password: string }
  apikey?: { key: string; value: string; placement: 'header' | 'queryparams' }
  oauth2?: Record<string, string>
  awsv4?: Record<string, string>
  digest?: { username: string; password: string }
}

interface BrunoBody {
  type: 'json' | 'text' | 'xml' | 'formUrlEncoded' | 'multipartForm' | 'graphql' | 'none'
  json?: string
  text?: string
  xml?: string
  formUrlEncoded?: KeyValue[]
  multipartForm?: KeyValue[]
  graphql?: { query: string; variables?: string }
}

interface BrunoRequest {
  meta: BrunoMeta
  method: string
  url: string
  headers: KeyValue[]
  params: {
    query: KeyValue[]
    path: KeyValue[]
  }
  auth: BrunoAuth
  body: BrunoBody
  script?: {
    prerequest?: string
    postresponse?: string
  }
  tests?: string
  docs?: string
  vars?: {
    prerequest?: KeyValue[]
    postresponse?: KeyValue[]
  }
}

interface BrunoCollection {
  name: string
  version?: string
  type?: string
  ignore?: string[]
}

// ============================================================================
// .bru File Parser
// ============================================================================

interface ParsedBlock {
  name: string
  content: string
}

/** Parse a .bru file content into blocks */
function parseBruBlocks(content: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = []
  const lines = content.split('\n')
  
  let currentBlock: ParsedBlock | null = null
  let braceDepth = 0
  let blockContent: string[] = []

  for (const line of lines) {
    const trimmedLine = line.trim()
    
    // Check for block start (e.g., "meta {" or "get {")
    const blockStartMatch = /^([a-zA-Z][a-zA-Z0-9:_-]*)\s*\{$/.exec(trimmedLine)
    if (blockStartMatch?.[1] && braceDepth === 0) {
      currentBlock = { name: blockStartMatch[1], content: '' }
      braceDepth = 1
      blockContent = []
      continue
    }

    // Track brace depth
    if (currentBlock) {
      const openBraces = (line.match(/\{/g) ?? []).length
      const closeBraces = (line.match(/\}/g) ?? []).length
      braceDepth += openBraces - closeBraces

      if (braceDepth === 0) {
        // Block ended
        currentBlock.content = blockContent.join('\n')
        blocks.push(currentBlock)
        currentBlock = null
        blockContent = []
      } else {
        blockContent.push(line)
      }
    }
  }

  return blocks
}

/** Parse key-value pairs from block content */
function parseKeyValueBlock(content: string): KeyValue[] {
  const pairs: KeyValue[] = []
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) {
      continue
    }

    // Handle "key: value" format
    const colonMatch = /^([^:]+):\s*(.*)$/.exec(trimmed)
    if (colonMatch?.[1] && colonMatch[2] !== undefined) {
      const key = colonMatch[1].trim()
      let value = colonMatch[2].trim()
      
      // Check for disabled (prefixed with ~)
      if (key.startsWith('~')) {
        continue // Skip disabled items
      }
      
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      
      pairs.push({ key, value })
    }
  }

  return pairs
}

/** Parse a single .bru file into a BrunoRequest */
function parseBruFile(content: string): BrunoRequest {
  const blocks = parseBruBlocks(content)
  
  const request: BrunoRequest = {
    meta: { name: 'Untitled Request' },
    method: 'GET',
    url: '',
    headers: [],
    params: { query: [], path: [] },
    auth: { type: 'none' },
    body: { type: 'none' }
  }

  for (const block of blocks) {
    const blockName = block.name.toLowerCase()
    
    switch (blockName) {
      case 'meta': {
        const pairs = parseKeyValueBlock(block.content)
        for (const pair of pairs) {
          if (pair.key === 'name') request.meta.name = pair.value
          if (pair.key === 'type') request.meta.type = pair.value
          if (pair.key === 'seq') request.meta.seq = parseInt(pair.value, 10)
        }
        break
      }
      
      case 'get':
      case 'post':
      case 'put':
      case 'patch':
      case 'delete':
      case 'head':
      case 'options': {
        request.method = blockName.toUpperCase()
        const pairs = parseKeyValueBlock(block.content)
        for (const pair of pairs) {
          if (pair.key === 'url') request.url = pair.value
          if (pair.key === 'body') {
            // Body mode reference
          }
        }
        break
      }
      
      case 'headers': {
        request.headers = parseKeyValueBlock(block.content)
        break
      }
      
      case 'params:query': {
        request.params.query = parseKeyValueBlock(block.content)
        break
      }
      
      case 'params:path': {
        request.params.path = parseKeyValueBlock(block.content)
        break
      }
      
      case 'auth:bearer': {
        request.auth = { type: 'bearer' }
        const pairs = parseKeyValueBlock(block.content)
        const token = pairs.find(p => p.key === 'token')?.value ?? ''
        request.auth.bearer = { token }
        break
      }
      
      case 'auth:basic': {
        request.auth = { type: 'basic' }
        const pairs = parseKeyValueBlock(block.content)
        request.auth.basic = {
          username: pairs.find(p => p.key === 'username')?.value ?? '',
          password: pairs.find(p => p.key === 'password')?.value ?? ''
        }
        break
      }
      
      case 'auth:apikey': {
        request.auth = { type: 'apikey' }
        const pairs = parseKeyValueBlock(block.content)
        const placementValue = pairs.find(p => p.key === 'placement')?.value
        request.auth.apikey = {
          key: pairs.find(p => p.key === 'key')?.value ?? '',
          value: pairs.find(p => p.key === 'value')?.value ?? '',
          placement: placementValue === 'queryparams' ? 'queryparams' : 'header'
        }
        break
      }
      
      case 'body:json': {
        request.body = { type: 'json', json: block.content.trim() }
        break
      }
      
      case 'body:text': {
        request.body = { type: 'text', text: block.content.trim() }
        break
      }
      
      case 'body:xml': {
        request.body = { type: 'xml', xml: block.content.trim() }
        break
      }
      
      case 'body:form-urlencoded': {
        request.body = { type: 'formUrlEncoded', formUrlEncoded: parseKeyValueBlock(block.content) }
        break
      }
      
      case 'body:multipart-form': {
        request.body = { type: 'multipartForm', multipartForm: parseKeyValueBlock(block.content) }
        break
      }
      
      case 'body:graphql': {
        request.body = { type: 'graphql', graphql: { query: block.content.trim() } }
        break
      }
      
      case 'body:graphql:vars': {
        if (request.body.type === 'graphql' && request.body.graphql) {
          request.body.graphql.variables = block.content.trim()
        }
        break
      }
      
      case 'script:pre-request': {
        request.script = request.script ?? {}
        request.script.prerequest = block.content.trim()
        break
      }
      
      case 'script:post-response': {
        request.script = request.script ?? {}
        request.script.postresponse = block.content.trim()
        break
      }
      
      case 'tests': {
        request.tests = block.content.trim()
        break
      }
      
      case 'docs': {
        request.docs = block.content.trim()
        break
      }
      
      case 'vars:pre-request': {
        request.vars = request.vars ?? {}
        request.vars.prerequest = parseKeyValueBlock(block.content)
        break
      }
      
      case 'vars:post-response': {
        request.vars = request.vars ?? {}
        request.vars.postresponse = parseKeyValueBlock(block.content)
        break
      }
    }
  }

  return request
}

// ============================================================================
// Helper Functions
// ============================================================================

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

/** Convert Bruno body to HTTPRequestBody */
function parseBody(body: BrunoBody): HTTPRequestBody | undefined {
  switch (body.type) {
    case 'json':
      return body.json ? { type: 'text', content: body.json } : undefined
    
    case 'text':
      return body.text ? { type: 'text', content: body.text } : undefined
    
    case 'xml':
      return body.xml ? { type: 'text', content: body.xml } : undefined
    
    case 'formUrlEncoded':
      return body.formUrlEncoded ? { type: 'x-www-form-urlencoded', fields: body.formUrlEncoded } : undefined
    
    case 'multipartForm':
      return body.multipartForm ? { type: 'form-data', fields: body.multipartForm } : undefined
    
    case 'graphql':
      return body.graphql?.query ? { type: 'text', content: body.graphql.query } : undefined
    
    default:
      return undefined
  }
}

/** Build authentication documentation from Bruno auth */
function buildAuthDocumentation(auth: BrunoAuth): string {
  if (auth.type === 'none') return ''

  const lines: string[] = ['## Authentication', '', `**Type:** ${auth.type}`, '']

  switch (auth.type) {
    case 'basic':
      if (auth.basic) {
        lines.push(`- Username: ${auth.basic.username}`)
        lines.push(`- Password: ***`)
      }
      break
    case 'bearer':
      lines.push(`- Token: ***`)
      break
    case 'apikey':
      if (auth.apikey) {
        lines.push(`- Key: ${auth.apikey.key}`)
        lines.push(`- Placement: ${auth.apikey.placement}`)
      }
      break
    case 'oauth2':
    case 'awsv4':
    case 'digest':
      lines.push(`- Configuration: See request settings`)
      break
  }

  lines.push('')
  return lines.join('\n')
}

/** Build scripts documentation from Bruno scripts */
function buildScriptsDocumentation(script: BrunoRequest['script'], tests?: string): string {
  const lines: string[] = []

  if (script?.prerequest) {
    lines.push('## Pre-request Script', '', '```javascript', script.prerequest, '```', '')
  }

  if (script?.postresponse) {
    lines.push('## Post-response Script', '', '```javascript', script.postresponse, '```', '')
  }

  if (tests) {
    lines.push('## Tests', '', '```javascript', tests, '```', '')
  }

  return lines.join('\n')
}

/** Check if a request is a GraphQL request */
function isGraphQLRequest(request: BrunoRequest): boolean {
  return request.body.type === 'graphql'
}

/** Convert Bruno request to HTTPRequest */
function brunoToHTTPRequest(request: BrunoRequest, pathPrefix: string): HTTPRequest {
  // Build documentation
  const docParts: string[] = []
  
  if (request.docs) {
    docParts.push(request.docs, '')
  }

  const authDoc = buildAuthDocumentation(request.auth)
  if (authDoc) {
    docParts.push(authDoc)
  }

  const scriptsDoc = buildScriptsDocumentation(request.script, request.tests)
  if (scriptsDoc) {
    docParts.push(scriptsDoc)
  }

  const httpRequest: HTTPRequest = {
    type: 'http',
    id: generateId(`bruno:request:${pathPrefix}:${request.meta.name}`),
    name: request.meta.name,
    documentation: docParts.join('\n').trim(),
    tags: [],
    method: toHTTPMethod(request.method),
    url: request.url,
    headers: request.headers,
    params: request.params.query
  }

  if (request.params.path.length > 0) {
    httpRequest.pathParams = request.params.path
  }

  const body = parseBody(request.body)
  if (body) {
    httpRequest.body = body
  }

  return httpRequest
}

/** Convert Bruno request to GraphQLRequest */
function brunoToGraphQLRequest(request: BrunoRequest, pathPrefix: string): GraphQLRequest {
  // Build documentation
  const docParts: string[] = []
  
  if (request.docs) {
    docParts.push(request.docs, '')
  }

  const authDoc = buildAuthDocumentation(request.auth)
  if (authDoc) {
    docParts.push(authDoc)
  }

  const scriptsDoc = buildScriptsDocumentation(request.script, request.tests)
  if (scriptsDoc) {
    docParts.push(scriptsDoc)
  }

  const query = request.body.graphql?.query ?? ''
  const variables = request.body.graphql?.variables

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
    id: generateId(`bruno:graphql:${pathPrefix}:${request.meta.name}`),
    name: request.meta.name,
    documentation: docParts.join('\n').trim(),
    tags: [],
    url: request.url,
    operationType,
    query,
    headers: request.headers
  }

  if (variables) {
    graphqlRequest.variables = variables
  }

  return graphqlRequest
}

/** Convert Bruno request to appropriate Restorm request type */
function convertBrunoRequest(request: BrunoRequest, pathPrefix: string): Request {
  if (isGraphQLRequest(request)) {
    return brunoToGraphQLRequest(request, pathPrefix)
  }
  return brunoToHTTPRequest(request, pathPrefix)
}

// ============================================================================
// Main Service
// ============================================================================

export interface BrunoImportOptions {
  /** Base URL to use if not defined in environment */
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

export interface BrunoCollectionData {
  /** Collection metadata from bruno.json */
  collection?: BrunoCollection
  /** Array of .bru file contents with their paths */
  files: { path: string; content: string }[]
}

/**
 * Import a Bruno collection and convert it to a Folder structure
 * 
 * @param data Collection data including bruno.json metadata and .bru files
 * @param options Import options
 */
export function importBruno(
  data: BrunoCollectionData,
  options: BrunoImportOptions = {}
): EnvironmentFolder {
  const collectionName = data.collection?.name ?? 'Bruno Collection'

  // Parse all .bru files
  const requests: { path: string; request: BrunoRequest }[] = []
  for (const file of data.files) {
    try {
      const request = parseBruFile(file.content)
      requests.push({ path: file.path, request })
    } catch {
      // Skip invalid files
    }
  }

  // Build folder structure from file paths
  const rootItems: FolderItem[] = []
  const folderMap = new Map<string, Folder>()

  // Sort by sequence number if available
  requests.sort((a, b) => (a.request.meta.seq ?? 0) - (b.request.meta.seq ?? 0))

  for (const { path, request } of requests) {
    // Get folder path from file path
    const pathParts = path.split('/').filter(Boolean)
    pathParts.pop() // Remove file name
    
    // Find or create parent folder
    let parentItems: FolderItem[] = rootItems
    let folderPath = ''
    
    for (const folderName of pathParts) {
      folderPath = folderPath ? `${folderPath}/${folderName}` : folderName
      
      let folder = folderMap.get(folderPath)
      if (!folder) {
        folder = {
          id: generateId(`bruno:folder:${folderPath}`),
          name: folderName,
          documentation: '',
          tags: [],
          configuration: {},
          items: []
        }
        folderMap.set(folderPath, folder)
        parentItems.push(folder)
      }
      parentItems = folder.items
    }

    // Add request to parent
    const convertedRequest = convertBrunoRequest(request, path)
    parentItems.push(convertedRequest)
  }

  // Create environment
  const environment: Environment = {
    id: generateId(`bruno:env:${collectionName}`),
    name: 'Default',
    variables: options.baseUrl ? [createTypedKeyValue({ key: 'baseUrl', value: options.baseUrl, enabled: true })] : []
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
    targetFolder.items = [...targetFolder.items, ...rootItems]

    return options.environmentFolder
  }

  // Case: No options - create new EnvironmentFolder as root
  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    id: generateId(`bruno:root:${collectionName}`),
    name: collectionName,
    documentation: '',
    tags: [],
    configuration: {},
    environments: [environment],
    items: rootItems
  }

  return rootFolder
}

/**
 * Import a single .bru file
 */
export function importBruFile(
  content: string,
  options: BrunoImportOptions & { name?: string } = {}
): EnvironmentFolder {
  const request = parseBruFile(content)
  
  return importBruno({
    collection: { name: options.name ?? request.meta.name },
    files: [{ path: `${request.meta.name}.bru`, content }]
  }, options)
}

/**
 * Import Bruno collection from JSON export format
 * (Bruno can export to JSON format similar to Postman)
 */
export function importBrunoFromJson(
  json: string,
  options: BrunoImportOptions = {}
): EnvironmentFolder {
  const data = JSON.parse(json) as {
    name?: string
    version?: string
    items?: {
      name: string
      type: 'folder' | 'http' | 'graphql'
      items?: unknown[]
      request?: {
        method: string
        url: string
        headers?: { name: string; value: string; enabled?: boolean }[]
        params?: { name: string; value: string; type: 'query' | 'path'; enabled?: boolean }[]
        body?: {
          mode: 'json' | 'text' | 'xml' | 'formUrlEncoded' | 'multipartForm' | 'graphql' | 'none'
          json?: string
          text?: string
          xml?: string
          formUrlEncoded?: { name: string; value: string; enabled?: boolean }[]
          multipartForm?: { name: string; value: string; enabled?: boolean }[]
          graphql?: { query: string; variables?: string }
        }
        auth?: {
          mode: 'bearer' | 'basic' | 'apikey' | 'none'
          bearer?: { token: string }
          basic?: { username: string; password: string }
          apikey?: { key: string; value: string; placement: string }
        }
        script?: { req?: string; res?: string }
        tests?: string
        docs?: string
      }
    }[]
  }

  const collectionName = data.name ?? 'Bruno Collection'

  // Convert JSON items to folder structure
  function convertItems(items: typeof data.items, pathPrefix: string): FolderItem[] {
    if (!items) return []

    const result: FolderItem[] = []

    for (const item of items) {
      if (item.type === 'folder') {
        const folder: Folder = {
          id: generateId(`bruno:folder:${pathPrefix}/${item.name}`),
          name: item.name,
          documentation: '',
          tags: [],
          configuration: {},
          items: convertItems(item.items as typeof data.items, `${pathPrefix}/${item.name}`)
        }
        result.push(folder)
      } else if (item.request) {
        const req = item.request
        
        // Build documentation
        const docParts: string[] = []
        if (req.docs) docParts.push(req.docs, '')
        if (req.script?.req) docParts.push('## Pre-request Script', '', '```javascript', req.script.req, '```', '')
        if (req.script?.res) docParts.push('## Post-response Script', '', '```javascript', req.script.res, '```', '')
        if (req.tests) docParts.push('## Tests', '', '```javascript', req.tests, '```', '')

        // Convert headers
        const headers: KeyValue[] = (req.headers ?? [])
          .filter(h => h.enabled !== false)
          .map(h => createTypedKeyValue({ key: h.name, value: h.value, enabled: true }))

        // Convert params
        const queryParams: KeyValue[] = (req.params ?? [])
          .filter(p => p.type === 'query' && p.enabled !== false)
          .map(p => createTypedKeyValue({ key: p.name, value: p.value, enabled: true }))

        const pathParams: KeyValue[] = (req.params ?? [])
          .filter(p => p.type === 'path' && p.enabled !== false)
          .map(p => createTypedKeyValue({ key: p.name, value: p.value, enabled: true }))

        // Convert body
        let body: HTTPRequestBody | undefined
        if (req.body) {
          switch (req.body.mode) {
            case 'json':
              body = req.body.json ? { type: 'text', content: req.body.json } : undefined
              break
            case 'text':
              body = req.body.text ? { type: 'text', content: req.body.text } : undefined
              break
            case 'xml':
              body = req.body.xml ? { type: 'text', content: req.body.xml } : undefined
              break
            case 'formUrlEncoded':
              body = req.body.formUrlEncoded ? {
                type: 'x-www-form-urlencoded',
                fields: req.body.formUrlEncoded
                  .filter(f => f.enabled !== false)
                  .map(f => createTypedKeyValue({ key: f.name, value: f.value, enabled: true }))
              } : undefined
              break
            case 'multipartForm':
              body = req.body.multipartForm ? {
                type: 'form-data',
                fields: req.body.multipartForm
                  .filter(f => f.enabled !== false)
                  .map(f => createTypedKeyValue({ key: f.name, value: f.value, enabled: true }))
              } : undefined
              break
            case 'graphql':
              if (req.body.graphql) {
                // Create GraphQL request
                const query = req.body.graphql.query
                let operationType: 'query' | 'mutation' | 'subscription' = 'query'
                const queryLower = query.trim().toLowerCase()
                if (queryLower.startsWith('mutation')) operationType = 'mutation'
                else if (queryLower.startsWith('subscription')) operationType = 'subscription'

                const graphqlRequest: GraphQLRequest = {
                  type: 'graphql',
                  id: generateId(`bruno:graphql:${pathPrefix}/${item.name}`),
                  name: item.name,
                  documentation: docParts.join('\n').trim(),
                  tags: [],
                  url: req.url,
                  operationType,
                  query,
                  headers
                }
                if (req.body.graphql.variables) {
                  graphqlRequest.variables = req.body.graphql.variables
                }
                result.push(graphqlRequest)
                continue
              }
              break
          }
        }

        const httpRequest: HTTPRequest = {
          type: 'http',
          id: generateId(`bruno:request:${pathPrefix}/${item.name}`),
          name: item.name,
          documentation: docParts.join('\n').trim(),
          tags: [],
          method: toHTTPMethod(req.method),
          url: req.url,
          headers,
          params: queryParams
        }

        if (pathParams.length > 0) {
          httpRequest.pathParams = pathParams
        }

        if (body) {
          httpRequest.body = body
        }

        result.push(httpRequest)
      }
    }

    return result
  }

  const items = convertItems(data.items, '')

  // Create environment
  const environment: Environment = {
    id: generateId(`bruno:env:${collectionName}`),
    name: 'Default',
    variables: options.baseUrl ? [createTypedKeyValue({ key: 'baseUrl', value: options.baseUrl, enabled: true })] : []
  }

  // Case: parentFolder provided without environmentFolder - error
  if (options.parentFolder && !options.environmentFolder) {
    throw new Error('parentFolder requires an environmentFolder to store the environment configuration')
  }

  // Case: environmentFolder provided
  if (options.environmentFolder) {
    options.environmentFolder.environments = [
      ...options.environmentFolder.environments,
      environment
    ]

    const targetFolder = options.parentFolder ?? options.environmentFolder
    targetFolder.items = [...targetFolder.items, ...items]

    return options.environmentFolder
  }

  // Case: No options - create new EnvironmentFolder
  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    id: generateId(`bruno:root:${collectionName}`),
    name: collectionName,
    documentation: '',
    tags: [],
    configuration: {},
    environments: [environment],
    items
  }

  return rootFolder
}
