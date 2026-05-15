/**
 * URLResolver - Resolves request URLs with path params, query params and Handlebars context
 *
 * Extracted from ContextService to isolate URL resolution logic.
 */

import type { FullRequestData, ResolvedUrlResult, TransformedContext, TransformValueFn } from './ContextServiceTypes'
import { isExpressionValue, isEnumListValue, isEnumValue } from '../../shared/utils/valueHelpers'
import { serializeODataQueryOptions } from '../../shared/utils/odataQuery'

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
  // Build cumulative context with path params (non-encoded for resolution).
  // Path params override env vars for the same key — request-level
  // overrides always win over the inherited environment chain.
  const cumulativeContext = { ...envContext }
  const pathParams = data.pathParams ?? []
  // Track which keys were set (or overridden) by a path param, so we
  // can URL-encode just those when building the URL-template context.
  // Env values stay verbatim — the user typed them deliberately and
  // may use characters (`,`, `:`) that `encodeURIComponent` mangles.
  const pathParamKeys = new Set<string>()

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
      const resolvedValue = isExpressionValue(pp.value)
        ? transformValue(raw, cumulativeContext)
        : raw
      // Store non-encoded value for next iterations (last value wins for same key)
      cumulativeContext[resolvedKey] = resolvedValue
      pathParamKeys.add(resolvedKey)
    }
  }

  // Build URL context with URL-encoded values. The previous version
  // gated the override behind `!(key in envContext)`, which dropped
  // path-param overrides for keys also defined in the env — env's
  // value silently won. The contract is the opposite: request path
  // params always override env (a path-param `name=Glaude` must win
  // over an env `name=Forgeaude`), so the override is unconditional.
  const fullContext = { ...envContext }
  for (const key of pathParamKeys) {
    const value = cumulativeContext[key] ?? ''
    fullContext[key] = encodeURIComponent(value)
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
      if (isEnumListValue(param.value)) {
        const values = param.value.value
        for (const v of values) {
          queryParts.push(`${encodeURIComponent(resolvedKey)}=${encodeURIComponent(v)}`)
        }
        cumulativeParamsContext[resolvedKey] = values.join(',')
        continue
      }

      // EnumValue: single value
      if (isEnumValue(param.value)) {
        const v = param.value.value
        if (v) {
          queryParts.push(`${encodeURIComponent(resolvedKey)}=${encodeURIComponent(v)}`)
          cumulativeParamsContext[resolvedKey] = v
        }
        continue
      }

      // ExpressionValue goes through Handlebars, others taken literally
      const raw = param.value.toString()
      const resolvedValue = isExpressionValue(param.value)
        ? transformValue(raw, cumulativeParamsContext)
        : raw
      queryParts.push(`${encodeURIComponent(resolvedKey)}=${encodeURIComponent(resolvedValue)}`)
      cumulativeParamsContext[resolvedKey] = resolvedValue
    }
  }

  // OData system query options — resolve each value through
  // Handlebars before handing it to the serializer, then append the
  // resulting pairs after the user's regular query params. Keys
  // start with `$` and we intentionally keep them literal (OData
  // servers accept both `$filter=...` and `%24filter=...` but the
  // literal form is canonical and human-readable).
  if (data.requestType === 'odata' && data.odataQueryOptions) {
    const qo = data.odataQueryOptions
    const resolvedOptions = {
      ...(qo.filter !== undefined && { filter: transformValue(qo.filter, cumulativeParamsContext) }),
      ...(qo.select !== undefined && { select: qo.select.map((s) => transformValue(s, cumulativeParamsContext)) }),
      ...(qo.top !== undefined && { top: transformValue(qo.top, cumulativeParamsContext) }),
      ...(qo.skip !== undefined && { skip: transformValue(qo.skip, cumulativeParamsContext) }),
      ...(qo.count !== undefined && { count: qo.count }),
      ...(qo.expand !== undefined && { expand: transformValue(qo.expand, cumulativeParamsContext) }),
      ...(qo.orderby !== undefined && { orderby: transformValue(qo.orderby, cumulativeParamsContext) }),
      ...(qo.search !== undefined && { search: transformValue(qo.search, cumulativeParamsContext) }),
      ...(qo.format !== undefined && { format: transformValue(qo.format, cumulativeParamsContext) }),
      ...(qo.apply !== undefined && { apply: transformValue(qo.apply, cumulativeParamsContext) })
    }
    const systemPairs = serializeODataQueryOptions(resolvedOptions, data.odataVersion ?? 'v4')
    for (const [key, value] of systemPairs) {
      queryParts.push(`${key}=${encodeURIComponent(value)}`)
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
