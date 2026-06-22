/**
 * HTTP Request Service
 *
 * URL-resolution surface for HTTP requests: turns a URL template plus
 * path / query params and the environment context into a fully resolved,
 * URL-encoded request URL. Consumed by `request:resolve-url` (main IPC)
 * and the renderer's `resolveRequestURL` wrapper for the URL tooltip.
 *
 * The actual request DISPATCH lives in `HTTPExecutionService.execute`
 * (Node `http`/`https`, the single funnel shared by the Send button, the
 * OData engine, and the scenario httpRequest node). The earlier
 * axios-based `executeHTTPRequest` here was a parallel, unused path and
 * has been removed.
 */

import type { KeyValue } from '../../../shared/types/collections'
import type { VariableContext } from './types'
import { resolveTemplate } from './resolveTemplate'
import { resolveKeyValues } from './keyValueResolution'

/** Input for URL resolution */
export interface URLResolutionInput {
  /** URL template with variables (e.g., "{{baseUrl}}/api/pet/{{petId}}") */
  urlTemplate: string
  /** Path parameters (key-value pairs, values may contain variables) */
  pathParams: KeyValue[]
  /** Query parameters (key-value pairs, values may contain variables) */
  queryParams: KeyValue[]
  /** Variable context from environments */
  environmentContext: VariableContext
}

/** Result of URL resolution */
export interface ResolvedURLResult {
  /** The final URL with all variables resolved and params encoded */
  url: string
  /** Base URL without query params (path params resolved) */
  baseUrl: string
  /** Query string (without leading ?) */
  queryString: string
}

/**
 * Build the query string from resolved and URL-encoded parameters
 */
function buildQueryString(params: KeyValue[]): string {
  const parts: string[] = []
  for (const param of params) {
    if (param.key) {
      parts.push(`${encodeURIComponent(param.key)}=${encodeURIComponent(param.value.toString())}`)
    }
  }
  return parts.join('&')
}

/**
 * Resolve the complete URL with all variables substituted and params URL-encoded.
 * This is the main function for URL resolution - use it for both tooltip display and HTTP calls.
 *
 * @param input - URL resolution parameters
 * @returns Resolved URL result with full URL, base URL, and query string
 */
export function resolveRequestURL(input: URLResolutionInput): ResolvedURLResult {
  // Step 1: Resolve path params values using environment context
  const pathParamsContext: VariableContext = {}
  for (const pp of input.pathParams) {
    const resolvedKey = resolveTemplate(pp.key, input.environmentContext)
    const resolvedValue = resolveTemplate(pp.value.toString(), input.environmentContext)
    if (resolvedKey) {
      // URL-encode path param values
      pathParamsContext[resolvedKey] = encodeURIComponent(resolvedValue)
    }
  }

  // Step 2: Build full context (environment + path params)
  const fullContext: VariableContext = {
    ...input.environmentContext,
    ...pathParamsContext
  }

  // Step 3: Resolve the URL template with full context
  const baseUrl = resolveTemplate(input.urlTemplate, fullContext)

  // Step 4: Resolve query params and build URL-encoded query string
  const resolvedQueryParams = resolveKeyValues(input.queryParams, input.environmentContext)
  const queryString = buildQueryString(resolvedQueryParams)

  // Step 5: Combine base URL and query string
  const url = queryString ? `${baseUrl}?${queryString}` : baseUrl

  return {
    url,
    baseUrl,
    queryString
  }
}
