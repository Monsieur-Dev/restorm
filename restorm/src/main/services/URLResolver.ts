/**
 * URLResolver - Resolves request URLs with path params, query params and Handlebars context
 *
 * Extracted from ContextService to isolate URL resolution logic.
 */

import type { FullRequestData, ResolvedUrlResult, TransformedContext, TransformValueFn } from './ContextServiceTypes'
import { isExpressionValue, isEnumListValue, isEnumValue } from '../../shared/utils/valueHelpers'
import { serializeODataQueryOptions } from '../../shared/utils/odataQuery'

/**
 * Overlay a scenario run's values onto a URL-template context, in place.
 *
 * Written VERBATIM, not `encodeURIComponent`-ed. Note this is NOT uniform with
 * everything it can overwrite: env values are verbatim, but a path-param row is
 * encoded just above, so a run value replacing one swaps an encoded value for an
 * unencoded one. That is deliberate — a run value is a VARIABLE, like an env
 * variable, not a path-param row, and encoding it would make the same value
 * behave differently depending on whether the request happens to carry a row of
 * that name, which is the hidden asymmetry this layering exists to remove.
 *
 * Known property, not a defect: a run value containing `/`, `?`, `#` or `%`
 * therefore changes the URL's STRUCTURE where the same characters in a
 * path-param row would have been escaped. Harmless for a value the user typed
 * into the run prompt; worth knowing for a headless `--param`, whose value can
 * come from a build parameter someone else controls. Env variables have always
 * carried the same property.
 */
function applyRunContext(target: TransformedContext, runContext: TransformedContext | undefined): void {
  if (runContext === undefined) return
  for (const [key, value] of Object.entries(runContext)) target[key] = value
}

/**
 * Record a row's resolved value in a cumulative context, then re-assert the
 * run's values over it.
 *
 * Each loop below feeds every row it has resolved back into the context the
 * NEXT row resolves against — that is how a row can reference an earlier one by
 * name. Without re-asserting, a row whose key collides with a run variable
 * would shadow it for every subsequent row, so `{{petId}}` in a later row would
 * pick up the sibling row's literal instead of the value the run supplied.
 *
 * That made resolution order-dependent, which is the worst residual to leave:
 * it works until someone reorders two rows, and then breaks with nothing
 * pointing at why.
 *
 * THE RULE, for whoever adds a fourth kind of row: **path-param rows POPULATE
 * the resolution context; query and header rows CONSUME it.** The scenario
 * run's layer overrides context CONTRIBUTORS, never context CONSUMERS.
 *
 * Why: a path-param row is a BINDING — it defines `{{petId}}` for the URL
 * template — so a run variable of the same name competes for the same token and
 * must win. A query or header row named `petId` holding a literal is an OUTPUT
 * the request declares; nothing reads it, so there is nothing to arbitrate and
 * it is left alone. Replacing one would be the per-slot request-override
 * feature, which is a separate capability.
 */
function noteRowValue(
  target: TransformedContext,
  key: string,
  value: string,
  runContext: TransformedContext | undefined
): void {
  target[key] = value
  applyRunContext(target, runContext)
}

/**
 * Calculate the resolved URL for a request.
 *
 * Values are layered, each layer replacing same-named keys from the one before:
 *
 *   1. environment-folder variables (`envContext`, already flattened through the
 *      parent → sub-environment chain, including the deliberate "same key
 *      defined twice" cumulation used to build a value by concatenation);
 *   2. the request's own values (its path params, then its query params);
 *   3. the scenario run's values (`runContext`) — an input node's answered
 *      param, or a `setVariable`.
 *
 * Layer 3 exists only while a scenario run is in flight; outside one it is
 * absent and the layering collapses to the historical `request > environment`.
 *
 * @param data - Full request data containing url, pathParams, params
 * @param envContext - Transformed environment context for Handlebars resolution
 * @param transformValue - Function to resolve Handlebars templates
 * @param runContext - Scenario run variables, applied last (layer 3)
 * @param queryContext - Seed for the query-string cumulation when the caller
 *   keeps a context per row family. Path rows and query rows are blind to each
 *   other, so they must not share a seed OBJECT even while the two hold equal
 *   values — sharing one is how a later per-family rule silently becomes a
 *   cross-family one. Defaults to `envContext`, the historical single-context
 *   behaviour.
 * @returns The resolved URL result with baseUrl, queryString and final resolvedUrl
 */
