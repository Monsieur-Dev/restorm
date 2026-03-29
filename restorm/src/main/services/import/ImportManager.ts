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
}

export interface ImportOptions {
  dryRun?: boolean
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
  source: string
): Promise<ImportResult> {
  try {
    logger.info(`[ImportManager] Importing from ${source} as ${format}`)
    
    let folder: EnvironmentFolder | null = null
    
    switch (format) {
      case 'swagger': {
        const { importSwaggerFromJson } = await import('./SwaggerImportService')
        folder = importSwaggerFromJson(content)
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
        folder = importPostman(json as Record<string, unknown>)
        break
      }
        
      case 'insomnia': {
        const { importInsomnia } = await import('./InsomniaImportService')
        const json: unknown = JSON.parse(content)
        folder = importInsomnia(json as Record<string, unknown>)
        break
      }
        
      case 'bruno': {
        const { importBrunoFromJson } = await import('./BrunoImportService')
        folder = importBrunoFromJson(content)
        break
      }
        
      case 'asyncapi': {
        const { importAsyncAPI } = await import('./AsyncAPIImportService')
        folder = importAsyncAPI(content)
        break
      }
        
      case 'graphql': {
        const { importGraphQL } = await import('./GraphQLImportService')
        folder = importGraphQL(content)
        break
      }
        
      case 'grpc': {
        const { importGrpc } = await import('./GrpcImportService')
        folder = importGrpc(content)
        break
      }
        
      case 'soap': {
        const { importSoap } = await import('./SoapImportService')
        folder = importSoap(content)
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
  _options: ImportOptions = {}
): Promise<ImportResult> {
  try {
    let content: string
    let source: string
    let detectedFormat: string | null = null
    
    // Check if input is a URL
    if (input.startsWith('http://') || input.startsWith('https://')) {
      logger.info(`[ImportManager] Fetching from URL: ${input}`)
      source = input
      
      try {
        const response = await fetch(input)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        content = await response.text()
      } catch (error) {
        logger.error(`[ImportManager] Failed to fetch URL:`, error)
        return {
          success: false,
          items: [],
          source,
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
    return await importFromContent(content, detectedFormat, source)
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
  
  try {
    if (input.startsWith('http://') || input.startsWith('https://')) {
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
    formats.map(format => importFromContent(content, format, source))
  )
  
  // Return only successful results
  return results.filter(r => r.success && r.items.length > 0)
}
