/**
 * Serialization utilities for collections — the process-neutral slice.
 *
 * `generateId` / `stripIds` / `prepareForSerialization` have no dependency
 * on `normalizeValueType` (a renderer-only concern — it rehydrates plain
 * `{ type, value, … }` POJOs into real `ValueType` class instances for the
 * live UI's `instanceof` checks), so they live here and are usable from
 * BOTH processes. `renderer/src/utils/serialization.ts` re-exports these
 * three unchanged for its existing consumers and additionally defines
 * `generateIds` / `processAfterDeserialization` (the id-BACKFILL +
 * class-rehydration pair), which stay renderer-only.
 */

import type { RuntimeId } from '../types/collections'
import { normalizeDocumentValuesForPersistence } from './valuePersistence'

/**
 * Generate a unique identifier (UUID v4)
 */
export function generateId(): RuntimeId {
  return crypto.randomUUID()
}

/**
 * Recursively strip 'id' properties from key-value objects only.
 * Document ids (folders, environments, requests) are now persisted so the
 * per-request settings store (workbench layout, env selection) can key by
 * a stable id instead of a fragile name path. Key-value ids remain runtime-
 * only — they're not user-facing and regenerating them on load is cheap.
 *
 * @param obj - The object to strip ids from
 * @returns A new object with key-value ids removed
 */
export function stripIds<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item: unknown) => stripIds(item)) as T
  }

  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>
    const isKeyValueLike = 'key' in record && 'value' in record && typeof record['key'] === 'string'
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      if (key === 'id' && isKeyValueLike) {
        continue
      }
      result[key] = stripIds(value)
    }
    return result as T
  }

  return obj
}

/**
 * Prepare collections data for serialization (save to file).
 * Strips all runtime-only id properties.
 *
 * @param data - The collections data with { collections: Folder[] }
 * @returns Data ready for JSON/YAML serialization
 */
export function prepareForSerialization<T>(data: T): T {
  const stripped = stripIds(data)
  // Ensure ValueType objects are persisted as { type, ... } and never as plain strings.
  // Also ensures SecretValue never persists its resolved plaintext in the main file.
  normalizeDocumentValuesForPersistence(stripped)
  return stripped
}
