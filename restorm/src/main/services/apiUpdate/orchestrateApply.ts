import { logger } from 'electron-core-ui'
import type { EnvironmentFolder } from '../../../shared/types/folderTypes'
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
import { expandHeaderTemplate, expandVariables } from './scheduling'

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

function defaultVariablesFor(folder: EnvironmentFolder): Record<string, string> {
  const env = folder.environments[0]
  if (!env) return {}
  const vars: Record<string, string> = {}
  for (const kv of env.variables) {
    if (typeof kv.value === 'string') vars[kv.key] = kv.value
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

export async function runApiUpdateApply(folderId: string, selection?: ApiUpdateApplySelection): Promise<void> {
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
  const headers = expandHeaderTemplate(config.sourceHeaders, variables)
  const result = await importFrom(url, Object.keys(headers).length === 0 ? {} : { extraHeaders: headers })
  if (!result.success || result.items.length === 0) {
    throw new Error(result.error ?? 'Import returned no folder')
  }
  const freshFolder = result.items[0] as EnvironmentFolder

  // The freshly-built tree carries materialised requests we'll lift
  // into the existing folder. Capture the parsed normalised spec
  // ahead of time so the hash stored on disk matches what the
  // pipeline applied.
  const fullSpec = adapter.extractNormalizedSpec(JSON.parse(await fetchText(url, headers)), {})

  // Filter the spec down to the resolved selection before the
  // pipeline sees it. The naturalKey set the wizard sends is the
  // single source of truth for what gets imported / refreshed —
  // operations not in the set are invisible to the pipeline, so a
  // previously-skipped route the user didn't tick stays skipped.
  const include = selection ? new Set(selection.include) : new Set<string>()
  const spec = selection
    ? {
      ...fullSpec,
      operations: filterSpecBySelection(fullSpec.operations, include),
      models: filterModelsBySelection(fullSpec.models, include),
      enums: filterEnumsBySelection(fullSpec.enums, include)
    }
    : fullSpec

  const fetchedHash = computeSpecHash(fullSpec)
  const fetchedVersion = fullSpec.version ?? extractVersionFromImported(freshFolder)

  applyApiUpdate({
    target: env,
    freshFolder,
    spec,
    importSource,
    fetchedHash,
    ...(fetchedVersion !== undefined ? { fetchedVersion } : {})
  })

  env.apiUpdate = {
    ...config,
    lastImportedSpecHash: fetchedHash,
    ...(fetchedVersion !== undefined ? { lastImportedSpecVersion: fetchedVersion } : {}),
    lastCheckedAt: Date.now()
  }

  // Update the OYO-257 importSelection snapshot so the next refresh
  // remembers the user's decision: imported = what they checked
  // this round, skipped = what they ticked off explicitly.
  if (selection) {
    const envWithSelection = env as unknown as { importSelection?: import('../../../shared/types/baseTypes').ImportSelectionSnapshot }
    envWithSelection.importSelection = {
      capturedAt: Date.now(),
      source: url,
      ...(fetchedVersion !== undefined ? { specVersion: fetchedVersion } : {}),
      specHash: fetchedHash,
      imported: selection.include.slice().sort(),
      skipped: selection.skip.slice().sort()
    }
  }

  pubsub.publish(PUBSUB_TOPICS.FOLDER_UPDATED, env)
  logger.info(`[apiUpdate.orchestrateApply] applied to folder ${folderId}`, {
    selectedOps: spec.operations.length,
    totalOps: fullSpec.operations.length
  })
}

async function fetchText(url: string, headers: Record<string, string>): Promise<string> {
  const response = await fetch(url, Object.keys(headers).length === 0 ? {} : { headers })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  return response.text()
}

function extractVersionFromImported(folder: EnvironmentFolder): string | undefined {
  const apiDoc = (folder as unknown as { apiDocumentation?: { api?: { version?: string } } }).apiDocumentation
  return apiDoc?.api?.version
}
