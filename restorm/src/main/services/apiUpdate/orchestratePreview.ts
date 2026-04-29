import type { EnvironmentFolder } from '../../../shared/types/folderTypes'
import type { ApiUpdateConfig, ImportSourceType } from '../../../shared/types/baseTypes'
import { collectionStore } from '../CollectionStore'
import { swaggerImportAdapter } from '../import/idempotent/SwaggerAdapter'
import { graphqlImportAdapter } from '../import/idempotent/GraphQLAdapter'
import { openapi3ImportAdapter } from '../import/idempotent/OpenAPI3Adapter'
import { postmanImportAdapter } from '../import/idempotent/PostmanAdapter'
import { insomniaImportAdapter } from '../import/idempotent/InsomniaAdapter'
import { brunoImportAdapter } from '../import/idempotent/BrunoAdapter'
import { asyncapiImportAdapter } from '../import/idempotent/AsyncAPIAdapter'
import { grpcImportAdapter } from '../import/idempotent/GrpcAdapter'
import { soapImportAdapter } from '../import/idempotent/SoapAdapter'
import { odataImportAdapter } from '../import/idempotent/ODataAdapter'
import { previewImportDiff } from '../import/idempotent/previewImportDiff'
import { expandHeaderTemplate, expandVariables } from './scheduling'
import { resolveAuthHeadersForFolder } from './resolveAuthHeaders'
import { importFrom } from '../import/ImportManager'
import { findOperationForRoute, type RouteLike } from '../DocumentationCompiler'
import type { ApiDocumentation, OperationDocumentation } from '../../../shared/types/apiDocumentation'
import type { Request } from '../../../shared/types/requests'
import type { FolderItem } from '../../../shared/types/folderTypes'
import { isAnyFolder, isRequest } from '../../../shared/types/folderTypes'
import { importNaturalKeyForRequest } from '../../../shared/utils/importNaturalKey'

/**
 * Fetch the spec, normalise it, and compute the diff against the
 * folder's current contents WITHOUT mutating anything. Used by the
 * "Refresh from source" confirmation dialog so the user sees
 * accurate counters before committing.
 */

const ADAPTER_BY_SOURCE: Partial<Record<ImportSourceType, typeof swaggerImportAdapter>> = {
  swagger: swaggerImportAdapter,
  openapi: openapi3ImportAdapter,
  graphql: graphqlImportAdapter,
  postman: postmanImportAdapter,
  insomnia: insomniaImportAdapter,
  bruno: brunoImportAdapter,
  asyncapi: asyncapiImportAdapter,
  grpc: grpcImportAdapter,
  wsdl: soapImportAdapter,
  odata: odataImportAdapter
}

function isImportSource(value: string | undefined): value is ImportSourceType {
  if (!value) return false
  return ['swagger', 'openapi', 'graphql', 'grpc', 'wsdl', 'asyncapi', 'odata', 'postman', 'insomnia', 'bruno', 'curl', 'powershell', 'url'].includes(value)
}

function extractStringValue(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v && typeof v === 'object') {
    const obj = v as { value?: unknown; toString?: () => string }
    if (typeof obj.value === 'string') return obj.value
    if (typeof obj.value === 'number' || typeof obj.value === 'boolean') return String(obj.value)
    if (typeof obj.toString === 'function' && obj.toString !== Object.prototype.toString) {
      const out = obj.toString()
      if (out !== '[object Object]') return out
    }
  }
  return undefined
}

function defaultVariablesFor(folder: EnvironmentFolder): Record<string, string> {
  const env = folder.environments[0]
  if (!env) return {}
  const vars: Record<string, string> = {}
  for (const kv of env.variables) {
    const v = extractStringValue(kv.value)
    if (v !== undefined) vars[kv.key] = v
  }
  return vars
}

export interface ApiUpdatePreviewSummary {
  added: number
  deprecated: number
  removed: number
  merged: number
  modelsChanged: number
  enumsChanged: number
  currentVersion?: string
  availableVersion?: string
}

