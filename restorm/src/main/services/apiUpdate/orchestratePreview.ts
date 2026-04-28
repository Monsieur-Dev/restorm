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

function defaultVariablesFor(folder: EnvironmentFolder): Record<string, string> {
  const env = folder.environments[0]
  if (!env) return {}
  const vars: Record<string, string> = {}
  for (const kv of env.variables) {
    if (typeof kv.value === 'string') vars[kv.key] = kv.value
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
  const headers = expandHeaderTemplate(config.sourceHeaders, variables)
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
