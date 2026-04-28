import { logger } from 'electron-core-ui'
import type { ApiUpdateConfig, ApiUpdateState, ImportSourceType } from '../../../shared/types/baseTypes'
import type { NormalizedSpec, ImportAdapter } from '../import/idempotent/types'
import { swaggerImportAdapter } from '../import/idempotent/SwaggerAdapter'
import { graphqlImportAdapter } from '../import/idempotent/GraphQLAdapter'
import { detectFormat } from '../import/ImportManager'
import {
  compareSpecAgainstStored,
  expandHeaderTemplate,
  expandVariables
} from './scheduling'
import { computeSpecHash } from './specHash'
import { apiUpdateStateStore } from './ApiUpdateStateStore'

/**
 * Single-folder API spec check. Wires together fetch → parse →
 * adapter normalisation → hash → comparison and emits the resulting
 * `ApiUpdateState` transitions through `ApiUpdateStateStore`.
 *
 * Lifecycle as observed by subscribers:
 *
 *     idle → checking → unchanged | available | error
 *
 * The Checker never mutates the env folder itself — applying an
 * available update is a separate user-initiated action that lives in
 * `applyApiUpdate.ts` (consumes `runIdempotentImport`). Splitting the
 * two keeps the auto-tick path side-effect-free against the user's
 * data.
 */
export interface ApiUpdateCheckInput {
  folderId: string
  importSource: ImportSourceType
  config: ApiUpdateConfig
  /** Resolved env-folder variables for `${VAR}` substitution. */
  variables: Record<string, string>
  /** When `true`, errors bubble up as a toast on the renderer; when
   * `false` (auto tick), errors stay silent in the state. */
  manual: boolean
}

export interface ApiUpdateCheckResult {
  state: ApiUpdateState
  /** Set when the check decides an update is available — the renderer
   * caches it so a subsequent "Apply" doesn't have to re-fetch. */
  fetchedSpec?: NormalizedSpec
  fetchedRawContent?: string
  fetchedFormat?: string
}

const ADAPTERS: Partial<Record<ImportSourceType, ImportAdapter>> = {
  swagger: swaggerImportAdapter,
  graphql: graphqlImportAdapter
}

/**
 * Resolve the import-format string `detectFormat` returns onto the
 * `ImportSourceType` slug the rest of the project uses. Necessary
 * because `detectFormat` distinguishes `openapi-3.0` / `openapi-3.1`
 * even though they share an `ImportSourceType` (they don't have a
 * dedicated adapter yet — that's tracked in §8 of the ticket).
 */
function detectedFormatToImportSource(format: string | null): ImportSourceType | null {
  if (format === null) return null
  if (format === 'openapi-3.0' || format === 'openapi-3.1') return 'swagger'
  if (format === 'swagger') return 'swagger'
  if (format === 'graphql') return 'graphql'
  if (format === 'grpc') return 'grpc'
  if (format === 'soap') return 'wsdl'
  if (format === 'asyncapi') return 'asyncapi'
  if (format === 'postman') return 'postman'
  if (format === 'insomnia') return 'insomnia'
  if (format === 'bruno') return 'bruno'
  if (format === 'curl') return 'curl'
  if (format === 'powershell') return 'powershell'
  return null
}

/**
 * Read `info.version` (Swagger / OpenAPI), `version` (GraphQL
 * snapshot), or fall back to `undefined` for formats that don't
 * publish a version. Used by the comparator alongside the structural
 * hash.
 */
function extractSpecVersion(parsed: unknown): string | undefined {
  if (parsed === null || typeof parsed !== 'object') return undefined
  const obj = parsed as Record<string, unknown>
  if ('info' in obj && typeof obj.info === 'object' && obj.info !== null) {
    const info = obj.info as Record<string, unknown>
    if (typeof info.version === 'string') return info.version
  }
  if (typeof obj.version === 'string') return obj.version
  return undefined
}

async function fetchSpec(url: string, headers: Record<string, string>): Promise<{ content: string }> {
  const response = await fetch(url, Object.keys(headers).length === 0 ? {} : { headers })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  const content = await response.text()
  return { content }
}

function parseContent(content: string, format: string): unknown {
  if (format === 'graphql' || format === 'soap' || format === 'grpc') {
    return content
  }
  return JSON.parse(content)
}

/**
 * Run a single check against the configured spec source. Public entry
 * point both the scheduler (for auto ticks) and the IPC `checkNow`
 * handler reuse.
 */
export async function runApiUpdateCheck(input: ApiUpdateCheckInput): Promise<ApiUpdateCheckResult> {
  const { folderId, importSource, config, variables, manual } = input
  const previousState = apiUpdateStateStore.get(folderId)
  apiUpdateStateStore.patch(folderId, {
    kind: 'checking',
    error: undefined,
    currentVersion: config.lastImportedSpecVersion
  })

  try {
    const url = expandVariables(config.sourceUrl, variables)
    const headers = expandHeaderTemplate(config.sourceHeaders, variables)
    const { content } = await fetchSpec(url, headers)

    const detected = detectFormat(content, url)
    const resolved = detectedFormatToImportSource(detected) ?? importSource
    const adapter = ADAPTERS[resolved]
    if (!adapter) {
      throw new Error(`No idempotent adapter for ${resolved}`)
    }

    const parsed = parseContent(content, detected ?? resolved)
    const spec = adapter.extractNormalizedSpec(parsed, {})
    const fetchedHash = computeSpecHash(spec)
    const fetchedVersion = extractSpecVersion(parsed) ?? spec.version

    const comparison = compareSpecAgainstStored({
      ...(fetchedVersion !== undefined ? { fetchedVersion } : {}),
      fetchedHash,
      ...(config.lastImportedSpecVersion !== undefined ? { storedVersion: config.lastImportedSpecVersion } : {}),
      ...(config.lastImportedSpecHash !== undefined ? { storedHash: config.lastImportedSpecHash } : {})
    })

    const lastCheckedAt = Date.now()
    if (comparison.status === 'firstCheck' || comparison.status === 'unchanged') {
      const state: ApiUpdateState = {
        kind: 'idle',
        currentVersion: config.lastImportedSpecVersion,
        lastCheckedAt
      }
      apiUpdateStateStore.set(folderId, state)
      return { state, fetchedSpec: spec, fetchedRawContent: content, ...(detected !== null ? { fetchedFormat: detected } : {}) }
    }

    const state: ApiUpdateState = {
      kind: 'available',
      currentVersion: config.lastImportedSpecVersion,
      ...(fetchedVersion !== undefined ? { availableVersion: fetchedVersion } : {}),
      lastCheckedAt
    }
    apiUpdateStateStore.set(folderId, state)
    return { state, fetchedSpec: spec, fetchedRawContent: content, ...(detected !== null ? { fetchedFormat: detected } : {}) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(`[ApiUpdateChecker] check failed for folder ${folderId}: ${message}`)
    const state: ApiUpdateState = {
      kind: 'error',
      currentVersion: previousState.currentVersion,
      lastCheckedAt: Date.now(),
      error: manual ? message : `Auto-check failed: ${message}`
    }
    apiUpdateStateStore.set(folderId, state)
    return { state }
  }
}
