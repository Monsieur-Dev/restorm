/**
 * Centralized predicate + helper for the "auto-disable empty rows" rule.
 *
 * The rule: a header / query param / path param / metadata row whose
 * `value` resolves to an empty string is sent over the wire as
 * `?name=&...` — which a non-trivial number of APIs reject (e.g. APIs
 * that validate query params against a regex requiring at least one
 * character). We want the friendly default to be: empty values are
 * NOT sent unless the user explicitly opts in by re-enabling the row.
 *
 * Two enforcement points use this helper:
 *  - Importers: every freshly-imported KV row whose value resolves to
 *    empty is created with `enabled: false`.
 *  - Renderer KV table: on value change, the enabled flag tracks
 *    emptiness automatically (empty → unchecked; non-empty → checked).
 *
 * The user keeps the escape hatch — they can manually re-enable an
 * empty row whenever they need the literal `?filter=` semantic.
 */

import type { KeyValue } from '../types/baseTypes'

/**
 * Returns `true` when the row's value resolves to an empty string.
 * Uses `toString()` (defined on every `ValueType` subclass) so the
 * predicate handles `StringValue`, `PasswordValue`, `ExpressionValue`,
 * `NumericValue`, etc. uniformly. Whitespace-only values count as
 * empty since trailing whitespace in a query param is rarely
 * intentional and usually a paste artefact.
 */
export function isKeyValueValueEmpty(kv: KeyValue): boolean {
  return kv.value.toString().trim() === ''
}

/**
 * Mutates `arr` in place, flipping `enabled: false` on every entry
 * whose value is empty. Used by importers after they've populated
 * headers / params / pathParams from a spec where blank defaults are
 * the norm (e.g. OpenAPI parameters with no `example` / no `default`).
 *
 * Non-empty rows are left alone (preserves any explicit `enabled`
 * value the importer set — usually `true`). When `arr` is undefined,
 * this is a no-op.
 */
export function disableEmptyKeyValues(arr: KeyValue[] | undefined): void {
  if (!arr) return
  for (const kv of arr) {
    if (isKeyValueValueEmpty(kv)) {
      kv.enabled = false
    }
  }
}
