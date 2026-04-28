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
import { resolveRefreshDiff, type RefreshStatus } from './refreshDiff'
import { expandHeaderTemplate, expandVariables } from './scheduling'
import { resolveAuthHeadersForFolder } from './resolveAuthHeaders'
import { specKeyToImportSelectionKey } from './specKeyTranslator'
import { importFrom } from '../import/ImportManager'
import { compareApiDocumentations, type DocOperationStatus } from './compareApiDocumentations'
import type { ApiDocumentation } from '../../../shared/types/apiDocumentation'

/**
 * Side-effect-free entry point the refresh wizard calls to populate
 * its per-row classification. Composed of:
 *
 * - The same fetch + adapter dance the preview path uses.
 * - The classifier from `refreshDiff.ts`.
 *
 * Returns a JSON-friendly snapshot the renderer can display row by
 * row. Folder mutations only happen on Apply (via the existing
 * `apply` IPC); this entry point never touches the tree.
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

export interface RefreshDiffSummary {
  byNaturalKey: Record<string, RefreshStatus>
  counts: Record<RefreshStatus, number>
  newVersion?: string
  /**
   * Parsed-spec preview tree, the same shape `window.restorm.import.preview`
   * returns. Lets the wizard render the diff using the OYO-257
   * `ImportSelectionTree` component (folders + method badges +
   * tri-state checkboxes) instead of a flat list. Carried alongside
   * the per-key status map so a single IPC round-trip is enough
   * to populate the modal.
   */
  previewTree?: unknown
  /**
   * Map from each leaf's OYO-257 natural key (the keys
   * `ImportSelectionTree` produces) to its OYO-258 status. Lets the
   * wizard show status pills on the tree rows without re-translating
   * client-side.
   */
  byImportSelectionKey?: Record<string, RefreshStatus>
  /**
   * Format-agnostic doc-vs-doc diff: compares the env folder's
   * existing `apiDocumentation` against the freshly fetched one and
   * classifies every operation as `added | modified | removed |
   * unchanged`. Same shape across all import formats — no
   * naturalKey-scheme bridging needed because the diff lives at the
   * `OperationDocumentation` level. Drives the user-facing summary
   * counts on the wizard so they reflect actual spec changes
   * regardless of what was previously imported.
   */
  byOperationKey?: Record<string, DocOperationStatus>
  byOperationKeyCounts?: Record<DocOperationStatus, number>
  modelsTouched?: number
}

export async function runApiUpdateRefreshDiff(folderId: string): Promise<RefreshDiffSummary> {
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

  const diff = resolveRefreshDiff({
    oldSnapshot: env.importSelection,
    newSpec: spec,
    snapshotKeyFor: (specKey) => specKeyToImportSelectionKey(specKey, importSource, spec)
  })

  const byNaturalKey: Record<string, RefreshStatus> = {}
  for (const [key, status] of diff.byNaturalKey) byNaturalKey[key] = status

  // Run a parallel preview import to get the parsed-spec FolderItem
  // tree the OYO-257 ImportSelectionTree component renders. Reuses
  // the same `importFrom` path the import modal uses, including its
  // auth-header machinery — the tree it produces carries leaf
  // requests with the OYO-257 natural keys we map statuses against.
  let previewTree: unknown
  let byImportSelectionKey: Record<string, RefreshStatus> | undefined
  let byOperationKey: Record<string, DocOperationStatus> | undefined
  let byOperationKeyCounts: Record<DocOperationStatus, number> | undefined
  let modelsTouched: number | undefined
  try {
    const previewResult = await importFrom(url, Object.keys(headers).length === 0 ? {} : { extraHeaders: headers })
    if (previewResult.success && previewResult.items.length > 0) {
      previewTree = previewResult.items
      // Translate the spec-side per-key statuses to OYO-257 keys so
      // the renderer can read them straight off the tree's leaves
      // without re-running specKeyToImportSelectionKey itself.
      byImportSelectionKey = {}
      for (const [specKey, status] of diff.byNaturalKey) {
        byImportSelectionKey[specKeyToImportSelectionKey(specKey, importSource, spec)] = status
      }
      // Doc-vs-doc diff: format-agnostic comparison of the existing
      // env-folder apiDocumentation against the one the fresh import
      // just produced. Drives the wizard's summary counts; semantics
      // are uniform across import formats.
      const oldApiDoc = (env as unknown as { apiDocumentation?: ApiDocumentation }).apiDocumentation
      const freshFolder = previewResult.items[0] as { apiDocumentation?: ApiDocumentation }
      const newApiDoc = freshFolder.apiDocumentation
      if (newApiDoc) {
        const docDiff = compareApiDocumentations(oldApiDoc, newApiDoc)
        byOperationKey = {}
        for (const [key, status] of docDiff.byOperationKey) byOperationKey[key] = status
        byOperationKeyCounts = docDiff.counts
        modelsTouched = docDiff.modelsTouched
      }
    }
  } catch {
    // Treat a preview failure as "no tree available" — the wizard
    // falls back to its flat-list rendering, so missing this isn't
    // fatal. The byNaturalKey map alone is enough to drive Apply.
  }

  const result: RefreshDiffSummary = { byNaturalKey, counts: diff.counts }
  if (diff.newVersion !== undefined) result.newVersion = diff.newVersion
  if (previewTree !== undefined) result.previewTree = previewTree
  if (byImportSelectionKey !== undefined) result.byImportSelectionKey = byImportSelectionKey
  if (byOperationKey !== undefined) result.byOperationKey = byOperationKey
  if (byOperationKeyCounts !== undefined) result.byOperationKeyCounts = byOperationKeyCounts
  if (modelsTouched !== undefined) result.modelsTouched = modelsTouched
  return result
}

function parseFetched(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    return content
  }
}
