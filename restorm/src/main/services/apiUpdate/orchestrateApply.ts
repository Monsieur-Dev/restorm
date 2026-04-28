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

export async function runApiUpdateApply(folderId: string): Promise<void> {
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
  const spec = adapter.extractNormalizedSpec(JSON.parse(await fetchText(url, headers)), {})
  const fetchedHash = computeSpecHash(spec)
  const fetchedVersion = spec.version ?? extractVersionFromImported(freshFolder)

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

  pubsub.publish(PUBSUB_TOPICS.FOLDER_UPDATED, env)
  logger.info(`[apiUpdate.orchestrateApply] applied to folder ${folderId}`)
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
