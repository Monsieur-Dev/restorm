/**
 * ImportManager - Orchestrates all import services
 * 
 * This service:
 * - Reads files from filesystem or fetches from URLs
 * - Detects the format (Swagger, Postman, Insomnia, curl, etc.)
 * - Dispatches to the appropriate import service
 * - Returns parsed results
 */

import { createHash } from 'node:crypto'
import * as fs from 'fs/promises'
import { logger } from 'electron-core-ui/main'
import type { EnvironmentFolder, FolderItem } from '../../../shared/models'
import { isRequest, isAnyFolder, isHTTPRequest, isAuthenticationRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest, isODataRequest } from '../../../shared/types/collections'
import { disableEmptyKeyValues } from '../../../shared/utils/emptyKeyValueHelper'
import { withFirewallBypass } from 'electron-core-ui'
import { assertSafeFetchUrl } from '../../utils/urlSecurity'

// ============================================================================
// Types
// ============================================================================

export interface ImportResult {
  success: boolean
  items: FolderItem[]
  source: string
  format?: string
  error?: string
  /** HTTP status code when the import source is a URL. Surfaced so
   * the UI can detect 401 / 403 and prompt for authentication. */
  statusCode?: number
  /** `true` when the fetch failed with a status listed in the
   * active auth-error-code set (defaults to [401, 403]). The UI
   * uses this to decide whether to show the "Add authentication"
   * button. */
  isAuthError?: boolean
  /** SHA-256 of the raw payload the importer parsed (URL or file).
   * Stamped onto the env folder's `apiUpdate.payloadChecksum` so a
   * subsequent Refresh can detect "no change since the import that
   * produced this folder" without re-running the full importer. */
  payloadChecksum?: string
}

export interface ImportOptions {
  dryRun?: boolean
  /** Optional extra headers to inject into the import fetch (for
   * URL-based imports). Callers plug resolved auth headers here
   * after running an AuthenticationRequest via the cache service. */
  extraHeaders?: Record<string, string>
}

// ============================================================================
// Format Detection
// ============================================================================

/** Detect format from content. Exported for unit-test coverage; production
 * call sites stay inside this module (`importFrom`, `tryAllImports`). */
