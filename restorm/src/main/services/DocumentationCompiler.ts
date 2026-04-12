/**
 * DocumentationCompiler — compiles Markdown documentation on the fly from a
 * structured ApiDocumentation object.
 *
 * The compiler is pure: given an ApiDocumentation (stored on the root
 * EnvironmentFolder at import time) and a Request, it resolves the matching
 * OperationDocumentation and renders Markdown via the generic Handlebars
 * templates under `resources/templates/api-docs/`.
 *
 * Nothing is persisted on the Request itself — documentation is always derived
 * from the root `apiDocumentation` each time it's needed.
 */

import Handlebars from 'handlebars'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { logger } from 'electron-core-ui/main'
import type {
  ApiDocumentation,
  GroupDocumentation,
  ModelDocumentation,
  OperationDocumentation,
  ResponseDocumentation
} from '../../shared/types/apiDocumentation'

// ============================================================================
// Route matching
// ============================================================================

/**
 * Minimal shape of a request used for matching. Keeping this loose (as opposed
 * to importing the Request class union) lets the compiler run against plain
 * serialised data too — useful for background compilation after file load.
 */
export interface RouteLike {
  type: 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket'
  url?: string
  method?: string
  operationType?: string
  query?: string
  service?: string
  // For GrpcRequest the RPC method name lives on `method` normally, but that
  // collides with HTTP `method`. gRPC callers should pass `rpcMethod` instead.
  rpcMethod?: string
  soapAction?: string
  operation?: string
  event?: string
  protocol?: string
  tags?: string[]
}

/**
 * Turn a URL pattern into a path-matching regex: each `{var}` or `{{var}}`
 * placeholder becomes `[^/]+`, literal segments are escaped. The result
 * matches a concrete path segment-by-segment (no wildcards across `/`).
 */
function opPatternToRegex(pattern: string): RegExp {
  // Use non-printable placeholder so we don't confuse escaping of regex specials.
  const WILDCARD = '\x01'
  let out = pattern.replace(/\{\{[^}]+\}\}/g, WILDCARD).replace(/\{[^}]+\}/g, WILDCARD)
  out = out.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  out = out.replace(new RegExp(WILDCARD, 'g'), '[^/]+')
  return new RegExp(`^${out}$`)
}

/** Extract the path portion from an HTTP URL, stripping `{{baseUrl}}` / scheme / host and query. */
function extractPath(url: string): string {
  let out = url.trim()
  // Drop `{{baseUrl}}` prefix entirely — it stands in for the server root.
  out = out.replace(/^\{\{\s*baseUrl\s*\}\}/, '')
  // Drop absolute URL scheme + host.
  out = out.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '')
  // Drop query string.
  const q = out.indexOf('?')
  if (q >= 0) out = out.substring(0, q)
  // Drop fragment.
  const h = out.indexOf('#')
  if (h >= 0) out = out.substring(0, h)
  if (!out.startsWith('/')) out = `/${out}`
  return out
}

/** Extract the first top-level field name from a GraphQL query. */
function extractGraphqlOperationName(query: string): string | undefined {
  // `query Foo($x: Int) { bar(...) { ... } }` → `bar`
  //   Strategy: skip the `query|mutation|subscription [Name] [(vars)]` preamble, find the first `{`,
  //   then read the first identifier inside.
  const trimmed = query.trim()
  if (!trimmed) return undefined
  const openBraceIdx = trimmed.indexOf('{')
  if (openBraceIdx < 0) return undefined
  const body = trimmed.substring(openBraceIdx + 1)
  const firstFieldMatch = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(body)
  return firstFieldMatch?.[1]
}

function matchHttpOperation(apiDoc: ApiDocumentation, route: RouteLike): OperationDocumentation | undefined {
  if (!route.url) return undefined
  const method = (route.method ?? '').toUpperCase()
  const requestPath = extractPath(route.url)
  const basePath = apiDoc.server?.basePath ?? ''

  for (const op of apiDoc.operations) {
    if (!op.match.urlPattern) continue
    if (op.match.method && method && op.match.method.toUpperCase() !== method) continue

    const fullRegex = opPatternToRegex(`${basePath}${op.match.urlPattern}`)
    const bareRegex = opPatternToRegex(op.match.urlPattern)
    if (fullRegex.test(requestPath) || bareRegex.test(requestPath)) return op
    // Fallback: allow the request path to carry an extra prefix before the urlPattern.
    const suffixRegex = new RegExp(bareRegex.source.slice(1)) // drop leading `^`
    if (suffixRegex.test(requestPath)) return op
  }
  return undefined
}

