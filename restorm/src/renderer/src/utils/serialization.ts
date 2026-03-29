/**
 * Serialization utilities for collections
 * Handles stripping and generating runtime-only properties (id fields)
 */

import type { RuntimeId } from '../../../shared/types/collections'
import { normalizeDocumentValuesForPersistence } from '../../../shared/utils/valuePersistence'

/**
 * Generate a unique identifier (UUID v4)
 */
export function generateId(): RuntimeId {
  return crypto.randomUUID()
}

/**
 * Recursively strip all 'id' properties from an object for serialization.
 * Creates a deep clone without any 'id' fields.
 *
 * @param obj - The object to strip ids from
 * @returns A new object without id properties
 */
export function stripIds<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item: unknown) => stripIds(item)) as T
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'id') {
        continue // Skip id properties
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
 * @param obj - The deserialized object to add ids to
 * @returns The object with generated ids
 */
export function generateIds<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item: unknown) => generateIds(item)) as T
  }

  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>
    const result: Record<string, unknown> = { ...record }

    // Check if this object should have an id based on its structure
    if (shouldHaveId(record)) {
      result['id'] = generateId()
    }

    // Recursively process nested properties
    for (const [key, value] of Object.entries(result)) {
      if (key !== 'id' && typeof value === 'object' && value !== null) {
        result[key] = generateIds(value)
      }
    }

    return result as T
  }

  return obj
}

/**
 * Determine if an object should have an id based on its structure.
 * This matches known collection types:
 * - KeyValue: has 'key' and 'value' properties
 * - Environment: has 'name' and 'variables' properties
 * - Request types: has 'name' and 'type' properties (http, graphql, grpc, soap, websocket)
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

  // Request types: has name and type (http, graphql, grpc, soap, websocket)
  if ('name' in obj && 'type' in obj) {
    const requestTypes = ['http', 'graphql', 'grpc', 'soap', 'websocket']
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
  // Also ensures PasswordValue never persists its actual value in the main file.
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
