/**
 * URLResolver - Resolves request URLs with path params, query params and Handlebars context
 *
 * Extracted from ContextService to isolate URL resolution logic.
 */

import type { FullRequestData, ResolvedUrlResult, TransformedContext, TransformValueFn } from './ContextServiceTypes'
import { ExpressionValue, EnumListValue, EnumValue } from '../../shared/types/collections'

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
      // Only `ExpressionValue` values go through Handlebars — plain
      // strings/numbers/dates etc. are taken literally.
      const raw = pp.value.toString()
      const resolvedValue = pp.value instanceof ExpressionValue
        ? transformValue(raw, cumulativeContext)
        : raw
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
  // Use an array of [key, value] pairs instead of a Map to support
  // repeated keys (EnumListValue with collectionFormat: multi).
  const queryParts: string[] = []

  for (const param of params) {
    if (param.enabled === false) {
      continue
    }
    if (param.key) {
      const resolvedKey = transformValue(param.key, cumulativeParamsContext)

      // EnumListValue: repeat the key for each selected value (multi format)
      if (param.value instanceof EnumListValue || (param.value as { type?: string }).type === 'enumList') {
        const values = (param.value as EnumListValue).value
        for (const v of values) {
          queryParts.push(`${encodeURIComponent(resolvedKey)}=${encodeURIComponent(v)}`)
        }
        cumulativeParamsContext[resolvedKey] = values.join(',')
        continue
      }

      // EnumValue: single value
      if (param.value instanceof EnumValue || (param.value as { type?: string }).type === 'enum') {
        const v = (param.value as EnumValue).value
        if (v) {
          queryParts.push(`${encodeURIComponent(resolvedKey)}=${encodeURIComponent(v)}`)
          cumulativeParamsContext[resolvedKey] = v
        }
        continue
      }

      // ExpressionValue goes through Handlebars, others taken literally
      const raw = param.value.toString()
      const resolvedValue = param.value instanceof ExpressionValue
        ? transformValue(raw, cumulativeParamsContext)
        : raw
      queryParts.push(`${encodeURIComponent(resolvedKey)}=${encodeURIComponent(resolvedValue)}`)
      cumulativeParamsContext[resolvedKey] = resolvedValue
    }
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
