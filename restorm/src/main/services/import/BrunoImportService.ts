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
 * - Pre-request and test scripts (kept in documentation AND, when a collection
 *   carries scripts, lowered into an executable workflow scenario whose `code`
 *   nodes run them verbatim — see `buildBrunoWorkflowScenario`)
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
import { CURRENT_FILE_FORMAT_VERSION } from '../../../shared/config/fileFormatVersion'
import {
  brunoToApiDocumentation,
  type BrunoRequestData,
  type BrunoSourceData
} from './transformers/brunoToApiDocumentation'
import { workflowToScenario, type WorkflowRequestStep } from './workflowToScenario'
import type { Scenario } from '../../../shared/types/scenario'

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
  /** Declarative `assert { expr: [op] value }` block (eq by default). */
  assertions?: KeyValue[]
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
      
      // `~`-prefixed entries were already skipped above, so anything reaching
      // here is enabled — make that explicit (downstream truthy-checks rely on it).
      pairs.push({ key, value, enabled: true })
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

      case 'assert': {
        request.assertions = parseKeyValueBlock(block.content)
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

/** Check if a request is a GraphQL request */
function isGraphQLRequest(request: BrunoRequest): boolean {
  return request.body.type === 'graphql'
}

/** Convert Bruno request to HTTPRequest */
function brunoToHTTPRequest(request: BrunoRequest, pathPrefix: string): HTTPRequest {
  const httpRequest: HTTPRequest = {
    type: 'http',
    id: generateId(`bruno:request:${pathPrefix}:${request.meta.name}`),
    name: request.meta.name,
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
  /** Original URL the Bruno collection was fetched from (stored on ApiDocumentation.sourceUrl). */
  sourceUrl?: string
}

export interface BrunoCollectionData {
  /** Collection metadata from bruno.json */
  collection?: BrunoCollection
  /** Array of .bru file contents with their paths */
  files: { path: string; content: string }[]
}

/** A parsed Bruno key/value carries its value as a raw string (the JS expression
 * or the assert RHS); coerce defensively in case a typed value slipped in. */
const kvStr = (x: KeyValue['value']): string => (typeof x === 'string' ? x : '')

/** Bruno `vars:pre-request` / `vars:post-response` (key = JS expression) become
 * `bru.setVar('key', <expr>)` lines, run at the matching point. */
function varsToSetVar(vars: KeyValue[] | undefined): string {
  return (vars ?? [])
    .filter((v) => v.enabled && typeof v.key === 'string' && v.key !== '' && kvStr(v.value).trim() !== '')
    .map((v) => `bru.setVar(${JSON.stringify(v.key)}, ${kvStr(v.value).trim()})`)
    .join('\n')
}

/** Render a Bruno `assert` expected value: a number/boolean/null literal stays
 * literal, anything else becomes a JS string literal. */
function assertValue(raw: string): string {
  const t = raw.trim()
  if (t === '') return '""'
  if (/^-?\d+(\.\d+)?$/.test(t) || t === 'true' || t === 'false' || t === 'null') return t
  return JSON.stringify(t)
}

/** Translate a Bruno `assert` block (`expr: [op] value`, default op `eq`) into
 * `test(...)` lines on chai. Common operators only; unknown ops fall back to eq. */
function assertToTests(assertions: KeyValue[] | undefined): string {
  const lines: string[] = []
  for (const a of assertions ?? []) {
    if (!a.enabled || typeof a.key !== 'string' || a.key.trim() === '') continue
    const lhs = a.key.trim()
    const raw = kvStr(a.value).trim()
    const m = /^(eq|neq|gt|gte|lt|lte|contains|notContains|length|isString|isNumber|isBoolean|isArray|isUndefined|isDefined|isNull|isTruthy|isFalsy)\b\s*(.*)$/.exec(raw)
    const op = m ? m[1] : 'eq'
    const val = m ? m[2] : raw
    let chai: string
    switch (op) {
      case 'neq': chai = `to.not.eql(${assertValue(val)})`; break
      case 'gt': chai = `to.be.above(${assertValue(val)})`; break
      case 'gte': chai = `to.be.at.least(${assertValue(val)})`; break
      case 'lt': chai = `to.be.below(${assertValue(val)})`; break
      case 'lte': chai = `to.be.at.most(${assertValue(val)})`; break
      case 'contains': chai = `to.include(${assertValue(val)})`; break
      case 'notContains': chai = `to.not.include(${assertValue(val)})`; break
      case 'length': chai = `to.have.lengthOf(${assertValue(val)})`; break
      case 'isString': chai = `to.be.a('string')`; break
      case 'isNumber': chai = `to.be.a('number')`; break
      case 'isBoolean': chai = `to.be.a('boolean')`; break
      case 'isArray': chai = `to.be.an('array')`; break
      case 'isUndefined': chai = `to.be.undefined`; break
      case 'isDefined': chai = `to.not.be.undefined`; break
      case 'isNull': chai = `to.be.null`; break
      case 'isTruthy': chai = `to.be.ok`; break
      case 'isFalsy': chai = `to.not.be.ok`; break
      default: chai = `to.eql(${assertValue(val)})`
    }
    lines.push(`test(${JSON.stringify(`assert: ${lhs} ${raw}`.trim())}, function(){ expect(${lhs}).${chai} })`)
  }
  return lines.join('\n')
}

/** The pre-request + (post-response then tests) scripts a Bruno `.bru` carries,
 * including the declarative `vars` and `assert` blocks lowered to script lines. */
function bruScripts(request: BrunoRequest): { pre: string; post: string } {
  return {
    pre: [varsToSetVar(request.vars?.prerequest), request.script?.prerequest].map((s) => (s ?? '').trim()).filter((s) => s !== '').join('\n\n'),
    post: [request.script?.postresponse, varsToSetVar(request.vars?.postresponse), request.tests, assertToTests(request.assertions)]
      .map((s) => (s ?? '').trim()).filter((s) => s !== '').join('\n\n')
  }
}
const isBase = (path: string, base: string): boolean => path === base || path.endsWith(`/${base}`)
const dirOf = (path: string): string => { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i) }
const joinBru = (parts: string[]): string => parts.map((p) => p.trim()).filter((p) => p !== '').join('\n\n')

/** Build a workflow scenario from the (seq-sorted) Bruno requests — ONLY when at
 * least one request carries a pre/post/test script. Inherits `collection.bru`
 * and `folder.bru` scripts the way Bruno runs them (pre: collection → folders
 * outer→inner → request; post: request → folders inner→outer → collection). The
 * post node runs the `post-response` block then the `tests` block. Script-free
 * collections return null. Ids match the importer's. */
function buildBrunoWorkflowScenario(requests: { path: string; request: BrunoRequest }[], collectionName: string): Scenario | null {
  // Separate the level files (collection.bru / folder.bru) from real requests.
  const collection = requests.find(({ path }) => isBase(path, 'collection.bru'))
  const collScripts = collection ? bruScripts(collection.request) : { pre: '', post: '' }
  const folderScripts = new Map<string, { pre: string; post: string }>()
  for (const { path, request } of requests) {
    if (isBase(path, 'folder.bru')) folderScripts.set(dirOf(path), bruScripts(request))
  }
  // Folders that apply to a request path, outermost first.
  const foldersFor = (path: string): { pre: string; post: string }[] => {
    const dir = dirOf(path)
    return [...folderScripts.keys()]
      .filter((d) => d !== '' && (dir === d || dir.startsWith(`${d}/`)))
      .sort((a, b) => a.split('/').length - b.split('/').length)
      .map((d) => folderScripts.get(d) as { pre: string; post: string })
  }

  const steps: WorkflowRequestStep[] = requests
    .filter(({ path, request }) => !isGraphQLRequest(request) && !isBase(path, 'collection.bru') && !isBase(path, 'folder.bru'))
    .map(({ path, request }) => {
      const own = bruScripts(request)
      const folders = foldersFor(path)
      return {
        requestId: generateId(`bruno:request:${path}:${request.meta.name}`),
        name: request.meta.name,
        prerequest: joinBru([collScripts.pre, ...folders.map((f) => f.pre), own.pre]),
        postresponse: joinBru([own.post, ...folders.map((f) => f.post).reverse(), collScripts.post]),
        source: 'bruno' as const
      }
    })
  const hasScripts = steps.some((s) => (s.prerequest ?? '').trim() !== '' || (s.postresponse ?? '').trim() !== '')
  if (!hasScripts) return null
  return workflowToScenario({
    id: generateId(`bruno:scenario:${collectionName}`),
    name: `${collectionName} — Workflow`,
    steps
  })
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

  // Detect a workflow (requests with pre/post/test scripts) → an executable
  // scenario appended alongside the requests (in seq order). Script-free
  // collections are unaffected.
  const workflowScenario = buildBrunoWorkflowScenario(requests, collectionName)
  if (workflowScenario) rootItems.push(workflowScenario)

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
  const brunoSource: BrunoSourceData = {
    requests: requests.map(r => ({
      path: r.path,
      request: {
        meta: r.request.meta,
        method: r.request.method,
        url: r.request.url,
        auth: r.request.auth,
        ...(r.request.docs !== undefined ? { docs: r.request.docs } : {}),
        ...(r.request.script !== undefined ? { script: r.request.script } : {})
      }
    }))
  }
  if (data.collection) {
    brunoSource.collection = { name: data.collection.name }
  }
  const apiDocumentation = brunoToApiDocumentation(brunoSource, {
    name: collectionName,
    ...(options.sourceUrl !== undefined ? { sourceUrl: options.sourceUrl } : {})
  })

  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    fileFormatVersion: CURRENT_FILE_FORMAT_VERSION,
    importSource: 'bruno',
    id: generateId(`bruno:root:${collectionName}`),
    name: collectionName,
    tags: [],
    configuration: {},
    environments: [environment],
    items: rootItems,
    apiDocumentation
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
          tags: [],
          configuration: {},
          items: convertItems(item.items as typeof data.items, `${pathPrefix}/${item.name}`)
        }
        result.push(folder)
      } else if (item.request) {
        const req = item.request

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

  // Detect a workflow in the JSON export (requests with req/res/tests scripts) →
  // an executable scenario appended alongside the requests. Mirrors the .bru path
  // (collectionVariables → scenario variables, scripts run verbatim on the bru
  // runtime). Ids match convertItems' `bruno:request:<path>/<name>`.
  const workflowSteps: WorkflowRequestStep[] = []
  const collectWorkflow = (nodes: typeof data.items, pathPrefix: string): void => {
    for (const item of nodes ?? []) {
      if (item.type === 'folder') {
        collectWorkflow(item.items as typeof data.items, `${pathPrefix}/${item.name}`)
      } else if (item.request) {
        const s = item.request.script
        workflowSteps.push({
          requestId: generateId(`bruno:request:${pathPrefix}/${item.name}`),
          name: item.name,
          prerequest: s?.req ?? '',
          postresponse: [s?.res, item.request.tests].map((x) => (x ?? '').trim()).filter((x) => x !== '').join('\n\n'),
          source: 'bruno'
        })
      }
    }
  }
  collectWorkflow(data.items, '')
  if (workflowSteps.some((s) => (s.prerequest ?? '').trim() !== '' || (s.postresponse ?? '').trim() !== '')) {
    items.push(workflowToScenario({ id: generateId(`bruno:scenario:${collectionName}`), name: `${collectionName} — Workflow`, steps: workflowSteps }))
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
  // Flatten the JSON item tree into BrunoRequestData[] for the transformer.
  const flatRequests: { path: string; request: BrunoRequestData }[] = []
  function collect(items: typeof data.items, pathPrefix: string): void {
    if (!items) return
    for (const item of items) {
      if (item.type === 'folder') {
        collect(item.items as typeof data.items, pathPrefix ? `${pathPrefix}/${item.name}` : item.name)
      } else if (item.request) {
        const req = item.request
        const bruReq: BrunoRequestData = {
          meta: { name: item.name },
          method: req.method,
          url: req.url,
          auth: { type: req.auth?.mode ?? 'none' }
        }
        if (req.docs !== undefined) bruReq.docs = req.docs
        if (req.script) {
          const script: { prerequest?: string; postresponse?: string } = {}
          if (req.script.req !== undefined) script.prerequest = req.script.req
          if (req.script.res !== undefined) script.postresponse = req.script.res
          if (Object.keys(script).length > 0) bruReq.script = script
        }
        flatRequests.push({ path: pathPrefix ? `${pathPrefix}/${item.name}` : item.name, request: bruReq })
      }
    }
  }
  collect(data.items, '')

  const brunoSource: BrunoSourceData = {
    collection: { name: collectionName },
    requests: flatRequests
  }
  const apiDocumentation = brunoToApiDocumentation(brunoSource, {
    name: collectionName,
    ...(options.sourceUrl !== undefined ? { sourceUrl: options.sourceUrl } : {})
  })

  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    fileFormatVersion: CURRENT_FILE_FORMAT_VERSION,
    importSource: 'bruno',
    id: generateId(`bruno:root:${collectionName}`),
    name: collectionName,
    tags: [],
    configuration: {},
    environments: [environment],
    items,
    apiDocumentation
  }

  return rootFolder
}