export function detectFormat(content: string, filePath?: string): string | null {
  const trimmed = content.trim()
  
  // Detect curl commands
  if (trimmed.startsWith('curl ') || trimmed.includes('\ncurl ')) {
    return 'curl'
  }
  
  // Detect PowerShell commands
  if (/Invoke-(RestMethod|WebRequest)/.exec(trimmed)) {
    return 'powershell'
  }
  
  // Try to parse as JSON
  try {
    const json: unknown = JSON.parse(trimmed)
    
    // Detect Swagger 2.0 vs OpenAPI 3.0 / 3.1. Each ships its own
    // version-specific transformer and folder builder; sniffing here means
    // a 3.x spec never falls through to the 2.0 importer (which would
    // silently produce broken folders, missing bodies, empty schemas).
    if (typeof json === 'object' && json !== null) {
      const obj = json as Record<string, unknown>
      if ('swagger' in obj && typeof obj.swagger === 'string' && obj.swagger.startsWith('2.')) {
        return 'swagger'
      }
      if ('openapi' in obj && typeof obj.openapi === 'string') {
        if (obj.openapi.startsWith('3.0')) return 'openapi-3.0'
        if (obj.openapi.startsWith('3.1')) return 'openapi-3.1'
        // Future major versions fall through to no-detection so we surface
        // a clean error instead of mis-importing.
      }
    }
    
    // Detect Postman Collection
    if (typeof json === 'object' && json !== null && 'info' in json) {
      const info = (json as Record<string, unknown>).info
      if (typeof info === 'object' && info !== null && 'schema' in info && typeof info.schema === 'string' && info.schema.includes('postman')) {
        return 'postman'
      }
    }
    
    // Detect Insomnia Export
    if (typeof json === 'object' && json !== null && '_type' in json && 'resources' in json && (json as Record<string, unknown>)._type === 'export') {
      return 'insomnia'
    }
    
    // Detect Bruno Collection
    if (typeof json === 'object' && json !== null && 'version' in json && 'name' in json) {
      const jsonObj = json as Record<string, unknown>
      if (jsonObj.type === 'collection' || filePath?.endsWith('.json')) {
        return 'bruno'
      }
    }
    
    // Detect AsyncAPI
    if (typeof json === 'object' && json !== null && 'asyncapi' in json) {
      return 'asyncapi'
    }

    // Detect OData JSON-CSDL (v4). Every JSON-CSDL document starts
    // with a top-level `$Version` discriminator ("4.0" or "4.01").
    if (typeof json === 'object' && json !== null && '$Version' in json) {
      return 'odata'
    }
  } catch {
    // Not JSON, try other formats
  }
  
  // Try YAML formats
  if (trimmed.startsWith('asyncapi:') || trimmed.includes('\nasyncapi:')) {
    return 'asyncapi'
  }
  
  // Detect GraphQL schema
  if (trimmed.includes('type Query') || trimmed.includes('type Mutation') || 
      trimmed.includes('schema {') || filePath?.endsWith('.graphql') || filePath?.endsWith('.gql')) {
    return 'graphql'
  }
  
  // Detect gRPC proto files. Parenthesise the `&&` group explicitly:
  // `A || B && C || D` parses as `A || (B && C) || D` — correct, but the
  // implicit precedence is a foot-gun on edit, so make it visible.
  if (trimmed.includes('syntax = "proto') || (trimmed.includes('service ') && trimmed.includes('rpc ')) ||
      filePath?.endsWith('.proto')) {
    return 'grpc'
  }

  // Detect SOAP WSDL. Same explicit grouping: a bare `<definitions` only
  // counts as SOAP when it ALSO mentions `wsdl`.
  if (trimmed.includes('<wsdl:definitions') || (trimmed.includes('<definitions') && trimmed.includes('wsdl')) ||
      filePath?.endsWith('.wsdl')) {
    return 'soap'
  }

  // Detect OData EDMX CSDL (v2/v3/v4). All versions wrap the schema
  // in an `edmx:Edmx` root element. A filename or URL ending with
  // `$metadata` or `.edmx` is also a strong hint.
  if (trimmed.includes('<edmx:Edmx') || trimmed.includes('<Edmx ')) {
    return 'odata'
  }
  if (filePath?.endsWith('.edmx') || filePath?.endsWith('$metadata')) {
    return 'odata'
  }
  
  // Detect Bruno .bru files
  if (filePath?.endsWith('.bru')) {
    return 'bruno'
  }
  
  return null
}

// ============================================================================
// Import Functions
// ============================================================================

/**
 * Walk a freshly-imported folder tree and flip `enabled: false` on
 * every KV row whose value resolves to empty (headers, params,
 * path params, gRPC metadata, SOAP headers). Body fields are left
 * alone — POSTing `{"bio": ""}` is a legitimate "clear this field"
 * payload that the user should manage explicitly.
 */
function disableEmptyKeyValuesInTree(folder: EnvironmentFolder): void {
  const visit = (item: FolderItem): void => {
    if (isRequest(item)) {
      if (isHTTPRequest(item) || isAuthenticationRequest(item)) {
        disableEmptyKeyValues(item.headers)
        disableEmptyKeyValues(item.params)
        disableEmptyKeyValues(item.pathParams)
      } else if (isGraphQLRequest(item)) {
        disableEmptyKeyValues(item.headers)
      } else if (isGrpcRequest(item)) {
        disableEmptyKeyValues(item.metadata)
      } else if (isSoapRequest(item)) {
        disableEmptyKeyValues(item.headers)
      } else if (isWebSocketRequest(item)) {
        disableEmptyKeyValues(item.headers)
      } else if (isODataRequest(item)) {
        disableEmptyKeyValues(item.headers)
        disableEmptyKeyValues(item.params)
      }
      return
    }
    if (isAnyFolder(item)) {
      for (const child of item.items) visit(child)
    }
  }
  for (const child of folder.items) visit(child)
}

