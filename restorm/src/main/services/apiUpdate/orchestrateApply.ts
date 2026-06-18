import * as yaml from 'yaml'
import { logger } from 'electron-core-ui'
import type { EnvironmentFolder } from '../../../shared/types/folderTypes'
import { assertSafeFetchUrl } from '../../utils/urlSecurity'
import type { ApiUpdateConfig, ImportSourceType } from '../../../shared/types/baseTypes'
import { collectionStore, PUBSUB_TOPICS, pubsub } from '../CollectionStore'
import { importFrom } from '../import/ImportManager'
import { applyApiUpdate } from './applyApiUpdate'
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
import { computeSpecHash } from './specHash'
import { resolveAuthHeadersForFolder } from './resolveAuthHeaders'
import { specKeyToImportSelectionKey } from './specKeyTranslator'

/** Expand `${VAR}` placeholders against the env-var map. Mirrors the
 * resolution shape `registerApiUpdateIPC.refresh-fetch` uses so the
 * apply path consumes the exact same URL / header template the
 * refresh check just hit. */
function expandVariables(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{([^}]+)\}/g, (match, name: string) => vars[name] ?? match)
}

function expandHeaderTemplate(
  headers: Record<string, string> | undefined,
  vars: Record<string, string>
): Record<string, string> {
  if (!headers) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) out[k] = expandVariables(v, vars)
  return out
}

/**
 * Wire the IPC `apply` handler to the live runtime — fetch a fresh
 * spec via the existing `importFrom` (so we reuse the format
 * detection + materialiser), run the idempotent pipeline against the
 * stored folder, and persist the new content-hash + version markers.
 *
 * Two pieces this module owns and the rest of the apiUpdate code
 * doesn't:
 *
 * - Ties to `CollectionStore` for the live `EnvironmentFolder`
 *   instance and the folder-updated pubsub.
 * - Ties to `ImportManager.importFrom` for the per-format
 *   materialiser. The Checker only had to parse the spec; Apply
 *   needs fully-built `Request` instances to drop into the tree.
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
  return ['swagger', 'graphql', 'grpc', 'wsdl', 'asyncapi', 'postman', 'insomnia', 'bruno', 'curl', 'powershell', 'url'].includes(value)
}

function extractStringValue(v: unknown): string | undefined {
  // Variables come through the IPC sync as `StringValue` /
  // `ExpressionValue` instances flattened to `{ type, value }`. Plain
  // strings still land as strings (the renderer's reactive proxy
  // returns them transparently). Anything else collapses to undefined.
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

/**
 * Optional resolved-selection payload from the wizard. When present,
 * the pipeline only sees the operations / models / enums whose
 * natural keys are in `include` — everything else is filtered out
 * before the diff is computed, so a previously-skipped route stays
 * skipped unless the user explicitly opts it in. Without a payload,
 * the apply imports the full spec (the legacy "no selection" path
 * the badge / toast Apply button uses).
 */
export interface ApiUpdateApplySelection {
  /** Set of natural keys to import / refresh. Anything else is
   * dropped from the spec before the pipeline sees it. */
  include: string[]
  /** Set of natural keys the user explicitly chose to skip. Stored
   * on the import-selection snapshot so a subsequent refresh remembers
   * the decision. */
  skip: string[]
}

function filterSpecBySelection<T extends { naturalKey: string }>(items: T[], include: ReadonlySet<string>): T[] {
  if (include.size === 0) return items
  return items.filter((item) => include.has(item.naturalKey))
}

function filterModelsBySelection<T extends { name: string }>(models: T[], include: ReadonlySet<string>): T[] {
  if (include.size === 0) return models
  return models.filter((m) => include.has(`model:${m.name}`))
}

function filterEnumsBySelection<T extends { name: string }>(enums: T[], include: ReadonlySet<string>): T[] {
  if (include.size === 0) return enums
  return enums.filter((e) => include.has(`enum:${e.name}`))
}

