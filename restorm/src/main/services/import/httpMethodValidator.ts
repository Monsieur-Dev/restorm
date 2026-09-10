import { HTTP_METHODS, type HTTPMethod } from '../../../shared/models'

/** Type guard that checks whether a string is a valid HTTPMethod */
export function isHTTPMethod(value: string): value is HTTPMethod {
  return (HTTP_METHODS as readonly string[]).includes(value)
}

/** Convert an optional string to a valid HTTPMethod, defaulting to GET */
export function toHTTPMethod(method?: string): HTTPMethod {
  if (!method) return 'GET'
  const upper = method.toUpperCase()
  if (isHTTPMethod(upper)) {
    return upper
  }
  return 'GET'
}

/**
 * Normalise a method token from an import source for storage on a request.
 *
 * Unlike {@link toHTTPMethod}, an UNKNOWN verb is preserved (uppercased) rather
 * than coerced to `GET`: OpenAPI 3.2 `additionalOperations` can carry custom
 * verbs (`PURGE`, `LINK`, …), and Restorm's request model accepts an arbitrary
 * method token (the verb picker is not a bounded list), so importing one as
 * `GET` would silently corrupt it. Empty / missing still defaults to `GET`.
 */
export function normalizeImportedMethod(method?: string): string {
  if (!method) return 'GET'
  return method.toUpperCase()
}
