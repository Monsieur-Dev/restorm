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
 * Turn a URL pattern into a path-matching regex. Each `{var}` or
 * `{{var}}` placeholder becomes `[^/]+`, literal segments are
 * escaped.
 *
 * Two anchor modes:
 *
 * - `strict` (the default — used when the request URL fails to parse
 *   as an HTTP-like URL and we fall back to literal-path handling):
 *   anchored `^...$`. The fallback path may carry leftover prefixes
 *   like `/x{{baseUrl}}` if the user prepended a stray character;
 *   anchoring at the start guarantees a typo invalidates the match.
 * - `suffix` (used when `new URL()` succeeds — the parsed `pathname`
 *   may include a `basePath` prefix from the spec like `/v2/pet/...`
 *   that's NOT in the operation's `urlPattern`): anchored at the end
 *   with a path-segment-boundary check at the start, `(?:^|/)...$`.
 *   That distinguishes `/pet/123` from `/pets/123` while letting the
 *   match start after any number of basePath segments.
 */
function opPatternToRegex(pattern: string, mode: 'strict' | 'suffix' = 'strict'): RegExp {
  // Use non-printable placeholder so we don't confuse escaping of regex specials.
  const WILDCARD = '\x01'
  let out = pattern.replace(/\{\{[^}]+\}\}/g, WILDCARD).replace(/\{[^}]+\}/g, WILDCARD)
  out = out.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  out = out.replace(new RegExp(WILDCARD, 'g'), '[^/]+')
  // The op pattern always starts with `/`; for suffix-mode, drop
  // that leading `/` and replace it with `(?:^|/)` so a basePath
  // like `/v2` can prepend without breaking the segment boundary.
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

/**
 * Extract the path portion from a request URL, ready to be tested
 * against an operation's `urlPattern` regex. Two strategies in order:
 *
 * 1. Try `new URL(url)`. When the URL parses AND its scheme is in
 *    the HTTP-like allowlist, return the parsed `pathname` (already
 *    stripped of query + fragment). The allowlist is what catches
 *    "user typed `x` at the start" — `xhttp://...` parses as a URL
 *    but its scheme is rejected, so the matcher falls through to a
 *    no-match instead of returning a phantom path.
 * 2. URL parsing fails (relative URL, unresolved `{{baseUrl}}`
 *    template, …). Strip a leading `{{name}}` handlebar (any name —
 *    the user may have called the variable `{{server}}`, `{{api}}`,
 *    etc., and we don't want to hardcode `baseUrl`), then strip
 *    query + fragment, then prepend `/` if missing. Returns null
 *    when the strip leaves nothing usable so callers can short-
 *    circuit the regex test.
 *
 * Callers are expected to pass an env-resolved URL — see
 * `resolveUrlAgainstEnv`. Path-param handlebars like `{{petId}}` are
 * left intact and matched as `[^/]+` segments by the regex builder.
 */
interface ExtractedPath {
  path: string
  /**
   * `strict` when the URL didn't parse as an HTTP-like URL and we
   * fell back to literal-path handling — caller anchors the regex
   * with `^...$`. `suffix` when `URL` parsed successfully — caller
   * uses `(?:^|/)...$` so an inherited `basePath` prefix doesn't
   * break the match.
   */
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
  const extracted = extractPath(route.url)
  if (extracted === null) return undefined

  // Callers feed an env-resolved URL (see `resolveUrlAgainstEnv`)
  // so user-chosen variable names like `{{baseUrl}}` / `{{server}}`
  // expand before we get here. The regex anchor mode depends on
  // whether the URL parsed cleanly: `suffix` when we have a real
  // `URL.pathname` (basePath may prefix), `strict` when we fell back
  // to template-text handling (no extraneous prefixes allowed —
  // protects against `x{{baseUrl}}/...`-style typos).
  for (const op of apiDoc.operations) {
    if (!op.match.urlPattern) continue
    if (op.match.method && method && op.match.method.toUpperCase() !== method) continue
    if (opPatternToRegex(op.match.urlPattern, extracted.mode).test(extracted.path)) return op
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
  return tpl.group({ group, operations, basePath: apiDoc.server?.basePath ?? '' })
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