export async function runApiUpdateApply(folderId: string, selection?: ApiUpdateApplySelection): Promise<{ updatedFolder: unknown }> {
  const target = collectionStore.findById(folderId)
  if (!target || !('folderType' in target)) {
    throw new Error(`Folder ${folderId} not found`)
  }
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
  // Resolve the env folder's attached auth route (if any) before
  // dispatching the spec fetch. The dynamic headers (e.g. a freshly
  // minted `Authorization: Bearer …`) are merged on top of the
  // static `${VAR}`-expanded ones; the static set wins on a key
  // collision so an explicit override stays explicit.
  const dynamicHeaders = await resolveAuthHeadersForFolder(env, config.authenticationRequestId, variables)
  const headers = { ...dynamicHeaders, ...staticHeaders }
  const result = await importFrom(url, Object.keys(headers).length === 0 ? {} : { extraHeaders: headers })
  if (!result.success || result.items.length === 0) {
    throw new Error(result.error ?? 'Import returned no folder')
  }
  const freshFolder = result.items[0] as EnvironmentFolder

  // The freshly-built tree carries materialised requests we'll lift
  // into the existing folder. Capture the parsed normalised spec
  // ahead of time so the hash stored on disk matches what the
  // pipeline applied. The raw text is kept alongside so the
  // post-apply `payloadChecksum` can hash the exact body the
  // refresh-fetch handler would see on the next round-trip.
  const rawSpecText = await fetchText(url, headers)
  // Format-aware parse: specs are commonly served as YAML, and a bare
  // `JSON.parse` of a YAML body throws straight out of the IPC handler.
  // `yaml.parse` accepts JSON too (JSON is a YAML subset).
  let parsedSpec: unknown
  try {
    parsedSpec = yaml.parse(rawSpecText)
  } catch (err) {
    throw new Error(`Failed to parse spec from ${url}: ${err instanceof Error ? err.message : String(err)}`)
  }
  const fullSpec = adapter.extractNormalizedSpec(parsedSpec, {})

  // The renderer's `include` set carries ImportSelectionTree keys
  // (`request:http:METHOD {{baseUrl}}/path/{{id}}`); the pipeline
  // filters by spec-side `naturalKey` (`METHOD /path/{id}`). Build
  // an inclusion set in the spec key-space by walking the spec
  // operations + translating each one through specKeyToImportSelectionKey
  // and keeping the ones whose translated form is in `include`.
  const includeSnapshotKeys = selection ? new Set(selection.include) : new Set<string>()
  const includeSpecKeys = selection
    ? new Set(
      fullSpec.operations
        .map((op) => op.naturalKey)
        .filter((key) => includeSnapshotKeys.has(specKeyToImportSelectionKey(key, importSource, fullSpec)))
    )
    : new Set<string>()
  const spec = selection
    ? {
      ...fullSpec,
      operations: filterSpecBySelection(fullSpec.operations, includeSpecKeys),
      models: filterModelsBySelection(fullSpec.models, includeSpecKeys),
      enums: filterEnumsBySelection(fullSpec.enums, includeSpecKeys)
    }
    : fullSpec

  const fetchedHash = computeSpecHash(fullSpec)

  const applyResult = applyApiUpdate({
    target: env,
    freshFolder,
    spec,
    importSource,
    fetchedHash
  })

  // Hash the exact body the importer parsed so the next refresh
  // round-trip compares like-for-like — without this the Refresh
  // button would always pop the Import modal (refresh-fetch hashes
  // the raw text, and any structural-only hash would diverge).
  const { createHash } = await import('node:crypto')
  const payloadChecksum = `sha256:${createHash('sha256').update(rawSpecText).digest('hex')}`

  const now = Date.now()
  env.apiUpdate = {
    ...config,
    lastCheckedAt: now,
    lastImportedAt: now,
    payloadChecksum
  }

  pubsub.publish(PUBSUB_TOPICS.FOLDER_UPDATED, env)
  logger.info(`[apiUpdate.orchestrateApply] applied to folder ${folderId}`, {
    selectedOps: spec.operations.length,
    totalOps: fullSpec.operations.length,
    addedCount: applyResult.addedRequests.length
  })

  // Return only the new requests + their target placement + the
  // post-apply apiUpdate marker. The renderer splices the new rows
  // into its own folder copy at the same breadcrumb path the apply
  // pipeline used, so additions land under the same tag / group
  // folder a fresh import would have produced (instead of at the
  // env-folder root).
  const addedRequests = applyResult.addedRequests.map((entry) => ({
    request: JSON.parse(JSON.stringify(entry.request)) as unknown,
    parentPath: [...entry.parentPath]
  }))
  return {
    updatedFolder: {
      id: env.id,
      addedRequests,
      apiUpdate: JSON.parse(JSON.stringify(env.apiUpdate)) as unknown
    }
  }
}

async function fetchText(url: string, headers: Record<string, string>): Promise<string> {
  // SSRF guard: the spec URL ultimately comes from a stored
  // (user-supplied) config and this fetch is not firewall-gated.
  assertSafeFetchUrl(url)
  const response = await fetch(url, Object.keys(headers).length === 0 ? {} : { headers })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  return response.text()
}