export async function runApiUpdatePreview(folderId: string): Promise<ApiUpdatePreviewSummary> {
  const target = collectionStore.findById(folderId)
  if (!target || !('folderType' in target)) throw new Error(`Folder ${folderId} not found`)
  const env = target as EnvironmentFolder
  const config: ApiUpdateConfig | undefined = env.apiUpdate
  if (!config?.sourceUrl) throw new Error(`Folder ${folderId} has no apiUpdate.sourceUrl`)
  const importSource = isImportSource(env.importSource) ? env.importSource : null
  if (!importSource) throw new Error(`Folder ${folderId} has no importSource`)
  const adapter = ADAPTER_BY_SOURCE[importSource]
  if (!adapter) throw new Error(`No idempotent adapter for ${importSource}`)

  const variables = defaultVariablesFor(env)
  const url = expandVariables(config.sourceUrl, variables)
  const staticHeaders = expandHeaderTemplate(config.sourceHeaders, variables)
  const dynamicHeaders = await resolveAuthHeadersForFolder(env, config.authenticationRequestId, variables)
  const headers = { ...dynamicHeaders, ...staticHeaders }
  const response = await fetch(url, Object.keys(headers).length === 0 ? {} : { headers })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  const content = await response.text()
  const parsed = parseFetched(content)
  const spec = adapter.extractNormalizedSpec(parsed, {})
  const diff = previewImportDiff(env, spec, adapter)
  const summary: ApiUpdatePreviewSummary = {
    added: diff.added.length,
    deprecated: diff.deprecated.length,
    removed: diff.removed.length,
    merged: diff.merged.length,
    modelsChanged: diff.modelsAdded.length + diff.modelsDeprecated.length + diff.modelsRemoved.length,
    enumsChanged: diff.enumsAdded.length + diff.enumsDeprecated.length + diff.enumsRemoved.length
  }
  if (config.lastImportedSpecVersion !== undefined) summary.currentVersion = config.lastImportedSpecVersion
  if (spec.version !== undefined) summary.availableVersion = spec.version
  return summary
}

function parseFetched(content: string): unknown {
  // Same loose strategy as the Checker — JSON is the common case;
  // the GraphQL/SOAP/gRPC adapters consume strings directly so they
  // don't need parsing.
  try {
    return JSON.parse(content)
  } catch {
    return content
  }
}

/**
 * Adapter from a `Request` to the `RouteLike` shape the
 * `DocumentationCompiler` matcher consumes. Same fields the
 * renderer's `routeFromRequest` builds for the Docs-tab visibility
 * decision — kept in sync so refresh's lock-out behaviour and the
 * Docs tab agree on what counts as "this request matches an
 * operation in the spec".
 */
function routeFromRequest(request: Request): RouteLike | null {
  // Read fields through a loose record so TS doesn't narrow the
  // optional intersection to "always defined" (the discriminated
  // union's per-variant fields are required, but we want a single
  // body that touches every variant). At runtime each variant only
  // exposes the fields it cares about; missing ones are `undefined`.
  const r = request as unknown as Record<string, unknown>
  const tags = Array.isArray(r['tags']) ? (r['tags'] as string[]) : undefined
  const str = (key: string): string | undefined => {
    const v = r[key]
    return typeof v === 'string' ? v : undefined
  }
  switch (r['type']) {
    case 'http':
    case 'auth': {
      const route: RouteLike = { type: 'http' }
      if (tags !== undefined) route.tags = tags
      const url = str('url'); if (url !== undefined) route.url = url
      const method = str('method'); if (method !== undefined) route.method = method
      return route
    }
    case 'graphql': {
      const route: RouteLike = { type: 'graphql' }
      if (tags !== undefined) route.tags = tags
      const url = str('url'); if (url !== undefined) route.url = url
      const operationType = str('operationType'); if (operationType !== undefined) route.operationType = operationType
      const query = str('query'); if (query !== undefined) route.query = query
      return route
    }
    case 'grpc': {
      const route: RouteLike = { type: 'grpc' }
      if (tags !== undefined) route.tags = tags
      const service = str('service'); if (service !== undefined) route.service = service
      const method = str('method'); if (method !== undefined) route.rpcMethod = method
      return route
    }
    case 'soap': {
      const route: RouteLike = { type: 'soap' }
      if (tags !== undefined) route.tags = tags
      const url = str('url'); if (url !== undefined) route.url = url
      const soapAction = str('soapAction'); if (soapAction !== undefined) route.soapAction = soapAction
      const operation = str('operation'); if (operation !== undefined) route.operation = operation
      const service = str('service'); if (service !== undefined) route.service = service
      return route
    }
    case 'websocket': {
      const route: RouteLike = { type: 'websocket' }
      if (tags !== undefined) route.tags = tags
      const url = str('url'); if (url !== undefined) route.url = url
      const protocol = str('protocol'); if (protocol !== undefined) route.protocol = protocol
      const event = str('event'); if (event !== undefined) route.event = event
      return route
    }
    default:
      return null
  }
}

/**
 * Walk a tree's requests (depth-first), invoking `visit` on each
 * leaf. Folders without `items` are skipped; non-Request leaves are
 * skipped.
 */
function visitRequests(items: readonly FolderItem[], visit: (req: Request) => void): void {
  for (const item of items) {
    if (isAnyFolder(item)) {
      visitRequests(item.items, visit)
      continue
    }
    if (isRequest(item)) visit(item)
  }
}

/**
 * Stable key for an operation in the apiDocumentation, in the same
 * shape every importer's `importOrigin.naturalKey` carries on a
 * fresh leaf. Lets us match an existing target request (resolved
 * via the URL-based matcher) to a fresh leaf (resolved via its
 * stamped origin) without round-tripping through the matcher's
 * regex pass — which is order-dependent on placeholder operations
 * and would falsely lock a literal-only route like `/pet/inventory`
 * when an earlier `/pet/{petId}` operation also matches its path.
 */
