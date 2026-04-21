/**
 * ImportManager - Orchestrates all import services
 * 
 * This service:
 * - Reads files from filesystem or fetches from URLs
 * - Detects the format (Swagger, Postman, Insomnia, curl, etc.)
 * - Dispatches to the appropriate import service
 * - Returns parsed results
 */

import * as fs from 'fs/promises'
import { logger } from 'electron-core-ui/main'
import type { EnvironmentFolder, FolderItem } from '../../../shared/models'

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

/** Detect format from content */
function detectFormat(content: string, filePath?: string): string | null {
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
    
    // Detect Swagger/OpenAPI
    if (typeof json === 'object' && json !== null && ('swagger' in json || 'openapi' in json)) {
      return 'swagger'
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
  
  // Detect gRPC proto files
  if (trimmed.includes('syntax = "proto') || trimmed.includes('service ') && trimmed.includes('rpc ') ||
      filePath?.endsWith('.proto')) {
    return 'grpc'
  }
  
  // Detect SOAP WSDL
  if (trimmed.includes('<wsdl:definitions') || trimmed.includes('<definitions') && trimmed.includes('wsdl') ||
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

/** Import from a given content string with detected or specified format */
async function importFromContent(
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
        const response = await fetch(input, fetchInit)
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
    return await importFromContent(content, detectedFormat, source, isUrl ? input : undefined)
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
      const response = await fetch(input)
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
