/**
 * URL → OperationDocumentation matcher. Used by:
 *
 * - The Docs tab in `DocumentationHost.filters` to pick the matching
 *   operation for a request.
 * - The refresh modal's lockedKeys logic (main-side, in
 *   `runApiUpdatePreviewTree`).
 * - The sidebar's deprecation dim and the request tab's deprecation
 *   callout (renderer-side).
 *
 * Lives under `shared/utils` so renderer + main agree byte-for-byte
 * on what counts as a match. Pure: regex + iteration, no IO.
 *
 * Callers feed an env-resolved URL (see `resolveUrlAgainstEnv`) so
 * user-chosen variable names like `{{baseUrl}}` / `{{server}}` /
 * `{{api}}` expand to the real host before regex matching. Path-
 * params not in the env (`{{petId}}`) stay literal — the regex
 * builder treats them as `[^/]+` segments.
 */

import type {
  ApiDocumentation,
  OperationDocumentation
} from '../types/apiDocumentation'

/**
 * Minimal shape of a request used for matching. Keeping this loose
 * (as opposed to importing the Request class union) lets the matcher
 * run against plain serialised data too — useful for background
 * compilation after file load.
 */
export interface RouteLike {
  type: 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket'
  url?: string
  method?: string
  operationType?: string
  query?: string
  service?: string
  // For GrpcRequest the RPC method name lives on `method` normally,
  // but that collides with HTTP `method`. gRPC callers should pass
  // `rpcMethod` instead.
  rpcMethod?: string
  soapAction?: string
  operation?: string
  event?: string
  protocol?: string
  tags?: string[]
}

/**
 * Turn a URL pattern into a path-matching regex. Each `{var}` or
 * `{{var}}` placeholder becomes `[^/]+`, literal segments are
 * escaped.
 *
 * Two anchor modes:
 *
 * - `strict` — used when the request URL fails to parse as an HTTP-
 *   like URL and we fall back to literal-path handling. Anchored
 *   `^...$`. The fallback path may carry leftover prefixes like
 *   `/x{{baseUrl}}` if the user prepended a stray character;
 *   anchoring at the start guarantees a typo invalidates the match.
 * - `suffix` — used when `new URL()` succeeds. The parsed `pathname`
 *   may include a `basePath` prefix from the spec like
 *   `/v2/pet/...` that's NOT in the operation's `urlPattern`.
 *   Anchored at the end with a path-segment-boundary check at the
 *   start, `(?:^|/)...$`. That distinguishes `/pet/123` from
 *   `/pets/123` while letting the match start after any number of
 *   basePath segments.
 */
function opPatternToRegex(pattern: string, mode: 'strict' | 'suffix' = 'strict'): RegExp {
  // Use non-printable placeholder so we don't confuse escaping of regex specials.
  const WILDCARD = '\x01'
  let out = pattern.replace(/\{\{[^}]+\}\}/g, WILDCARD).replace(/\{[^}]+\}/g, WILDCARD)
  out = out.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  out = out.replace(new RegExp(WILDCARD, 'g'), '[^/]+')
  if (mode === 'suffix' && out.startsWith('/')) {
    return new RegExp(`(?:^|/)${out.substring(1)}$`)
  }
  return new RegExp(`^${out}$`)
}

/**
 * Schemes the matcher recognises as "real HTTP-like URLs" worth
 * parsing through `new URL()`. Anything else (e.g. `xhttp:` after
 * the user prepended a stray character to the URL field) is
 * rejected so the path-extraction doesn't mask a no-longer-matching
 * URL as still matching.
 */
const HTTP_LIKE_SCHEMES = new Set([
  'http:', 'https:', 'ws:', 'wss:', 'file:'
])

interface ExtractedPath {
  path: string
  mode: 'strict' | 'suffix'
}

function extractPath(url: string): ExtractedPath | null {
  const trimmed = url.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (HTTP_LIKE_SCHEMES.has(parsed.protocol)) {
      return { path: parsed.pathname, mode: 'suffix' }
    }
    return null
  } catch {
    // Fall through to the manual-strip path.
  }
  // Drop a single leading `{{name}}` placeholder — stands in for an
  // unresolved baseUrl-like variable. We only strip ONE so a typo
  // like `x{{baseUrl}}/path` (which doesn't begin with `{{`) doesn't
  // match.
  let out = trimmed.replace(/^\{\{\s*[^}\s]+\s*\}\}/, '')
  // Drop query + fragment.
  const q = out.indexOf('?')
  if (q >= 0) out = out.substring(0, q)
  const h = out.indexOf('#')
  if (h >= 0) out = out.substring(0, h)
  if (!out.startsWith('/')) out = `/${out}`
  return { path: out, mode: 'strict' }
}

