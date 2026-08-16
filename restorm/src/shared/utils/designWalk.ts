/**
 * Shared exclusion rule for the document tree walks (id backfill, value
 * revival): the parts of an API-design entity that hold user CONTENT
 * rather than document structure.
 *
 * A design entity embeds its documentation object under `doc` (spec
 * descriptions, constraints, free-form examples), and a named example
 * carries a property→value map under `values`. Both are opaque to the
 * walks: a payload inside them can be shaped exactly like a KeyValue row
 * or an id-bearing entity, and stamping ids into it — or reviving it
 * into ValueType instances — would rewrite data the user authored.
 * Same policy as a scenario node's `config` bag.
 */

import { designEntitySegment } from './stableId'

/** `true` when `key` on `record` opens one of the opaque content bags of
 * a design entity — the caller's walk must not descend into it. */
export function isOpaqueDocumentationBag(record: Record<string, unknown>, key: string): boolean {
  if (key === 'doc') {
    return designEntitySegment(record) !== null
  }
  if (key === 'values') {
    // A named example: `name` + a `values` MAP (an EnumDefinition's
    // `values` is an array and stays walkable).
    return 'name' in record && typeof record['values'] === 'object' &&
      record['values'] !== null && !Array.isArray(record['values'])
  }
  return false
}
