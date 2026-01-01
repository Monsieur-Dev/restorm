/**
 * @NonSerialised Decorator
 */

import { METADATA_KEYS, setPropertyMetadata, getPropertyMetadata, getAllPropertyMetadata } from './metadata'

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
