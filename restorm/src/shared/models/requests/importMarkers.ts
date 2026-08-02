import type { ImportOrigin } from '../../types/requests/BaseRequest'

/**
 * The cross-protocol markers an imported request carries: the link
 * back to its source operation, plus the two lifecycle flags the
 * sidebar renders (dimmed / struck-through).
 *
 * They belong to every request class rather than to one protocol, so
 * they are declared once here and folded into each class's
 * `fromPlain` / `toPlainObject` instead of being restated fifteen
 * times.
 *
 * **They must round-trip.** `runIdempotentImport` matches an existing
 * request back to its source operation through `importOrigin`; a
 * serializer that drops it turns the next refresh into a full
 * re-import — every operation re-added as a duplicate, and no
 * previously-imported request left to flag as removed. `removed` and
 * `deprecated` have the same requirement in the other direction: the
 * pipeline writes them, and the tree they are written onto is
 * reloaded from disk on the next session.
 */
export interface ImportMarkerFields {
  importOrigin?: ImportOrigin
  deprecated?: boolean
  removed?: boolean
}

/**
 * The subset of {@link ImportMarkerFields} that `source` actually
 * defines, shaped for spreading into a `fromPlain` constructor
 * payload or a `toPlainObject` result. Undefined markers are omitted
 * so they never materialise as explicit `null`s on disk.
 */
export function pickImportMarkers(source: ImportMarkerFields): ImportMarkerFields {
  return {
    ...(source.importOrigin !== undefined && { importOrigin: source.importOrigin }),
    ...(source.deprecated !== undefined && { deprecated: source.deprecated }),
    ...(source.removed !== undefined && { removed: source.removed })
  }
}
