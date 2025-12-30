/**
 * TypeScript Decorators for Document Management
 *
 * Generic decorators that can be used to configure:
 * - Tracking (change detection)
 * - Search indexing
 * - Serialization behavior
 * - File structure (separate files/folders)
 * - File naming patterns
 *
 * These decorators are generic and contain no application-specific logic.
 */

// ============================================================================
// Metadata Storage
// ============================================================================

/** Metadata keys for decorators */
const METADATA_KEYS = {
  TRACKABLE: Symbol('trackable'),
  SEARCHABLE: Symbol('searchable'),
  NON_SERIALISED: Symbol('nonSerialised'),
  SEPARATE_FILES: Symbol('separateFiles'),
  SEPARATE_FOLDERS: Symbol('separateFolders'),
  FILE_NAMING: Symbol('fileNaming')
} as const

/** Metadata storage - class/property -> key -> value */
const metadataStorage = new Map<unknown, Map<symbol, unknown>>()

/** Property metadata storage - class -> property -> key -> value */
const propertyMetadataStorage = new Map<unknown, Map<string | symbol, Map<symbol, unknown>>>()

/**
 * Get metadata for a class
 */
function getClassMetadata(target: unknown, key: symbol): unknown {
  const classMap = metadataStorage.get(target)
  if (!classMap) return undefined
  return classMap.get(key)
}

/**
 * Set metadata for a class
 */
function setClassMetadata(target: unknown, key: symbol, value: unknown): void {
  let classMap = metadataStorage.get(target)
  if (!classMap) {
    classMap = new Map()
    metadataStorage.set(target, classMap)
  }
  classMap.set(key, value)
}

/**
 * Get metadata for a property
 */
function getPropertyMetadata(target: unknown, propertyKey: string | symbol, key: symbol): unknown {
  const classMap = propertyMetadataStorage.get(target)
  if (!classMap) return undefined
  const propMap = classMap.get(propertyKey)
  if (!propMap) return undefined
  return propMap.get(key)
}

/**
 * Set metadata for a property
 */
function setPropertyMetadata(target: unknown, propertyKey: string | symbol, key: symbol, value: unknown): void {
  let classMap = propertyMetadataStorage.get(target)
  if (!classMap) {
    classMap = new Map()
    propertyMetadataStorage.set(target, classMap)
  }
  let propMap = classMap.get(propertyKey)
  if (!propMap) {
    propMap = new Map()
    classMap.set(propertyKey, propMap)
  }
  propMap.set(key, value)
}

/**
 * Get all property metadata for a class
 */
function getAllPropertyMetadata(target: unknown, key: symbol): Map<string | symbol, unknown> {
  const result = new Map<string | symbol, unknown>()
  const classMap = propertyMetadataStorage.get(target)
  if (!classMap) return result

  for (const [propKey, propMap] of classMap) {
    const value = propMap.get(key)
    if (value !== undefined) {
      result.set(propKey, value)
    }
  }
  return result
}

// ============================================================================
// @trackable Decorator
// ============================================================================

/**
 * Configuration for trackable properties
 */
export interface TrackableConfig {
  /** Whether this property triggers change detection (default: true) */
  enabled?: boolean
  /** Debounce delay in ms before emitting change event (default: 50) */
  debounceMs?: number
}

/**
 * Mark a class as trackable for change detection.
 * When applied to a class, all properties trigger change events by default.
 */
export function trackable(config?: TrackableConfig): ClassDecorator {
  return (target: object) => {
    setClassMetadata(target, METADATA_KEYS.TRACKABLE, {
      enabled: config?.enabled ?? true,
      debounceMs: config?.debounceMs ?? 50
    })
  }
}

/**
 * Mark a specific property as trackable.
 * Use this to override class-level tracking for specific properties.
 */
trackable.property = (config?: TrackableConfig): PropertyDecorator => {
  return (target: object, propertyKey: string | symbol) => {
    setPropertyMetadata(target.constructor, propertyKey, METADATA_KEYS.TRACKABLE, {
      enabled: config?.enabled ?? true,
      debounceMs: config?.debounceMs ?? 50
    })
  }
}