function operationNaturalKey(op: OperationDocumentation): string {
  const m = op.match
  if (m.method && m.urlPattern) return `${m.method.toUpperCase()} ${m.urlPattern}`
  if (m.operationType && m.operationName) return `${m.operationType} ${m.operationName}`
  if (m.serviceName && m.operationName) return `${m.serviceName}/${m.operationName}`
  if (m.soapAction) return `soap:${m.soapAction}`
  if (m.direction && m.event) return `${m.direction} ${m.event}`
  if (m.urlPattern) return m.urlPattern
  return m.operationName ?? ''
}

/**
 * Build the set of leaf keys in the freshly-imported tree whose
 * underlying operation is already covered by an existing request in
 * the target env folder.
 *
 * The decision uses two complementary identifiers:
 *
 * - **Existing target requests**: resolved through
 *   `findOperationForRoute` — the same URL-based matcher that drives
 *   Docs-tab visibility. The user may have edited the request URL,
 *   so a regex match against the spec's operation patterns is the
 *   only way to recover the source operation.
 * - **Fresh leaves**: resolved through `importOrigin.naturalKey`
 *   stamped at fresh-import time. The URL-based matcher would be
 *   order-dependent here (a literal route like `/pet/inventory`
 *   would falsely match an earlier `/pet/{petId}` regex), so we
 *   anchor on the importer's recorded source op.
 *
 * Locking translates UI-side to "checkbox forced on + disabled" —
 * the user can't opt that route out because doing so would silently
 * drop a route the folder already exposes. New operations (no
 * existing match) arrive unchecked so they show up as opt-in
 * additions.
 */
function computeLockedKeys(
  target: EnvironmentFolder,
  freshApiDoc: ApiDocumentation,
  freshTree: readonly FolderItem[]
): string[] {
  const matchedOpKeys = new Set<string>()
  visitRequests(target.items, (req) => {
    const route = routeFromRequest(req)
    if (!route) return
    const op = findOperationForRoute(freshApiDoc, route)
    if (op) matchedOpKeys.add(operationNaturalKey(op))
  })
  if (matchedOpKeys.size === 0) return []
  const lockedKeys: string[] = []
  visitRequests(freshTree, (req) => {
    const originKey = req.importOrigin?.naturalKey
    if (!originKey) return
    if (matchedOpKeys.has(originKey)) {
      lockedKeys.push(importNaturalKeyForRequest(req))
    }
  })
  return lockedKeys
}

/**
 * Same as the renderer-side `import.preview` IPC, except auth is
 * resolved against the env folder's stored `apiUpdate` config (so
 * `{{client_id}}`-style variables in the saved auth route get
 * expanded against the folder's first environment), and the source
 * URL is taken from the folder rather than user input. The refresh
 * variant of the import modal calls this so it doesn't have to
 * re-implement the auth-resolution dance the renderer can't see.
 *
 * The returned `lockedKeys` flag, in ImportSelectionTree key shape,
 * marks each fresh-tree leaf whose operation is already present in
 * the target folder (per the `findOperationForRoute` matcher). The
 * modal pre-ticks those keys + disables their checkboxes.
 */
export async function runApiUpdatePreviewTree(
  folderId: string
): Promise<{ success: boolean; items: unknown[]; lockedKeys?: string[]; error?: string }> {
  const target = collectionStore.findById(folderId)
  if (!target || !('folderType' in target)) {
    return { success: false, items: [], error: `Folder ${folderId} not found` }
  }
  const env = target as EnvironmentFolder
  const config: ApiUpdateConfig | undefined = env.apiUpdate
  if (!config?.sourceUrl) {
    return { success: false, items: [], error: `Folder ${folderId} has no apiUpdate.sourceUrl` }
  }

  const variables = defaultVariablesFor(env)
  const url = expandVariables(config.sourceUrl, variables)
  const staticHeaders = expandHeaderTemplate(config.sourceHeaders, variables)
  const dynamicHeaders = await resolveAuthHeadersForFolder(env, config.authenticationRequestId, variables)
  const headers = { ...dynamicHeaders, ...staticHeaders }
  try {
    const result = await importFrom(url, Object.keys(headers).length === 0 ? {} : { extraHeaders: headers })
    if (!result.success) {
      return { success: false, items: [], error: result.error ?? 'preview failed' }
    }
    const items = result.items as FolderItem[]
    const freshFolder = items[0] as { apiDocumentation?: ApiDocumentation } | undefined
    const freshApiDoc = freshFolder?.apiDocumentation
    const lockedKeys = freshApiDoc ? computeLockedKeys(env, freshApiDoc, items) : []
    return { success: true, items: items as unknown[], lockedKeys }
  } catch (err) {
    return { success: false, items: [], error: err instanceof Error ? err.message : String(err) }
  }
}