/** Import from a given content string with detected or specified format */
export async function importFromContent(
  content: string,
  format: string,
  source: string,
  sourceUrl?: string
): Promise<ImportResult> {
  try {
    logger.info(`[ImportManager] Importing from ${source} as ${format}`)

    let folder: EnvironmentFolder | null = null
    const urlOpt = sourceUrl !== undefined ? { sourceUrl } : {}

    switch (format) {
      case 'swagger': {
        const { importSwaggerFromJson } = await import('./SwaggerImportService')
        folder = importSwaggerFromJson(content, urlOpt)
        break
      }

      case 'openapi-3.0':
      case 'openapi-3.1': {
        const { importOpenAPIFromJson } = await import('./OpenAPIImportService')
        folder = importOpenAPIFromJson(content, urlOpt)
        break
      }

      case 'curl': {
        const { importCurl } = await import('./CurlImportService')
        folder = importCurl(content)
        break
      }

      case 'powershell': {
        const { importPowerShell } = await import('./PowerShellImportService')
        folder = importPowerShell(content)
        break
      }

      case 'postman': {
        const { importPostman } = await import('./PostmanImportService')
        const json: unknown = JSON.parse(content)
        folder = importPostman(json as Record<string, unknown>, urlOpt)
        break
      }

      case 'insomnia': {
        const { importInsomnia } = await import('./InsomniaImportService')
        const json: unknown = JSON.parse(content)
        folder = importInsomnia(json as Record<string, unknown>, urlOpt)
        break
      }

      case 'bruno': {
        const { importBrunoFromJson } = await import('./BrunoImportService')
        folder = importBrunoFromJson(content, urlOpt)
        break
      }

      case 'asyncapi': {
        const { importAsyncAPI } = await import('./AsyncAPIImportService')
        folder = importAsyncAPI(content, urlOpt)
        break
      }

      case 'graphql': {
        const { importGraphQL } = await import('./GraphQLImportService')
        folder = importGraphQL(content, urlOpt)
        break
      }

      case 'grpc': {
        const { importGrpc } = await import('./GrpcImportService')
        folder = importGrpc(content, urlOpt)
        break
      }

      case 'soap': {
        const { importSoap } = await import('./SoapImportService')
        folder = importSoap(content, urlOpt)
        break
      }

      case 'odata': {
        const { importOData } = await import('./ODataImportService')
        folder = importOData(content, urlOpt)
        break
      }

      default:
        return {
          success: false,
          items: [],
          source,
          error: `Unsupported format: ${format}`
        }
    }
    
    // Auto-disable empty rows across the freshly-imported tree. Most
    // specs (OpenAPI parameters with no `example` / no `default`,
    // generated headers like `Authorization: ""` waiting for the user
    // to fill them in) produce KV entries whose value resolves to "".
    // Sent over the wire as `?name=&header=` they trigger regex-based
    // 422s on strict APIs. Default is now "create empty rows as
    // disabled" — the user opts in by re-checking the row.
    disableEmptyKeyValuesInTree(folder)

    // Return the folder itself as a single item, not its children
    return {
      success: true,
      items: [folder], // Return the folder itself, not folder.items
      source,
      format
    }
  } catch (error) {
    logger.error(`[ImportManager] Error importing from ${source}:`, error)
    return {
      success: false,
      items: [],
      source,
      format,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/** Import from file path or URL */
export async function importFrom(
  input: string,
  options: ImportOptions = {}
): Promise<ImportResult> {
  try {
    let content: string
    let source: string
    let detectedFormat: string | null = null
    let lastStatusCode: number | undefined

    const isUrl = input.startsWith('http://') || input.startsWith('https://')
    // Check if input is a URL
    if (isUrl) {
      source = input

      try {
        // SSRF guard: a spec URL is user/agent-supplied and this fetch
        // bypasses the firewall, so reject loopback / link-local /
        // private targets (cloud metadata, localhost admin ports, …)
        // before dispatching.
        assertSafeFetchUrl(input)
        const fetchInit: RequestInit = options.extraHeaders && Object.keys(options.extraHeaders).length > 0
          ? { headers: options.extraHeaders }
          : {}
        // Log the full dispatched request (headers redacted for
        // Authorization / Cookie) so auth flows can be diagnosed end
        // to end — which headers reached the target vs. were lost
        // along the way.
        const redactedHeaders: Record<string, string> = {}
        if (options.extraHeaders) {
          for (const [k, v] of Object.entries(options.extraHeaders)) {
            redactedHeaders[k] = /authorization|cookie/i.test(k) ? `${v.slice(0, 12)}…(redacted)` : v
          }
        }
        logger.info('[ImportManager] dispatching fetch', {
          url: input,
          method: 'GET',
          headers: redactedHeaders,
          headerCount: Object.keys(options.extraHeaders ?? {}).length
        })
        // Import is user-initiated (URL paste / drag-drop on the
        // Import modal) — bypass the firewall so we don't ask the
        // user to authorise the very fetch they just typed a URL
        // for, and so a fresh project with empty `projectOrigins`
        // doesn't dead-end on auto-deny.
        const response = await withFirewallBypass(() => fetch(input, fetchInit))
        logger.info('[ImportManager] fetch response', {
          url: input,
          status: response.status,
          statusText: response.statusText
        })
        lastStatusCode = response.status
        if (!response.ok) {
          const isAuthError = response.status === 401 || response.status === 403
          return {
            success: false,
            items: [],
            source,
            statusCode: response.status,
            ...(isAuthError ? { isAuthError: true } : {}),
            error: `HTTP ${response.status}: ${response.statusText}`
          }
        }
        content = await response.text()
      } catch (error) {
        logger.error(`[ImportManager] Failed to fetch URL:`, error)
        return {
          success: false,
          items: [],
          source,
          ...(lastStatusCode !== undefined ? { statusCode: lastStatusCode } : {}),
          error: error instanceof Error ? error.message : String(error)
        }
      }
    } else {
      // Treat as file path
      logger.info(`[ImportManager] Reading from file: ${input}`)
      source = input
      
      try {
        content = await fs.readFile(input, 'utf-8')
      } catch (error) {
        logger.error(`[ImportManager] Failed to read file:`, error)
        return {
          success: false,
          items: [],
          source,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
    
    // Detect format
    detectedFormat = detectFormat(content, input)
    
    if (!detectedFormat) {
      logger.warn(`[ImportManager] Could not detect format for: ${source}`)
      return {
        success: false,
        items: [],
        source,
        error: 'Could not detect file format'
      }
    }
    
    // Import using detected format
    const result = await importFromContent(content, detectedFormat, source, isUrl ? input : undefined)
    if (result.success) {
      // Stamp the payload checksum on every successful import — the
      // env folder's `apiUpdate.payloadChecksum` is what the Refresh
      // button compares against, so it MUST be computed off exactly
      // the same bytes a future `refresh-fetch` will see. Using the
      // raw response text here (pre-parse) matches what
      // `apiUpdate:refresh-fetch` hashes server-side.
      result.payloadChecksum = `sha256:${createHash('sha256').update(content).digest('hex')}`
    }
    return result
  } catch (error) {
    logger.error(`[ImportManager] Unexpected error:`, error)
    return {
      success: false,
      items: [],
      source: input,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/** Try all import services in parallel (for preview/dry-run) */
export async function tryAllImports(
  input: string,
  _options: ImportOptions = {}
): Promise<ImportResult[]> {
  logger.info(`[ImportManager] Trying all import formats for: ${input}`)
  
  // Try to determine if it's a URL or file path
  let content: string
  let source: string
  const isUrl = input.startsWith('http://') || input.startsWith('https://')

  try {
    if (isUrl) {
      source = input
      // Same firewall bypass rationale as `importFromUrl` above —
      // user typed / dropped the URL, that's the authorisation
      // signal. The SSRF guard still applies (bypass ≠ unrestricted).
      assertSafeFetchUrl(input)
      const response = await withFirewallBypass(() => fetch(input))
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      content = await response.text()
    } else {
      source = input
      content = await fs.readFile(input, 'utf-8')
    }
  } catch (error) {
    return [{
      success: false,
      items: [],
      source: input,
      error: error instanceof Error ? error.message : String(error)
    }]
  }
  
  // Try all formats in parallel
  const formats = [
    'swagger',
    'openapi-3.0',
    'openapi-3.1',
    'postman',
    'insomnia',
    'bruno',
    'asyncapi',
    'graphql',
    'grpc',
    'soap',
    'curl',
    'powershell'
  ]
  
  const results = await Promise.all(
    formats.map(format => importFromContent(content, format, source, isUrl ? input : undefined))
  )
  
  // Return only successful results
  return results.filter(r => r.success && r.items.length > 0)
}
