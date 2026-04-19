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
  FILE_NAMING: Symbol('fileNaming'),
  TREAT_EMPTY_AS_UNDEFINED: Symbol('treatEmptyAsUndefined')
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
 * Get metadata for a property, walking the class's prototype chain so
 * decorators applied to a base class are inherited by subclasses.
 */
export function getPropertyMetadata(target: unknown, propertyKey: string | symbol, key: symbol): unknown {
  let current: unknown = target
  while (current) {
    const classMap = propertyMetadataStorage.get(current)
    if (classMap) {
      const propMap = classMap.get(propertyKey)
      if (propMap) {
        const value = propMap.get(key)
        if (value !== undefined) return value
      }
    }
    current = (current as { prototype?: { constructor?: unknown } } | null)?.prototype && Object.getPrototypeOf(current as object)
    if (current === Object.prototype || current === null) break
  }
  return undefined
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
 * Get all property metadata for a class, walking the prototype chain so
 * base-class decorators (e.g. `@TreatEmptyAsUndefined` on `BaseDocument`)
 * merge into the subclass view. A subclass entry wins over its parent for
 * the same property key.
 */
export function getAllPropertyMetadata(target: unknown, key: symbol): Map<string | symbol, unknown> {
  const result = new Map<string | symbol, unknown>()
  const chain: unknown[] = []
  let current: unknown = target
  while (current && current !== Object.prototype) {
    chain.push(current)
    current = Object.getPrototypeOf(current as object)
  }
  // Walk base → subclass so subclass entries overwrite parent ones.
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const classMap = propertyMetadataStorage.get(chain[i])
    if (!classMap) continue
    for (const [propKey, propMap] of classMap) {
      const value = propMap.get(key)
      if (value !== undefined) {
        result.set(propKey, value)
      }
    }
  }
  return result
}
