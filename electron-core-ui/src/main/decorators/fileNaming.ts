/**
 * @fileNaming Decorator
 */

import { METADATA_KEYS, getClassMetadata, setClassMetadata } from './metadata'

/**
 * Configuration for file naming
 */
export interface FileNamingConfig {
  /**
   * Pattern for generating file names.
   * Supports placeholders:
   * - {index} - zero-padded index (01, 02, etc.)
   * - {type} - document type (e.g., POST, GET, FOLDER)
   * - {name} - document name
   * - {id} - document ID
   *
   * Example: "{index} - {type} - {name}"
   */
  pattern: string
  /** Property to use for the 'type' placeholder */
  typeProperty?: string
  /** Property to use for the 'name' placeholder */
  nameProperty?: string
  /** Property to use as unique identifier for file/folder tracking (default: 'id') */
  idProperty?: string
}

/**
 * Configure file naming for a class.
 * Used when saving items in folder mode.
 */
export function fileNaming(config: FileNamingConfig): ClassDecorator {
  return (target: object) => {
    setClassMetadata(target, METADATA_KEYS.FILE_NAMING, config)
  }
}

/**
 * Get file naming config for a class
 */
export function getFileNamingConfig(target: unknown): FileNamingConfig | undefined {
  return getClassMetadata(target, METADATA_KEYS.FILE_NAMING) as FileNamingConfig | undefined
}

/**
 * Safely convert a value to string
 */
function safeToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/**
 * Generate a file name from the config and document
 */
export function generateFileName(
  target: unknown,
  document: Record<string, unknown>,
  index: number,
  totalCount: number
): string {
  const config = getFileNamingConfig(target)
  if (!config) {
    const nameOrId = safeToString(document['name']) || safeToString(document['id']) || 'unknown'
    return nameOrId
  }

  // Calculate padding for index
  const digits = Math.max(2, String(totalCount).length)
  const paddedIndex = String(index + 1).padStart(digits, '0')

  // Get type value
  const typeValue = config.typeProperty ? safeToString(document[config.typeProperty]) : ''

  // Get name value
  const nameValue = config.nameProperty
    ? safeToString(document[config.nameProperty])
    : safeToString(document['name'])

  // Apply pattern
  let fileName = config.pattern
    .replace('{index}', paddedIndex)
    .replace('{type}', typeValue.toUpperCase())
    .replace('{name}', nameValue)
    .replace('{id}', safeToString(document['id']))

  // Clean up file name (remove invalid characters)
  fileName = fileName.replace(/[<>:"/\\|?*]/g, '_').trim()

  return fileName
}