/** Extract the first top-level field name from a GraphQL query. */
function extractGraphqlOperationName(query: string): string | undefined {
  const trimmed = query.trim()
  if (!trimmed) return undefined
  const openBraceIdx = trimmed.indexOf('{')
  if (openBraceIdx < 0) return undefined
  const body = trimmed.substring(openBraceIdx + 1)
  const firstFieldMatch = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(body)
  return firstFieldMatch?.[1]
}

/**
 * Score an op pattern by specificity — fewer placeholders means a
 * more literal match. Used to break ties when several operations
 * match the same path (e.g. `/pet/findByTags` AND `/pet/{petId}`
 * both regex-match the suffix `/pet/findByTags` because the
 * placeholder accepts any non-slash segment). Without this
 * tie-break the iteration order picks whichever appears first in
 * `apiDoc.operations`, which is rarely what the user means.
 */
function patternSpecificity(pattern: string): number {
  // Each placeholder costs one specificity point. Negative because
  // we want to maximise literal segments.
  return -((pattern.match(/\{[^}]+\}/g) ?? []).length)
}

function matchHttpOperation(apiDoc: ApiDocumentation, route: RouteLike): OperationDocumentation | undefined {
  if (!route.url) return undefined
  const method = (route.method ?? '').toUpperCase()
  const extracted = extractPath(route.url)
  if (extracted === null) return undefined
  let best: OperationDocumentation | undefined
  let bestScore = -Infinity
  for (const op of apiDoc.operations) {
    if (!op.match.urlPattern) continue
    if (op.match.method && method && op.match.method.toUpperCase() !== method) continue
    if (!opPatternToRegex(op.match.urlPattern, extracted.mode).test(extracted.path)) continue
    const score = patternSpecificity(op.match.urlPattern)
    if (score > bestScore) {
      best = op
      bestScore = score
    }
  }
  return best
}

function matchGraphqlOperation(apiDoc: ApiDocumentation, route: RouteLike): OperationDocumentation | undefined {
  const opType = route.operationType ?? 'query'
  const fieldName = route.query ? extractGraphqlOperationName(route.query) : undefined
  for (const op of apiDoc.operations) {
    if (op.match.operationType && op.match.operationType !== opType) continue
    if (fieldName && op.match.operationName === fieldName) return op
  }
  if (!fieldName) {
    return apiDoc.operations.find(op => op.match.operationType === opType)
  }
  return undefined
}

function matchGrpcOperation(apiDoc: ApiDocumentation, route: RouteLike): OperationDocumentation | undefined {
  const service = route.service
  const method = route.rpcMethod
  for (const op of apiDoc.operations) {
    if (service && op.match.serviceName && op.match.serviceName !== service) continue
    if (method && op.match.operationName === method) return op
  }
  return undefined
}

function matchSoapOperation(apiDoc: ApiDocumentation, route: RouteLike): OperationDocumentation | undefined {
  if (route.soapAction) {
    const byAction = apiDoc.operations.find(op => op.match.soapAction === route.soapAction)
    if (byAction) return byAction
  }
  if (route.operation) {
    return apiDoc.operations.find(op => op.match.operationName === route.operation)
  }
  return undefined
}

function matchWebsocketOperation(apiDoc: ApiDocumentation, route: RouteLike): OperationDocumentation | undefined {
  if (!route.event) return undefined
  const hasPublish = route.tags?.includes('publish')
  const hasSubscribe = route.tags?.includes('subscribe')
  const direction: 'publish' | 'subscribe' | undefined = hasPublish
    ? 'publish'
    : hasSubscribe
      ? 'subscribe'
      : undefined
  for (const op of apiDoc.operations) {
    if (op.match.event !== route.event) continue
    if (direction && op.match.direction && op.match.direction !== direction) continue
    return op
  }
  return undefined
}

/**
 * Locate the OperationDocumentation that describes `route` inside
 * `apiDoc`, or `undefined` if the route has no matching operation
 * (e.g., user-added request that isn't part of the imported spec).
 */
export function findOperationForRoute(
  apiDoc: ApiDocumentation,
  route: RouteLike
): OperationDocumentation | undefined {
  switch (route.type) {
    case 'http': return matchHttpOperation(apiDoc, route)
    case 'graphql': return matchGraphqlOperation(apiDoc, route)
    case 'grpc': return matchGrpcOperation(apiDoc, route)
    case 'soap': return matchSoapOperation(apiDoc, route)
    case 'websocket': return matchWebsocketOperation(apiDoc, route)
  }
}
