/**
 * @TreatEmptyAsUndefined Decorator
 *
 * Marks a string property so that `null`, `undefined`, and the empty
 * string `""` are all treated as equivalent (normalized to `undefined`)
 * before checksum calculation and before serialization.
 *
 * Whitespace-only strings (e.g. `"   "`) are intentionally **not**
 * normalized — only the strict empty string collapses.
 *
 * Typical use case: rich-text editors (Milkdown etc.) that leave `""`
 * behind when the user backspaces all content. Without this decorator,
 * an empty note would register as a change vs. a never-filled field.
 */

import { METADATA_KEYS, setPropertyMetadata, getPropertyMetadata, getAllPropertyMetadata } from './metadata'

export function TreatEmptyAsUndefined(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    setPropertyMetadata(target.constructor, propertyKey, METADATA_KEYS.TREAT_EMPTY_AS_UNDEFINED, true)
  }
}

/** Check if a property is marked with @TreatEmptyAsUndefined. */
export function isTreatedEmptyAsUndefined(target: unknown, propertyKey: string | symbol): boolean {
  return getPropertyMetadata(target, propertyKey, METADATA_KEYS.TREAT_EMPTY_AS_UNDEFINED) === true
}

/** Return the set of all `@TreatEmptyAsUndefined`-marked properties on a class. */
export function getTreatEmptyAsUndefinedProperties(target: unknown): Set<string | symbol> {
  const result = new Set<string | symbol>()
  const map = getAllPropertyMetadata(target, METADATA_KEYS.TREAT_EMPTY_AS_UNDEFINED)
  for (const [key, value] of map) {
    if (value === true) result.add(key)
  }
  return result
}

/**
 * Apply `@TreatEmptyAsUndefined` normalization to an in-memory record
 * using the metadata registered on `classConstructor`. Returns a new
 * object — does not mutate the input. Non-string values are left
 * untouched, even when the property carries the marker.
 */
export function normalizeTreatEmptyAsUndefined(
  data: Record<string, unknown>,
  classConstructor: unknown
): Record<string, unknown> {
  const marked = getTreatEmptyAsUndefinedProperties(classConstructor)
  if (marked.size === 0) return data
  const out: Record<string, unknown> = { ...data }
  for (const key of marked) {
    if (typeof key !== 'string') continue
    const value = out[key]
    if (value === null || value === '' || value === undefined) {
      out[key] = undefined
    }
  }
  return out
}
