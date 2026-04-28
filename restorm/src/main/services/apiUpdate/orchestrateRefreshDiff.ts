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

function defaultVariablesFor(folder: EnvironmentFolder): Record<string, string> {
  const env = folder.environments[0]
  if (!env) return {}
  const vars: Record<string, string> = {}
  for (const kv of env.variables) {
    if (typeof kv.value === 'string') vars[kv.key] = kv.value
  }
  return vars
}

export interface RefreshDiffSummary {
  byNaturalKey: Record<string, RefreshStatus>
  counts: Record<RefreshStatus, number>
  newVersion?: string
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
    newSpec: spec
  })

  const byNaturalKey: Record<string, RefreshStatus> = {}
  for (const [key, status] of diff.byNaturalKey) byNaturalKey[key] = status
  const result: RefreshDiffSummary = { byNaturalKey, counts: diff.counts }
  if (diff.newVersion !== undefined) result.newVersion = diff.newVersion
  return result
}

function parseFetched(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    return content
  }
}
