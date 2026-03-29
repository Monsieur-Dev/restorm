/**
 * URLResolver - Resolves request URLs with path params, query params and Handlebars context
 *
 * Extracted from ContextService to isolate URL resolution logic.
 */

import type { FullRequestData, ResolvedUrlResult, TransformedContext, TransformValueFn } from './ContextServiceTypes'

/**
 * Calculate the resolved URL for a request.
 *
 * @param data - Full request data containing url, pathParams, params
 * @param envContext - Transformed environment context for Handlebars resolution
 * @param transformValue - Function to resolve Handlebars templates
 * @returns The resolved URL result with baseUrl, queryString and final resolvedUrl
 */
export function resolveUrl(
  data: FullRequestData,
  envContext: TransformedContext,
  transformValue: TransformValueFn
): ResolvedUrlResult {
  // Build cumulative context with path params (non-encoded for resolution)
  const cumulativeContext = { ...envContext }
  const pathParams = data.pathParams ?? []

  for (const pp of pathParams) {
    // Skip disabled path params (enabled defaults to true if undefined)
    if (pp.enabled === false) {
      continue
    }
    if (pp.key) {
      // Resolve using cumulative context (env + previous path params)
      const resolvedKey = transformValue(pp.key, cumulativeContext)
      const resolvedValue = transformValue(pp.value.toString(), cumulativeContext)
      // Store non-encoded value for next iterations (last value wins for same key)
      cumulativeContext[resolvedKey] = resolvedValue
    }
  }

  // Build URL context with URL-encoded values
  const fullContext = { ...envContext }
  for (const [key, value] of Object.entries(cumulativeContext)) {
    if (!(key in envContext)) {
      // Only encode path param values, not env values
      fullContext[key] = encodeURIComponent(value)
    }
  }

  // Transform the URL template
  const baseUrl = transformValue(data.url, fullContext)

  // Build query string from params with cumulative resolution
  const params = data.params ?? []
  const cumulativeParamsContext = { ...envContext }
  const resolvedParams = new Map<string, string>() // key -> resolved value (last wins)

  for (const param of params) {
    // Skip disabled params (enabled defaults to true if undefined)
    if (param.enabled === false) {
      continue
    }
    if (param.key) {
      // Resolve using cumulative context
      const resolvedKey = transformValue(param.key, cumulativeParamsContext)
      const resolvedValue = transformValue(param.value.toString(), cumulativeParamsContext)
      // Store for URL (last value wins for same key)
      resolvedParams.set(resolvedKey, resolvedValue)
      // Add to cumulative context for next params
      cumulativeParamsContext[resolvedKey] = resolvedValue
    }
  }

  const queryParts: string[] = []
  for (const [key, value] of resolvedParams) {
    queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  }
  const queryString = queryParts.join('&')

  // Combine base URL and query string
  let resolvedUrl = baseUrl
  if (queryString) {
    // Determine separator: ?, &, or nothing
    if (baseUrl.endsWith('?') || baseUrl.endsWith('&')) {
      resolvedUrl = baseUrl + queryString
    } else if (baseUrl.includes('?')) {
      resolvedUrl = baseUrl + '&' + queryString
    } else {
      resolvedUrl = baseUrl + '?' + queryString
    }
  }

  return {
    resolvedUrl,
    baseUrl,
    queryString
  }
}
