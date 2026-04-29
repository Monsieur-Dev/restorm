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
import { findOperationForRoute, type RouteLike } from '../../shared/utils/findOperationForRoute'

// Re-export the matcher API so existing main-side imports keep
// working. The implementation lives in `shared/utils` so the
// renderer can match URLs without an IPC round-trip (used by the
// sidebar's deprecation dim).
export { findOperationForRoute, type RouteLike }

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
