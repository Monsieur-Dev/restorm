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
import {
  isFolder as isFolderItem,
  isEnvironmentFolder as isEnvironmentFolderItem,
  isRequest as isRequestItem,
  type FolderItem
} from '../../shared/types/folderTypes'

// ============================================================================
// File Naming Configurations
// ============================================================================

/**
 * File naming configuration for requests in folder mode
 * Pattern: "01 - My Request.restorm"
 */
export const REQUEST_FILE_NAMING: FileNamingConfig = {
  pattern: '{index} - {name}',
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

// These re-use the canonical shared guards (a single source of truth) instead
// of re-deriving the rules here — the old local copies diverged and, notably,
// classified a Scenario as a Request (the shared `isRequest` excludes it).

/** Detect if a plain persisted object is a Folder (not EnvironmentFolder). */
export function isFolder(obj: Record<string, unknown>): boolean {
  return isFolderItem(obj as unknown as FolderItem)
}

/** Detect if a plain persisted object is an EnvironmentFolder. */
export function isEnvironmentFolder(obj: Record<string, unknown>): boolean {
  return isEnvironmentFolderItem(obj as unknown as FolderItem)
}

/** Detect if a plain persisted object is a Request (NOT a Scenario). */
export function isRequest(obj: Record<string, unknown>): boolean {
  return isRequestItem(obj as unknown as FolderItem)
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
