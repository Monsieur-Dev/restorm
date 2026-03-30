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