/**
 * Check if a class is trackable
 */
export function isTrackable(target: unknown): boolean {
  const config = getClassMetadata(target, METADATA_KEYS.TRACKABLE) as TrackableConfig | undefined
  return config?.enabled ?? false
}

/**
 * Get trackable config for a class
 */
export function getTrackableConfig(target: unknown): TrackableConfig | undefined {
  return getClassMetadata(target, METADATA_KEYS.TRACKABLE) as TrackableConfig | undefined
}

/**
 * Get trackable properties for a class
 */
export function getTrackableProperties(target: unknown): Map<string | symbol, TrackableConfig> {
  return getAllPropertyMetadata(target, METADATA_KEYS.TRACKABLE) as Map<string | symbol, TrackableConfig>
}

// ============================================================================
// @searchable Decorator
// ============================================================================

/**
 * Configuration for searchable properties
 */
export interface SearchableConfig {
  /** Weight for search ranking (higher = more important) */
  weight?: number
  /** Whether to include in full-text search */
  fullText?: boolean
  /** Whether to use for filtering */
  filterable?: boolean
}

/**
 * Mark a class as searchable.
 * When applied to a class, configures default search behavior.
 */
export function searchable(config?: SearchableConfig): ClassDecorator {
  return (target: object) => {
    setClassMetadata(target, METADATA_KEYS.SEARCHABLE, {
      weight: config?.weight ?? 1,
      fullText: config?.fullText ?? true,
      filterable: config?.filterable ?? false
    })
  }
}

/**
 * Mark a specific property as searchable.
 * The property value will be included in the search index.
 */
searchable.property = (config?: SearchableConfig): PropertyDecorator => {
  return (target: object, propertyKey: string | symbol) => {
    setPropertyMetadata(target.constructor, propertyKey, METADATA_KEYS.SEARCHABLE, {
      weight: config?.weight ?? 1,
      fullText: config?.fullText ?? true,
      filterable: config?.filterable ?? false
    })
  }
}

/**
 * Check if a class is searchable
 */
export function isSearchable(target: unknown): boolean {
  return getClassMetadata(target, METADATA_KEYS.SEARCHABLE) !== undefined
}

/**
 * Get searchable config for a class
 */
export function getSearchableConfig(target: unknown): SearchableConfig | undefined {
  return getClassMetadata(target, METADATA_KEYS.SEARCHABLE) as SearchableConfig | undefined
}

/**
 * Get searchable properties for a class
 */
export function getSearchableProperties(target: unknown): Map<string | symbol, SearchableConfig> {
  return getAllPropertyMetadata(target, METADATA_KEYS.SEARCHABLE) as Map<string | symbol, SearchableConfig>
}

// ============================================================================
// @NonSerialised Decorator
// ============================================================================

/**
 * Mark a property as non-serialized.
 * The property will be excluded when serializing the object to JSON/YAML.
 */
export function NonSerialised(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    setPropertyMetadata(target.constructor, propertyKey, METADATA_KEYS.NON_SERIALISED, true)
  }
}

/**
 * Check if a property is non-serialized
 */
export function isNonSerialised(target: unknown, propertyKey: string | symbol): boolean {
  return getPropertyMetadata(target, propertyKey, METADATA_KEYS.NON_SERIALISED) === true
}

/**
 * Get all non-serialized properties for a class
 */
export function getNonSerialisedProperties(target: unknown): Set<string | symbol> {
  const result = new Set<string | symbol>()
  const map = getAllPropertyMetadata(target, METADATA_KEYS.NON_SERIALISED)
  for (const [key, value] of map) {
    if (value === true) {
      result.add(key)
    }
  }
  return result
}

// ============================================================================
// @separateFiles Decorator
// ============================================================================

/**
 * Configuration for separate files behavior
 */
export interface SeparateFilesConfig {
  /** File extension to use (default: inherited from parent) */
  extension?: string
}

/**
 * Mark a property as stored in separate files.
 * Items in this array property will each be saved to their own file.
 */
