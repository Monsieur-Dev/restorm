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
 * Badge-registry id for an HTTP method token. The method itself is NEVER
 * normalized — it is saved and sent verbatim (method tokens are
 * case-sensitive per RFC 9110 §5.1.1, and real servers exist that accept
 * `post` but not `POST`). Only the BADGE lookup is case-insensitive: a
 * well-known verb in any casing maps to its `http_<verb>` registry entry
 * (so "Post" renders on the POST color, labeled "Post"), anything else
 * falls back to `http_other`.
 */
export function httpBadgeIdFor(method: string): string {
  return isKnownHttpMethod(method) ? `http_${method.toLowerCase()}` : 'http_other'
}