function matchGraphqlOperation(apiDoc: ApiDocumentation, route: RouteLike): OperationDocumentation | undefined {
  const opType = route.operationType ?? 'query'
  const fieldName = route.query ? extractGraphqlOperationName(route.query) : undefined
  for (const op of apiDoc.operations) {
    if (op.match.operationType && op.match.operationType !== opType) continue
    if (fieldName && op.match.operationName === fieldName) return op
  }
  // No field match — fall back to first operation of the right type, if any.
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
 * Locate the OperationDocumentation that describes `route` inside `apiDoc`, or
 * `undefined` if the route has no matching operation (e.g., user-added request
 * that isn't part of the imported spec).
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

// ============================================================================
// Template loading & compilation
// ============================================================================

let templatesPathOverride: string | undefined

/** Test-only: point the compiler at a custom templates directory. */
export function setApiDocsTemplatesPath(templatesPath: string | undefined): void {
  templatesPathOverride = templatesPath
  cachedTemplates = null
}

function getApiDocsTemplatesPath(): string {
  if (templatesPathOverride !== undefined) return templatesPathOverride
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar', 'dist', 'main', 'resources', 'templates', 'api-docs')
  }
  return path.join(__dirname, 'resources', 'templates', 'api-docs')
}

interface CompiledApiDocsTemplates {
  operation: Handlebars.TemplateDelegate
  group: Handlebars.TemplateDelegate
  root: Handlebars.TemplateDelegate
}

let cachedTemplates: CompiledApiDocsTemplates | null = null

function loadTemplates(): CompiledApiDocsTemplates | null {
  if (cachedTemplates) return cachedTemplates
  const basePath = getApiDocsTemplatesPath()
  try {
    const operationSrc = fs.readFileSync(path.join(basePath, 'operation.hbs'), 'utf-8')
    const groupSrc = fs.readFileSync(path.join(basePath, 'group.hbs'), 'utf-8')
    const rootSrc = fs.readFileSync(path.join(basePath, 'root.hbs'), 'utf-8')
    cachedTemplates = {
      operation: Handlebars.compile(operationSrc, { noEscape: true }),
      group: Handlebars.compile(groupSrc, { noEscape: true }),
      root: Handlebars.compile(rootSrc, { noEscape: true })
    }
    return cachedTemplates
  } catch (error) {
    logger.error('[DocumentationCompiler] Failed to load templates', { basePath, error: String(error) })
    return null
  }
}

/** Reset the template cache — useful for tests and hot-reload scenarios. */
export function resetDocumentationCompilerCache(): void {
  cachedTemplates = null
}

// ============================================================================
// Context builders
// ============================================================================

function resolveReferencedModels(
  apiDoc: ApiDocumentation,
  refs: string[] | undefined
): ModelDocumentation[] {
  if (!refs) return []
  const seen = new Set<string>()
  const out: ModelDocumentation[] = []
  for (const name of refs) {
    if (seen.has(name)) continue
    seen.add(name)
    const model = apiDoc.models[name]
    if (model) out.push(model)
  }
  return out
}

interface ExtraEntry {
  label: string
  value: string
  isCode: boolean
}

function stringifyExtraValue(value: unknown): { text: string; isCode: boolean } {
  if (value === null || value === undefined) return { text: '—', isCode: false }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const looksLikeCode = trimmed.includes('\n') || trimmed.length > 40
    return { text: looksLikeCode ? value : trimmed, isCode: !looksLikeCode }
  }
  if (typeof value === 'number' || typeof value === 'boolean') return { text: String(value), isCode: true }
  try {
    return { text: JSON.stringify(value), isCode: true }
  } catch {
    return { text: '[unserialisable value]', isCode: false }
  }
}

function buildExtraEntries(extra: Record<string, unknown> | undefined): ExtraEntry[] {
  if (!extra) return []
  const entries: ExtraEntry[] = []
  for (const [key, value] of Object.entries(extra)) {
    const { text, isCode } = stringifyExtraValue(value)
    entries.push({ label: key, value: text, isCode })
  }
  return entries
}

// ============================================================================
// Compilation entry points
// ============================================================================

export function compileOperationMarkdown(
  apiDoc: ApiDocumentation,
  operation: OperationDocumentation
): string {
  const tpl = loadTemplates()
  if (!tpl) return ''

  const referencedModels = resolveReferencedModels(apiDoc, operation.referencedModels)
  const extraEntries = buildExtraEntries(operation.extra)

  return tpl.operation({
    api: apiDoc.api,
    server: apiDoc.server,
    operation,
    group: operation.group ? apiDoc.groups[operation.group] : undefined,
    hasParameters: (operation.parameters?.length ?? 0) > 0,
    hasResponses: operation.responses !== undefined && Object.keys(operation.responses).length > 0,
    hasExtra: extraEntries.length > 0,
    referencedModels,
    extraEntries
  })
}

export function compileGroupMarkdown(
  apiDoc: ApiDocumentation,
  groupName: string
): string {
  const tpl = loadTemplates()
  if (!tpl) return ''
  const group: GroupDocumentation | undefined = apiDoc.groups[groupName]
  if (!group) return ''
  const operations = apiDoc.operations.filter(op => op.group === groupName)
  return tpl.group({ group, operations })
}

export function compileRootMarkdown(apiDoc: ApiDocumentation): string {
  const tpl = loadTemplates()
  if (!tpl) return ''

  const groupSummaries = Object.values(apiDoc.groups).map(group => ({
    ...group,
    operations: apiDoc.operations.filter(op => op.group === group.name)
  }))

  const ungroupedOperations = apiDoc.operations.filter(op => !op.group || apiDoc.groups[op.group] === undefined)

  return tpl.root({
    api: apiDoc.api,
    server: apiDoc.server,
    hasServer: apiDoc.server !== undefined && (
      Boolean(apiDoc.server.host)
      || Boolean(apiDoc.server.basePath)
      || Boolean(apiDoc.server.namespace)
      || (apiDoc.server.schemes?.length ?? 0) > 0
    ),
    groupSummaries,
    ungroupedOperations
  })
}

/**
 * Compile Markdown for a request's route. Returns `undefined` when no matching
 * operation is found — callers can then fall back to the stored
 * `request.documentation` (user-authored content) or an empty state.
 */
export function compileDocumentationForRoute(
  apiDoc: ApiDocumentation,
  route: RouteLike
): { markdown: string; operation: OperationDocumentation } | undefined {
  const operation = findOperationForRoute(apiDoc, route)
  if (!operation) return undefined
  return { markdown: compileOperationMarkdown(apiDoc, operation), operation }
}

// ---------- Response summary helper (used by templates rendering sub-views) ----------

export function describeResponse(resp: ResponseDocumentation): string {
  const parts: string[] = []
  if (resp.description) parts.push(resp.description)
  if (resp.schema) parts.push(`→ ${resp.schema}`)
  return parts.join(' ')
}