export function separateFiles(config?: SeparateFilesConfig): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    setPropertyMetadata(target.constructor, propertyKey, METADATA_KEYS.SEPARATE_FILES, {
      extension: config?.extension
    })
  }
}

/**
 * Check if a property uses separate files
 */
export function hasSeparateFiles(target: unknown, propertyKey: string | symbol): boolean {
  return getPropertyMetadata(target, propertyKey, METADATA_KEYS.SEPARATE_FILES) !== undefined
}

/**
 * Get separate files config for a property
 */
export function getSeparateFilesConfig(target: unknown, propertyKey: string | symbol): SeparateFilesConfig | undefined {
  return getPropertyMetadata(target, propertyKey, METADATA_KEYS.SEPARATE_FILES) as SeparateFilesConfig | undefined
}

/**
 * Get all properties with separate files
 */
export function getSeparateFilesProperties(target: unknown): Map<string | symbol, SeparateFilesConfig> {
  return getAllPropertyMetadata(target, METADATA_KEYS.SEPARATE_FILES) as Map<string | symbol, SeparateFilesConfig>
}

// ============================================================================
// @separateFolders Decorator
// ============================================================================

/**
 * Configuration for separate folders behavior
 */
export interface SeparateFoldersConfig {
  /** Folder naming pattern (default: uses item name) */
  folderNaming?: string
}

/**
 * Mark a property as stored in separate folders.
 * Items in this array property will each be saved to their own folder.
 */
export function separateFolders(config?: SeparateFoldersConfig): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    setPropertyMetadata(target.constructor, propertyKey, METADATA_KEYS.SEPARATE_FOLDERS, {
      folderNaming: config?.folderNaming
    })
  }
}

/**
 * Check if a property uses separate folders
 */
export function hasSeparateFolders(target: unknown, propertyKey: string | symbol): boolean {
  return getPropertyMetadata(target, propertyKey, METADATA_KEYS.SEPARATE_FOLDERS) !== undefined
}

/**
 * Get separate folders config for a property
 */
export function getSeparateFoldersConfig(target: unknown, propertyKey: string | symbol): SeparateFoldersConfig | undefined {
  return getPropertyMetadata(target, propertyKey, METADATA_KEYS.SEPARATE_FOLDERS) as SeparateFoldersConfig | undefined
}

/**
 * Get all properties with separate folders
 */
export function getSeparateFoldersProperties(target: unknown): Map<string | symbol, SeparateFoldersConfig> {
  return getAllPropertyMetadata(target, METADATA_KEYS.SEPARATE_FOLDERS) as Map<string | symbol, SeparateFoldersConfig>
}

// ============================================================================
// @fileNaming Decorator
// ============================================================================

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

// ============================================================================
// Utility Functions
// ============================================================================

/** All decorator metadata for a class */
export interface AllMetadata {
  trackable: TrackableConfig | undefined
  searchable: SearchableConfig | undefined
  fileNaming: FileNamingConfig | undefined
  trackableProperties: Map<string | symbol, TrackableConfig>
  searchableProperties: Map<string | symbol, SearchableConfig>
  nonSerialisedProperties: Set<string | symbol>
  separateFilesProperties: Map<string | symbol, SeparateFilesConfig>
  separateFoldersProperties: Map<string | symbol, SeparateFoldersConfig>
}

/**
 * Get all decorator metadata for a class
 */
export function getAllMetadata(target: unknown): AllMetadata {
  return {
    trackable: getTrackableConfig(target),
    searchable: getSearchableConfig(target),
    fileNaming: getFileNamingConfig(target),
    trackableProperties: getTrackableProperties(target),
    searchableProperties: getSearchableProperties(target),
    nonSerialisedProperties: getNonSerialisedProperties(target),
    separateFilesProperties: getSeparateFilesProperties(target),
    separateFoldersProperties: getSeparateFoldersProperties(target)
  }
}

/**
 * Serialize an object respecting @NonSerialised decorators
 */
export function serializeWithDecorators(target: unknown, obj: Record<string, unknown>): Record<string, unknown> {
  const nonSerialised = getNonSerialisedProperties(target)
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (!nonSerialised.has(key)) {
      result[key] = value
    }
  }

  return result
}
