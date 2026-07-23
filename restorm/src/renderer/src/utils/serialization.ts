/**
 * Serialization utilities for collections
 * Handles stripping and generating runtime-only properties (id fields)
 *
 * `generateId` / `stripIds` / `prepareForSerialization` have no dependency
 * on `normalizeValueType` below (a renderer-only concern) and now live in
 * `shared/utils/serialization.ts` so main-process code (the git MCP tools'
 * diff engine) can use them too — re-exported here unchanged so every
 * existing renderer import of this file keeps working. `generateIds` /
 * `processAfterDeserialization` stay here: they rehydrate persisted
 * `{ type, value, … }` POJOs into real `ValueType` class instances for the
 * live UI's `instanceof` checks, which only the renderer needs.
 */

import { generateId } from '../../../shared/utils/serialization'
import { normalizeValueType } from './normalizeValueType'

export { generateId, stripIds, prepareForSerialization, canonicalizeSerializedKeys, CANONICAL_KEY_PRIORITY } from '../../../shared/utils/serialization'

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

    // A scenario node's `config` is an opaque per-kind bag, not a document:
    // stamping runtime ids inside it is meaningless AND harmful. An
    // `httpRequest` node's config carries `requestId`, which the
    // "is this a response?" heuristic below matches — so every open
    // minted a fresh id there and the next save persisted it. Two people
    // opening the same project got different ids on a node neither had
    // touched, and the node then showed up as conflicting. Leave the bag
    // alone, and drop any id a previous version already wrote into it.
    const isScenarioNode = 'kind' in record && 'config' in record
    if (isScenarioNode && typeof result['config'] === 'object' && result['config'] !== null) {
      const { id: _staleRuntimeId, ...config } = result['config'] as Record<string, unknown>
      result['config'] = config
    }

    for (const [key, v] of Object.entries(result)) {
      if (key === 'id') continue
      if (isScenarioNode && key === 'config') continue
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
    const requestTypes = ['http', 'graphql', 'grpc', 'soap', 'websocket', 'sse', 'odata', 'auth', 'amqp']
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
 * Drop `createdAt` / `updatedAt` from every saved quick-config found in the
 * graph.
 *
 * The two fields were written since quick-configs existed but never read
 * by anything, and files in the wild carry corrupted values (a `Date` that
 * went through the serializer's key walk came back out as `{}`). Removing
 * them on load means the next save rewrites the file without them, so a
 * project heals itself simply by being opened — no separate migration step
 * and no dead field left in the diffs.
 */
function dropQuickConfigTimestamps<T>(data: T): T {
  if (data === null || typeof data !== 'object') return data
  if (data instanceof Date) return data
  if (Array.isArray(data)) return data.map((item: unknown) => dropQuickConfigTimestamps(item)) as T
  const record = data as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    // Only inside a quick-config: `createdAt` elsewhere in the document is
    // none of this function's business.
    const isQuickConfigTimestamp = (key === 'createdAt' || key === 'updatedAt') &&
      'storageTarget' in record && 'fields' in record
    if (isQuickConfigTimestamp) continue
    result[key] = dropQuickConfigTimestamps(value)
  }
  return result as T
}

/**
 * Process deserialized data by generating runtime ids.
 *
 * @param data - The raw deserialized data
 * @returns Data with generated runtime ids
 */
export function processAfterDeserialization<T>(data: T): T {
  return generateIds(dropQuickConfigTimestamps(data))
}
