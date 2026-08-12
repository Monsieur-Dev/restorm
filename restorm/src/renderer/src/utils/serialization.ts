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

import { deriveStableId, idPathSegment } from '../../../shared/utils/stableId'
import { normalizeValueType } from './normalizeValueType'

export { generateId, stripIds, prepareForSerialization, canonicalizeSerializedKeys, CANONICAL_KEY_PRIORITY } from '../../../shared/utils/serialization'

/**
 * Recursively generate 'id' properties for all objects that should have them.
 * This function adds ids to objects matching known collection types (see
 * `idPathSegment` in `shared/utils/stableId.ts`, which is both the
 * classifier and the derivation grammar).
 *
 * Documents (folders, environments, requests) persist their ids now, so
 * the usual path is to keep whatever id the file carries. Two edge cases
 * still require a fresh id:
 *   1. the object has no id (legacy file written before id persistence, or
 *      an object freshly built in memory);
 *   2. the id is already in use elsewhere in the same load — e.g. the user
 *      copy-pasted a document inside the project file. Keeping
 *      duplicate ids would make per-request persistence (env selection,
 *      workbench tab layout, …) collide between the original and the copy.
 *
 * In both cases the replacement is DERIVED from the entity's position in
 * the document (`deriveStableId`), never random: the same bytes must yield
 * the same ids in every process, because the git diff and the 3-way
 * conflict model pair entities by id across independent parses. A random
 * backfill made those pairings fail wholesale on any file whose ids are
 * not yet persisted — see `shared/utils/stableId.ts` for the full story.
 *
 * The derivation path is SEMANTIC, not positional: a container contributes
 * its key name, an array contributes nothing, and an entity contributes an
 * identity segment built from its name/key/type. So inserting an item at
 * the head of a folder leaves its siblings' ids alone, which is what lets
 * `ours` and `theirs` still pair up after one side added something.
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
  // How many entities already claimed a given path. Two siblings can spell
  // the same identity segment (two folders with the same name); the second
  // one takes an occurrence suffix so the two subtrees stay distinct. The
  // count is per PATH, and entities sharing a path always share a container,
  // so the suffix follows array order — never the object key order, which
  // varies between builds.
  const occupiedPaths = new Map<string, number>()

  const walk = <U>(value: U, path: readonly string[]): U => {
    if (value === null || value === undefined) return value
    if (Array.isArray(value)) {
      // An array contributes no segment of its own: an index would make
      // every sibling's id shift when an item is inserted above it.
      return value.map((item: unknown) => walk(item, path)) as U
    }
    if (typeof value !== 'object') return value

    const record = value as Record<string, unknown>
    const result: Record<string, unknown> = { ...record }
    const segment = idPathSegment(record)
    const isKeyValueLike = segment !== null && 'key' in record && 'value' in record && typeof record['key'] === 'string'

    let childPath = path
    if (segment !== null) {
      childPath = claimPath(path, segment, occupiedPaths)
      const existing = typeof record['id'] === 'string' ? record['id'] : undefined
      if (!existing || seen.has(existing)) {
        result['id'] = deriveUnusedId(childPath, seen)
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
        // A plain container contributes its own key name, so the path
        // reads `… folder:Pet / items / req:http:Find pet by ID`.
        result[key] = walk(v, [...childPath, key])
      }
    }
    return result as U
  }

  return walk(obj, [])
}

/**
 * Reserve an entity's derivation path, disambiguating a segment two
 * siblings spell identically (two same-named folders in one parent) with a
 * `#<occurrence>` element. The suffix is its own path element rather than
 * glued onto the segment, so an entity literally named `#1` can never
 * masquerade as the second occurrence of an unnamed one.
 */
function claimPath(parentPath: readonly string[], segment: string, occupied: Map<string, number>): string[] {
  const basePath = [...parentPath, segment]
  const key = JSON.stringify(basePath)
  const occurrence = occupied.get(key) ?? 0
  occupied.set(key, occurrence + 1)
  return occurrence === 0 ? basePath : [...basePath, `#${occurrence}`]
}

/**
 * The derived id for a path, walked forward until it lands on one no other
 * entity in this load already holds. Two entities only reach the same
 * derived id when a THIRD one already carries that exact value as a
 * persisted id — vanishingly rare, and resolved deterministically here
 * rather than by falling back to randomness.
 */
function deriveUnusedId(path: readonly string[], seen: ReadonlySet<string>): string {
  let candidate = deriveStableId(path)
  for (let attempt = 0; seen.has(candidate); attempt++) {
    candidate = deriveStableId([...path, `#collision${attempt}`])
  }
  return candidate
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

/**
 * Rehydrate persisted ValueType POJOs (`{ type, value, … }`) into class
 * instances, IN PLACE of nothing else — no id generation, no path bookkeeping.
 *
 * The `mcp:tree-replace` mirror needs exactly this half of the open-file
 * pipeline: its payload already carries every runtime id (they MUST survive
 * verbatim or the mirror stops matching the main-side tree), but its values
 * are plain JSON. Without revival, `instanceof` checks downstream fail and an
 * expression variable renders as a plain string until the project is reopened.
 */
export function reviveValueTypesDeep<T>(data: T): T {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (typeof node !== 'object' || node === null) return node
    const record = node as Record<string, unknown>
    const isKeyValueLike = 'key' in record && 'value' in record && typeof record['key'] === 'string'
    // Scenario-node config bags are opaque to the open-file walk too — the
    // engine owns their shape; normalizing inside would diverge from open().
    const isScenarioNode = 'kind' in record && 'config' in record
    const result: Record<string, unknown> = { ...record }
    for (const [key, v] of Object.entries(result)) {
      if (isScenarioNode && key === 'config') continue
      if (isKeyValueLike && key === 'value') {
        result['value'] = normalizeValueType(v)
        continue
      }
      if (typeof v === 'object' && v !== null) {
        result[key] = walk(v)
      }
    }
    return result
  }
  return walk(data) as T
}
