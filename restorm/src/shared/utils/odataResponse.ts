/**
 * OData response envelope normalization.
 *
 * OData v2 / v3 wrap the response in `{ d: { results: [...], __count: "N", __next: "..." } }`
 * (or `{ d: { <entity fields> } }` for single entities). v4 drops
 * the wrapper and exposes `{ "@odata.context": "...", value: [...],
 * "@odata.count": N, "@odata.nextLink": "..." }` directly.
 *
 * This helper reshapes v2/v3 payloads so the UI renders them with
 * the same v4-shaped body it already knows how to display. v4
 * payloads pass through unchanged.
 */

import type { ODataVersion } from '../types/collections'

/** Minimal shape we care about extracting from a normalized payload. */
export interface NormalizedODataPayload {
  /** Always v4-style: collection entries or wrapped single-entity. */
  value?: unknown
  /** Total count when `$count=true` (v4) / `$inlinecount=allpages` (v2/v3). */
  count?: number
  /** Server-side pagination link when present. */
  nextLink?: string
  /** Delta tracking link for v4.01 delta responses (@odata.deltaLink). */
  deltaLink?: string
  /** The full normalized object, with v4 annotations copied in. */
  body: Record<string, unknown>
}

/**
 * Returns true for the v4 family of OData versions (v4, v4.01).
 * Use this in place of `version === 'v4'` so every branch naturally
 * picks up v4.01 without a separate case.
 */
export function isV4Family(version: ODataVersion): boolean {
  return version === 'v4' || version === 'v4.01'
}

/**
 * Normalize a parsed OData response payload against `version`.
 *
 * - For v4: returns the payload untouched, only extracting the
 *   annotations of interest.
 * - For v2/v3: unwraps `d.results` → `value`, `d.__count` → `count`,
 *   `d.__next` → `nextLink`. Single-entity responses (`d` is an
 *   object, not an array) are wrapped into a singleton `value`
 *   array for rendering parity.
 *
 * Returns `null` when `parsed` isn't a plain object the shape of
 * either envelope — callers fall back to rendering the raw body.
 */
export function normalizeODataResponse(
  parsed: unknown,
  version: ODataVersion = 'v4'
): NormalizedODataPayload | null {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }

  const obj = parsed as Record<string, unknown>

  if (isV4Family(version)) {
    const out: NormalizedODataPayload = { body: obj }
    if ('value' in obj) out.value = obj['value']
    const count = obj['@odata.count']
    if (typeof count === 'number') out.count = count
    else if (typeof count === 'string' && /^\d+$/.test(count)) out.count = Number(count)
    const nextLink = obj['@odata.nextLink']
    if (typeof nextLink === 'string' && nextLink !== '') out.nextLink = nextLink
    const deltaLink = obj['@odata.deltaLink']
    if (typeof deltaLink === 'string' && deltaLink !== '') out.deltaLink = deltaLink
    return out
  }

  // v2 / v3 — wrapper is `{ d: … }`.
  const d = obj['d']
  if (d === undefined) {
    // Malformed v2/v3 response (missing `d`). Treat as opaque.
    return { body: obj }
  }

  const normalized: Record<string, unknown> = { '@odata.version': version }
  if (d !== null && typeof d === 'object' && !Array.isArray(d)) {
    const drec = d as Record<string, unknown>
    if ('results' in drec) {
      normalized['value'] = drec['results']
    } else {
      // Single entity — surface as a one-element value[] so consumers
      // have a stable shape, AND keep the raw entity at the top level
      // for callers that want it.
      normalized['value'] = [drec]
      for (const [k, v] of Object.entries(drec)) {
        if (k !== '__count' && k !== '__next') {
          normalized[k] = v
        }
      }
    }
    const rawCount = drec['__count']
    if (typeof rawCount === 'string' && /^\d+$/.test(rawCount)) {
      normalized['@odata.count'] = Number(rawCount)
    }
    const rawNext = drec['__next']
    if (typeof rawNext === 'string' && rawNext !== '') {
      normalized['@odata.nextLink'] = rawNext
    }
  } else {
    normalized['value'] = d
  }

  const out: NormalizedODataPayload = { body: normalized }
  if ('value' in normalized) out.value = normalized['value']
  const count = normalized['@odata.count']
  if (typeof count === 'number') out.count = count
  const nextLink = normalized['@odata.nextLink']
  if (typeof nextLink === 'string') out.nextLink = nextLink
  return out
}

/**
 * Detect whether the response envelope contradicts the version the
 * request is tagged with — e.g. a request marked `v4` whose server
 * answered with a v2/v3 `{ d: … }` wrapper, or a v2/v3 request that got
 * a bare v4 `{ value: … }` payload. Returns the version the envelope
 * actually looks like when it disagrees with `requestVersion`, or
 * `null` when they're consistent (or the shape is inconclusive).
 *
 * The check is deliberately conservative: a single entity, an error
 * payload, or any object without a recognisable collection marker
 * returns `null` so we never cry wolf on a shape we can't classify.
 */
export function detectODataVersionMismatch(
  parsed: unknown,
  requestVersion: ODataVersion
): ODataVersion | null {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const obj = parsed as Record<string, unknown>

  // A `d` wrapper holding `results` (collection) or `__count`/`__next`
  // is the unmistakable v2/v3 signature.
  const d = obj['d']
  const looksV2V3 =
    d !== undefined &&
    d !== null &&
    typeof d === 'object' &&
    ('results' in (d as Record<string, unknown>) ||
      '__count' in (d as Record<string, unknown>) ||
      '__next' in (d as Record<string, unknown>))

  // A v4 OData-Version annotation or a `@odata.*` collection marker is
  // the v4 signature.
  const looksV4 =
    '@odata.context' in obj ||
    '@odata.count' in obj ||
    '@odata.nextLink' in obj ||
    (('value' in obj) && Array.isArray(obj['value']))

  if (looksV2V3 && isV4Family(requestVersion)) return '__count' in (d as Record<string, unknown>) ? 'v2' : 'v3'
  if (looksV4 && (requestVersion === 'v2' || requestVersion === 'v3')) return 'v4'
  return null
}
