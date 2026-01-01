/**
 * Metadata Storage for Decorators
 */

/** Metadata keys for decorators */
export const METADATA_KEYS = {
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
export function getClassMetadata(target: unknown, key: symbol): unknown {
  const classMap = metadataStorage.get(target)
  if (!classMap) return undefined
  return classMap.get(key)
}

/**
 * Set metadata for a class
 */
export function setClassMetadata(target: unknown, key: symbol, value: unknown): void {
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
export function getPropertyMetadata(target: unknown, propertyKey: string | symbol, key: symbol): unknown {
  const classMap = propertyMetadataStorage.get(target)
  if (!classMap) return undefined
  const propMap = classMap.get(propertyKey)
  if (!propMap) return undefined
  return propMap.get(key)
}

/**
 * Set metadata for a property
 */
export function setPropertyMetadata(target: unknown, propertyKey: string | symbol, key: symbol, value: unknown): void {
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
export function getAllPropertyMetadata(target: unknown, key: symbol): Map<string | symbol, unknown> {
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
