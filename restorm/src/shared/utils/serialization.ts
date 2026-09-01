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

  // A Date has no own enumerable keys, so walking it like a plain object
  // returns `{}` — silently destroying the value. Anything that arrives
  // here already deserialized (the git merge write-back rehydrates
  // timestamps) must survive; both YAML and JSON render a Date correctly
  // on their own.
  if (obj instanceof Date) return obj

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
 * The persisted key-order contract. When a project document is serialized,
 * every object's own keys are emitted in a deterministic order: first the
 * keys below, in THIS exact sequence (when present), then all remaining
 * keys in ascending Unicode code-point order. Array element order is never
 * touched.
 *
 * This is what makes an open→save byte-identical and keeps git diffs
 * readable — the on-disk shape no longer depends on the in-memory property
 * insertion order, which otherwise varies by construction path (parsed-file
 * order vs class field order, an `id` backfilled at the tail of a legacy
 * object, a default like `tagColors` injected on load). The leading keys
 * are the identity / label fields a reader scans first.
 *
 * Treat this list as a STABLE CONTRACT: reordering or removing an entry
 * reformats every existing project file once on its next save. See
 * `docs/git-integration.md` (Deterministic serialization).
 */
export const CANONICAL_KEY_PRIORITY: readonly string[] = [
  'id',
  'name',
  'key',
  'type',
  'folderType',
  'method',
  'url',
  // Adding an entry to this list is normally a one-time reformat of every
  // file that carries the key. This one is inert BY CONSTRUCTION: no
  // existing document carries `fileFormatVersion` at its root, so ordering
  // it cannot reorder anything already on disk — only files this code
  // writes from now on can contain it.
  //
  // It earns the place because alphabetical order would put it AFTER the
  // whole `collections` block, at the very bottom of the file, and a
  // format stamp exists to be the first thing a reader — human or tool —
  // sees.
  'fileFormatVersion'
]

/** Compare two object keys per the {@link CANONICAL_KEY_PRIORITY} contract:
 * a priority key always precedes a non-priority key; two priority keys keep
 * their list order; two non-priority keys sort by Unicode code point. */
function canonicalKeyCompare(a: string, b: string): number {
  const ia = CANONICAL_KEY_PRIORITY.indexOf(a)
  const ib = CANONICAL_KEY_PRIORITY.indexOf(b)
  if (ia !== -1 && ib !== -1) return ia - ib
  if (ia !== -1) return -1
  if (ib !== -1) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Recursively rewrite an object graph so every object's own keys follow the
 * canonical order (see {@link CANONICAL_KEY_PRIORITY}). Arrays are mapped
 * element-by-element with their order preserved; primitives pass through
 * unchanged. Returns a NEW graph — the input is not mutated.
 *
 * Order is imposed by an explicit comparator, never by insertion order, so
 * the same logical document always serializes to the same bytes regardless
 * of how it was built in memory.
 */
export function canonicalizeSerializedKeys<T>(data: T): T {
  if (data === null || typeof data !== 'object') return data
  if (Array.isArray(data)) {
    return data.map((item: unknown) => canonicalizeSerializedKeys(item)) as T
  }
  // Same reason as in `stripIds`: reordering a Date's (empty) key set
  // would replace the value with `{}`.
  if (data instanceof Date) return data
  const record = data as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort(canonicalKeyCompare)) {
    result[key] = canonicalizeSerializedKeys(record[key])
  }
  return result as T
}

/**
 * Thrown when a document is too large to serialize: `JSON.stringify` of a
 * graph whose text would exceed V8's maximum string length (~512 MB) throws
 * `RangeError: Invalid string length`. That is a real ceiling a normal
 * project never reaches, but a pathological import (e.g. a gRPC reflection
 * schema that fans out enormously) can. We convert the opaque RangeError into
 * this typed, user-actionable failure so the save path can tell the user
 * "this project is too large to save" instead of logging an inscrutable error
 * or crashing the renderer with an unhandled exception.
 */
export class ProjectTooLargeError extends Error {
  constructor(cause?: unknown) {
    super('The project is too large to serialize')
    this.name = 'ProjectTooLargeError'
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause
  }
}

/**
 * `JSON.stringify` guarded against the oversized-document `RangeError`.
 *
 * A document large enough that its serialized text exceeds the max JS string
 * length makes `JSON.stringify` throw `RangeError: Invalid string length`.
 * Left raw, that surfaces as an opaque logged error or an unhandled renderer
 * crash. Here it becomes a {@link ProjectTooLargeError} the save path can
 * catch and turn into a clear message; any other stringify error (a circular
 * reference, a throwing `toJSON`) is a genuine bug and is rethrown unchanged.
 */
export function stringifyDocument(data: unknown): string {
  try {
    return JSON.stringify(data)
  } catch (error) {
    if (error instanceof RangeError) throw new ProjectTooLargeError(error)
    throw error
  }
}

/**
 * Deep-clone a document graph through JSON, guarded by {@link
 * stringifyDocument}. This is the `JSON.parse(JSON.stringify(x))` idiom the
 * save paths use to run every `toJSON()` and produce a plain POJO — the
 * `stringify` half is exactly where an oversized project throws, so the
 * guard lives here rather than being repeated at each call site.
 */
export function cloneDocumentForSerialization<T>(data: T): T {
  return JSON.parse(stringifyDocument(data)) as T
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
  // Impose a deterministic, insertion-order-independent key order so an
  // open→save is byte-identical and the semantic git diff (which compares
  // stringified own-field snapshots) never reports a shape-only change.
  return canonicalizeSerializedKeys(stripped)
}
