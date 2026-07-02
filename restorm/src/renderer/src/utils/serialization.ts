/**
 * Serialization utilities for collections
 * Handles stripping and generating runtime-only properties (id fields)
 */

import type { RuntimeId } from '../../../shared/types/collections'
import { normalizeDocumentValuesForPersistence } from '../../../shared/utils/valuePersistence'
import { normalizeValueType } from './normalizeValueType'

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
 * Recursively generate 'id' properties for all objects that should have them.
 * This function adds ids to objects matching known collection types.
 *
 * Documents (folders, environments, requests) persist their ids now, so
 * the usual path is to keep whatever id the file carries. Two edge cases
 * still require a fresh id:
 *   1. the object has no id (legacy file written before id persistence, or
 *      an object freshly built in memory);
 *   2. the id is already in use elsewhere in the same load — e.g. the user
 *      copy-pasted a document between sub-folders in folder mode. Keeping
 *      duplicate ids would make per-request persistence (env selection,
 *      workbench tab layout, …) collide between the original and the copy.
 *
 * Tracking ids in a `seen` Set scoped to the top-level call is enough —
 * every traversal gets a fresh set so reloading the same file keeps its
 * persisted ids intact.
 *
 * @param obj - The deserialized object to add ids to
 * @returns The object with generated ids
 */
export function generateIds<T>(obj: T): T {
  const seen = new Set<string>()

  const walk = <U>(value: U): U => {
    if (value === null || value === undefined) return value
    if (Array.isArray(value)) {
      return value.map((item: unknown) => walk(item)) as U
    }
    if (typeof value !== 'object') return value

    const record = value as Record<string, unknown>
    const result: Record<string, unknown> = { ...record }
    const isKeyValueLike = shouldHaveId(record) && 'key' in record && 'value' in record && typeof record['key'] === 'string'

    if (shouldHaveId(record)) {
      const existing = typeof record['id'] === 'string' ? record['id'] : undefined
      if (!existing || seen.has(existing)) {
        result['id'] = generateId()
      }
      seen.add(result['id'] as string)
    }

    for (const [key, v] of Object.entries(result)) {
      if (key === 'id') continue
      if (isKeyValueLike && key === 'value') {
        // Rehydrate persisted ValueType POJOs (`{ type, value, … }`)
        // into real class instances. The runtime UI (cell renderers,
        // resolve paths) uses `instanceof` checks that fail on plain
        // objects, so without this step a loaded `ExpressionValue`
        // renders as a plain string and never substitutes.
        result['value'] = normalizeValueType(v)
        continue
      }
      if (typeof v === 'object' && v !== null) {
        result[key] = walk(v)
      }
    }
    return result as U
  }

  return walk(obj)
}

/**
 * Determine if an object should have an id based on its structure.
 * This matches known collection types:
 * - KeyValue: has 'key' and 'value' properties
 * - Environment: has 'name' and 'variables' properties
 * - Request types: has 'name' and 'type' properties (http, graphql, grpc, soap, websocket, sse, odata, auth)
 * - Folder: has 'name', 'items', and 'configuration' properties
 * - Response types: has 'requestId' property
 */
function shouldHaveId(obj: Record<string, unknown>): boolean {
  // KeyValue: has key and value
  if ('key' in obj && 'value' in obj && typeof obj['key'] === 'string') {
    return true
  }

  // Environment: has name and variables array
  if ('name' in obj && 'variables' in obj && Array.isArray(obj['variables'])) {
    return true
  }

  // Request types — must stay in lockstep with the class resolver's
  // `type` discriminants (HTTPRequest…'http', ODataRequest…'odata',
  // AuthenticationRequest…'auth', …). Omitting one means that request
  // kind gets no runtime id on legacy load and duplicate ids aren't
  // regenerated on copy-paste, colliding in every UUID-keyed
  // per-request store.
  if ('name' in obj && 'type' in obj) {
    const requestTypes = ['http', 'graphql', 'grpc', 'soap', 'websocket', 'sse', 'odata', 'auth']
    if (requestTypes.includes(obj['type'] as string)) {
      return true
    }
  }

  // Folder: has name, items array, and configuration
  if ('name' in obj && 'items' in obj && 'configuration' in obj && Array.isArray(obj['items'])) {
    return true
  }

  // Response types: has requestId
  if ('requestId' in obj && typeof obj['requestId'] === 'string') {
    return true
  }

  return false
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

/**
 * Process deserialized data by generating runtime ids.
 *
 * @param data - The raw deserialized data
 * @returns Data with generated runtime ids
 */
export function processAfterDeserialization<T>(data: T): T {
  return generateIds(data)
}