export function resolveUrl(
  data: FullRequestData,
  envContext: TransformedContext,
  transformValue: TransformValueFn,
  runContext?: TransformedContext,
  queryContext?: TransformedContext
): ResolvedUrlResult {
  // Build cumulative context with path params (non-encoded for resolution).
  // Path params override env vars for the same key — request-level
  // overrides always win over the inherited environment chain.
  // Seeded with the run's values rather than relying on the caller having
  // merged them into `envContext`: layer 3 has to hold from this function's own
  // arguments, or it is correct only by a coincidence one call site away.
  const cumulativeContext = { ...envContext }
  applyRunContext(cumulativeContext, runContext)
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
      // Store non-encoded value for next iterations (last value wins for same
      // key), with the run's values re-asserted so a row can't shadow one.
      noteRowValue(cumulativeContext, resolvedKey, resolvedValue, runContext)
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
  // Layer 3 last: a scenario run's value replaces the request's own row for the
  // same key. Without this the request's path param would silently discard the
  // value a run supplied — an input node's answered param, or a `setVariable` —
  // and the prompt the user answered would have no effect on the URL.
  applyRunContext(fullContext, runContext)

  // Transform the URL template
  let baseUrl = transformValue(data.url, fullContext)

  // tRPC: the persisted `url` is the BASE server url; the procedure path is
  // appended here (byte-identical for the request-panel Send and the scenario
  // engine, mirroring the `odataQueryOptions` append below for query strings).
  if (data.requestType === 'trpc' && data.trpcProcedure) {
    const procedure = transformValue(data.trpcProcedure, fullContext)
    if (procedure) baseUrl = `${baseUrl.replace(/\/+$/, '')}/${procedure}`
  }

  // Build query string from params with cumulative resolution
  const params = data.params ?? []
  const cumulativeParamsContext = { ...(queryContext ?? envContext) }
  applyRunContext(cumulativeParamsContext, runContext)
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
        noteRowValue(cumulativeParamsContext, resolvedKey, values.join(','), runContext)
        continue
      }

      // EnumValue: single value
      if (isEnumValue(param.value)) {
        const v = param.value.value
        if (v) {
          queryParts.push(`${encodeURIComponent(resolvedKey)}=${encodeURIComponent(v)}`)
          noteRowValue(cumulativeParamsContext, resolvedKey, v, runContext)
        }
        continue
      }

      // ExpressionValue goes through Handlebars, others taken literally
      const raw = param.value.toString()
      const resolvedValue = isExpressionValue(param.value)
        ? transformValue(raw, cumulativeParamsContext)
        : raw
      queryParts.push(`${encodeURIComponent(resolvedKey)}=${encodeURIComponent(resolvedValue)}`)
      noteRowValue(cumulativeParamsContext, resolvedKey, resolvedValue, runContext)
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

  // tRPC v10 non-batch GET: the resolved `input` JSON is a single query
  // param. A query with no input (or a mutation, whose input rides the POST
  // body instead — composed by `composeTrpcRequestBody`) contributes nothing.
  if (data.requestType === 'trpc' && data.trpcKind !== 'mutation') {
    const rawInput = (data.trpcInput ?? '').trim()
    if (rawInput.length > 0) {
      const resolvedInput = transformValue(rawInput, cumulativeParamsContext)
      queryParts.push(`input=${encodeURIComponent(resolvedInput)}`)
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
