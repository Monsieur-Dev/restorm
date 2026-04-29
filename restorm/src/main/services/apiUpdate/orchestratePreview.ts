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
 * Same as the renderer-side `import.preview` IPC, except auth is
 * resolved against the env folder's stored `apiUpdate` config (so
 * `{{client_id}}`-style variables in the saved auth route get
 * expanded against the folder's first environment), and the source
 * URL is taken from the folder rather than user input. The refresh
 * variant of the import modal calls this so it doesn't have to
 * re-implement the auth-resolution dance the renderer can't see.
 */
export async function runApiUpdatePreviewTree(
  folderId: string
): Promise<{ success: boolean; items: unknown[]; error?: string }> {
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
    return { success: true, items: result.items as unknown[] }
  } catch (err) {
    return { success: false, items: [], error: err instanceof Error ? err.message : String(err) }
  }
}
