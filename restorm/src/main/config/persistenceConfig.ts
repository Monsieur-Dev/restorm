/**
 * Persistence Configuration for Restorm
 * 
 * Defines how Restorm objects should be serialized, including:
 * - File naming patterns for folder mode
 * - Properties that should be excluded from serialization
 * - Properties that should be saved in separate files/folders
 * - Searchable fields for indexing
 */

import type { FileNamingConfig } from 'electron-core-ui/main'

// ============================================================================
// File Naming Configurations
// ============================================================================

/**
 * File naming configuration for requests in folder mode
 * Pattern: "01 - POST - My Request.restorm"
 */
export const REQUEST_FILE_NAMING: FileNamingConfig = {
  pattern: '{index} - {type} - {name}',
  typeProperty: 'method', // For HTTP requests, use HTTP method
  nameProperty: 'name'
}

/**
 * File naming configuration for folders in folder mode
 * Pattern: "01 - FOLDER - My Folder/"
 */
export const FOLDER_FILE_NAMING: FileNamingConfig = {
  pattern: '{index} - FOLDER - {name}',
  nameProperty: 'name'
}

/**
 * File naming configuration for environments
 * Pattern: "01 - ENV - Production.restorm"
 */
export const ENVIRONMENT_FILE_NAMING: FileNamingConfig = {
  pattern: '{index} - ENV - {name}',
  nameProperty: 'name'
}

// ============================================================================
// Non-Serialized Properties
// ============================================================================

/**
 * Properties that should be excluded from serialization (runtime-only)
 * These are generated at runtime and should not be persisted to files
 */
export const NON_SERIALIZED_PROPERTIES = new Set<string>([
  'id' // RuntimeId is generated at load time
])

/**
 * Properties on KeyValue that should be excluded from serialization
 */
export const KEYVALUE_NON_SERIALIZED = new Set<string>([
  'id' // RuntimeId for KeyValues
])

// ============================================================================
// Separate Files/Folders Configuration
// ============================================================================

/**
 * Properties that should be saved in separate files (one file per array item)
 */
export const FOLDER_SEPARATE_FILES_PROPERTIES = new Set<string>([
  // Currently no properties need separate files at folder level
])

/**
 * Properties that should be saved in separate folders (recursive folder structure)
 */
export const FOLDER_SEPARATE_FOLDERS_PROPERTIES = new Set<string>([
  'items' // Sub-folders and requests saved in their own directories/files
])

/**
 * Properties on EnvironmentFolder that should be saved in separate files
 */
export const ENVIRONMENT_FOLDER_SEPARATE_FILES_PROPERTIES = new Set<string>([
  'environments' // Each environment in its own file
])

// ============================================================================
// Searchable Fields Configuration
// ============================================================================

/**
 * Searchable fields for Folder
 */
export const FOLDER_SEARCHABLE_FIELDS: string[] = [
  'name',
  'documentation',
  'tags'
]

/**
 * Searchable fields for Request
 */
export const REQUEST_SEARCHABLE_FIELDS: string[] = [
  'name',
  'url',
  'documentation',
  'tags',
  'method' // For HTTP requests
]

/**
 * Searchable fields for Environment
 */
export const ENVIRONMENT_SEARCHABLE_FIELDS: string[] = [
  'name'
]

// ============================================================================
// Type Detection Helpers
// ============================================================================

/**
 * Detect if an object is a Folder (not EnvironmentFolder or Request)
 */
export function isFolder(obj: Record<string, unknown>): boolean {
  return 'items' in obj && 'configuration' in obj && obj['folderType'] !== 'environment'
}

/**
 * Detect if an object is an EnvironmentFolder
 */
export function isEnvironmentFolder(obj: Record<string, unknown>): boolean {
  return 'items' in obj && 'folderType' in obj && obj['folderType'] === 'environment'
}

/**
 * Detect if an object is a Request
 */
export function isRequest(obj: Record<string, unknown>): boolean {
  return 'type' in obj && !('items' in obj)
}

/**
 * Detect if an object is an Environment
 */
export function isEnvironment(obj: Record<string, unknown>): boolean {
  return 'variables' in obj && !('type' in obj) && !('items' in obj)
}

/**
 * Get the file naming config for an object based on its type
 */
export function getFileNamingForObject(obj: Record<string, unknown>): FileNamingConfig {
  if (isRequest(obj)) {
    return REQUEST_FILE_NAMING
  }
  if (isEnvironment(obj)) {
    return ENVIRONMENT_FILE_NAMING
  }
  return FOLDER_FILE_NAMING
}

/**
 * Get the request type for file naming (HTTP method or protocol type)
 */
export function getRequestType(obj: Record<string, unknown>): string {
  const type = obj['type']
  
  if (type === 'http') {
    const method = obj['method']
    return typeof method === 'string' ? method : 'HTTP'
  }
  
  if (type === 'graphql') {
    const opType = obj['operationType']
    return typeof opType === 'string' ? opType.toUpperCase() : 'GRAPHQL'
  }
  
  if (type === 'grpc') {
    return 'GRPC'
  }
  
  if (type === 'soap') {
    return 'SOAP'
  }
  
  if (type === 'websocket') {
    const protocol = obj['protocol']
    return typeof protocol === 'string' ? protocol.toUpperCase() : 'WS'
  }
  
  return String(type).toUpperCase()
}
