import { HTTP_METHODS, type HTTPMethod } from '../models/types'

/** The well-known HTTP verbs, in canonical upper-case, in display order. */
export const KNOWN_HTTP_METHODS: readonly HTTPMethod[] = HTTP_METHODS

/** Set of the well-known verb tokens, in their canonical upper-case form. */
const KNOWN_METHODS: ReadonlySet<string> = new Set(HTTP_METHODS)

/**
 * Whether `value` (once upper-cased) is one of the well-known HTTP verbs the
 * app offers as ready-made choices (GET/POST/…/QUERY).
 */
export function isKnownHttpMethod(value: string): value is HTTPMethod {
  return KNOWN_METHODS.has(value.toUpperCase())
}

/**
 * Canonicalize an HTTP method token for the wire.
 *
 * HTTP method tokens are case-sensitive (RFC 9110 §5.1.1), but the standard
 * verbs are upper-case by convention, so `post` / `PoSt` must go out as `POST`.
 * A CUSTOM/unknown verb, however, must be sent VERBATIM — a server may define a
 * case-sensitive token like `Machin`, and force-upper-casing it would send the
 * wrong method. So: known verb → upper-case; anything else → passed through
 * untouched (only surrounding whitespace trimmed).
 */
export function canonicalizeHttpMethod(method: string): string {
  const trimmed = method.trim()
  const upper = trimmed.toUpperCase()
  return KNOWN_METHODS.has(upper) ? upper : trimmed
}
