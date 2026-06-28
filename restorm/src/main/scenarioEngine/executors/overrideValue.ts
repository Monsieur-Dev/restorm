/**
 * Coercion of a scenario-action override value to the wire form a request field
 * holds. An override reaches the executor in one of two shapes:
 *
 *  - an INLINE literal, persisted by the renderer's `TypedValueField` as a
 *    typed-value object (`{ type: 'string', value }`, `{ type: 'variable',
 *    value }`, …; see `serializeValueForPersistence`), or
 *  - a WIRED-edge value, a bare runtime value produced by an upstream node.
 *
 * The HTTP-family slot merge wants a wire STRING; the streaming connect/listen
 * field merge wants the field's natural shape (a string for url/topic, but an
 * OBJECT for a server-config field). Both reuse the same unwrap so an inline
 * typed literal resolves identically wherever it's applied.
 */

/** The persisted-value `type` tags the renderer writes for an inline override. */
const PERSISTED_VALUE_TYPES = new Set([
  'string', 'numeric', 'boolean', 'datetime', 'color', 'expression', 'variable', 'environment', 'secret', 'null'
])

interface PersistedScalar { type: string; value?: unknown }

/** A persisted typed-value object (gated on a known `type` tag so a wired data
 * object that merely happens to carry a `type` key is NOT treated as one). */
function isPersistedScalar(value: unknown): value is PersistedScalar {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const t = (value as { type?: unknown }).type
  return typeof t === 'string' && PERSISTED_VALUE_TYPES.has(t)
}

/** Resolve a recognised persisted typed value to its wire string. A `variable`
 * / `environment` becomes its `{{handlebars}}` token so the executor's context
 * resolution still applies; other scalar kinds become their string form; a
 * secret/null can't be inlined as wire text → empty. */
function persistedScalarToWire(v: PersistedScalar): string {
  switch (v.type) {
    case 'variable':
    case 'environment':
      return typeof v.value === 'string' && v.value !== '' ? `{{${v.value}}}` : ''
    case 'null':
    case 'secret':
      return ''
    default:
      return stringifyToWire(v.value)
  }
}

/** Stringify a bare runtime value to wire form (objects → JSON). */
export function stringifyToWire(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  return ''
}

/** Unwrap an override value to a wire STRING (HTTP-family slot merge). */
export function persistedOverrideToWire(value: unknown): string {
  if (isPersistedScalar(value)) return persistedScalarToWire(value)
  return stringifyToWire(value)
}

/** Coerce an override value for the STREAMING field merge: an inline typed
 * scalar resolves to its wire string, but any other value (a bare string, or an
 * OBJECT like a server-config field) passes through unchanged. */
export function coercePersistedOverride(value: unknown): unknown {
  if (isPersistedScalar(value)) return persistedScalarToWire(value)
  return value
}
