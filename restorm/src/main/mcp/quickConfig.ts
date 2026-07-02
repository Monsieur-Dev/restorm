/**
 * Main-process access to a request's quick-config saved configurations, so MCP
 * tools can read + manage them. Mirrors the renderer's quick-config store
 * (restorm/src/renderer/src/services/requestQuickConfigStore.ts):
 *
 *  - 'project'  target → the request's own `quickConfigs` array (held in
 *    `collectionStore`, persisted in the .restorm file; travels with the project).
 *  - 'settings' target → user settings (ECUI `getStorageService()` →
 *    `userData/config.json`), keyed `request_quick_configs:<projectUuid>` →
 *    `{ [requestId]: QuickConfig[] }` (user-local, survives project close).
 *
 * MCP READS both targets (`listConfigs`); MCP WRITES only the project target.
 * The settings target is owned by the renderer (it keeps an in-memory cache it
 * primes once and rewrites wholesale on its own writes), so a main-side settings
 * write would be clobbered the next time the user edits a settings config — the
 * project target has no such cache (a tree broadcast resyncs it), so writes are
 * safe there.
 *
 * A QuickConfig's `fields` are a snapshot of the request's own config fields
 * (every field minus identity). `validateConfigFields` rejects a payload that
 * carries fields the bound request's protocol does not accept; the accepted set
 * per protocol is exposed by `describeConfigSchema` for AI discoverability. The
 * per-protocol sets are the request models' own `fromPlain` fields minus the
 * identity set the renderer snapshot also drops — kept honest by a drift test.
 */

import { randomUUID } from 'crypto'
import { getStorageService } from 'electron-core-ui/main'
import { getFavoritesSnapshot } from './favoritesBridge'
import type { QuickConfig, QuickConfigStorageTarget } from '../../shared/types/requests/QuickConfig'
import type { Request } from '../../shared/types/collections'
import { REQUEST_TYPES } from '../../shared/models/types'

type Protocol = typeof REQUEST_TYPES[number]

/**
 * The config-field set accepted per protocol: each request model's serialisable
 * config fields (its `fromPlain` parameters minus the identity fields the
 * renderer snapshot excludes — id/name/notes/tags/icon/importOrigin/deprecated/
 * removed/authenticationRequestId/type/quickConfigs). `documentation` IS a config
 * field (the renderer snapshot keeps it), so a saved snapshot round-trips through
 * add/update. A drift test guards each set against the live model.
 */
export const PROTOCOL_CONFIG_FIELDS: Record<Protocol, readonly string[]> = {
  http: ['documentation', 'method', 'url', 'headers', 'params', 'pathParams', 'body', 'server', 'mockStatus', 'timeout', 'followRedirects'],
  graphql: ['documentation', 'url', 'operationType', 'query', 'variables', 'operationName', 'headers', 'server', 'schema', 'mockResolvers', 'resolverScript'],
  grpc: ['documentation', 'url', 'service', 'method', 'callType', 'requestMessage', 'metadata', 'server', 'mockMethods', 'protoContent', 'protoPath', 'protoDescriptorSet', 'reflection', 'tls', 'tlsCertPem', 'tlsKeyPem'],
  soap: ['documentation', 'url', 'soapAction', 'service', 'operation', 'body', 'headers', 'server', 'mockOperations'],
  websocket: ['documentation', 'url', 'protocol', 'event', 'message', 'headers', 'server', 'qos', 'retain', 'clientId', 'username', 'password', 'keepalive', 'mqttSubscribe', 'lwtTopic', 'lwtPayload', 'lwtQos', 'lwtRetain'],
  odata: ['documentation', 'url', 'odataVersion', 'operationKind', 'headers', 'params', 'queryOptions', 'actionBody', 'batchSubRequests', 'batchFormat', 'entityTypeRef', 'allowGetInChangeSet', 'forceAbsoluteBatchUrls', 'entitySetProperties', 'navigationProperties', 'operationParameters', 'server', 'mockMetadata', 'mockData'],
  auth: ['documentation', 'method', 'url', 'headers', 'params', 'pathParams', 'body', 'producedHeaders', 'expirationExpression', 'authErrorCodes'],
  jsonrpc: ['documentation', 'url', 'headers', 'method', 'params', 'rpcId', 'notificationMode'],
  jsonrpcBatch: ['documentation', 'url', 'headers', 'children']
}

/** Read a request's protocol (`type`), narrowed to a known protocol or null. */
export function requestProtocol(request: Request): Protocol | null {
  const t = (request as { type?: unknown }).type
  return typeof t === 'string' && (REQUEST_TYPES as readonly string[]).includes(t) ? (t as Protocol) : null
}

/** Validate that `fields` only carries keys the protocol accepts. Returns an
 * error message, or null when valid. */
export function validateConfigFields(protocol: Protocol, fields: unknown): string | null {
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
    return 'fields must be an object of request config values'
  }
  const allowed = new Set(PROTOCOL_CONFIG_FIELDS[protocol])
  const unknownKeys = Object.keys(fields as Record<string, unknown>).filter((k) => !allowed.has(k))
  if (unknownKeys.length > 0) {
    return `fields [${unknownKeys.join(', ')}] are not valid for a ${protocol} request; accepted: ${PROTOCOL_CONFIG_FIELDS[protocol].join(', ')}`
  }
  return null
}

/** The describe payload for the AI: accepted field set for one protocol (or all). */
export function describeConfigSchema(protocol?: Protocol): Record<string, readonly string[]> {
  if (protocol) return { [protocol]: PROTOCOL_CONFIG_FIELDS[protocol] }
  return { ...PROTOCOL_CONFIG_FIELDS }
}

// ============================================================================
// Project backend — the request's own `quickConfigs` array (the only WRITE path)
// ============================================================================

function readProjectConfigs(request: Request): QuickConfig[] {
  const raw = (request as unknown as Record<string, unknown>)['quickConfigs']
  if (!Array.isArray(raw)) return []
  return raw.filter((c): c is QuickConfig =>
    c !== null && typeof c === 'object' && typeof (c as Record<string, unknown>)['id'] === 'string')
}

function writeProjectConfigs(request: Request, configs: QuickConfig[]): void {
  ;(request as unknown as Record<string, unknown>)['quickConfigs'] = configs
}

// ============================================================================
// Settings backend — user settings store (READ-only from MCP, see file header)
// ============================================================================

const SETTINGS_KEY_PREFIX = 'request_quick_configs:'

/** The active project's uuid (tracked by the MCP favorites bridge), or null. */
export function activeProjectUuid(): string | null {
  return getFavoritesSnapshot().projectUuid
}

function readSettingsConfigs(projectUuid: string, requestId: string): QuickConfig[] {
  const stored = getStorageService().get(`${SETTINGS_KEY_PREFIX}${projectUuid}`)
  if (stored && typeof stored === 'object') {
    const arr = (stored as Record<string, unknown>)[requestId]
    if (Array.isArray(arr)) return arr as QuickConfig[]
  }
  return []
}

// ============================================================================
// CRUD used by the MCP tools (writes are project-target only)
// ============================================================================

export interface QuickConfigResult { ok: true; config?: QuickConfig }
export interface QuickConfigError { ok: false; error: string }
export type QuickConfigOutcome = QuickConfigResult | QuickConfigError

/** All configs for a request, settings (read-only) first then project, each
 * carrying its storageTarget badge. */
export function listConfigs(request: Request): QuickConfig[] {
  const project = readProjectConfigs(request).map((c) => ({ ...c, storageTarget: 'project' as QuickConfigStorageTarget }))
  const uuid = activeProjectUuid()
  const settings = uuid
    ? readSettingsConfigs(uuid, request.id).map((c) => ({ ...c, storageTarget: 'settings' as QuickConfigStorageTarget }))
    : []
  return [...settings, ...project]
}

/** Add (or overwrite by name) a PROJECT-target quick-config. */
export function addConfig(
  request: Request,
  name: string,
  fields: Record<string, unknown>
): QuickConfigOutcome {
  const protocol = requestProtocol(request)
  if (!protocol) return { ok: false, error: `request ${request.id} has no recognised protocol` }
  const fieldError = validateConfigFields(protocol, fields)
  if (fieldError) return { ok: false, error: fieldError }
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: 'name is required' }
  const now = new Date().toISOString()

  const existing = readProjectConfigs(request)
  const idx = existing.findIndex((c) => c.name === trimmed)
  const saved: QuickConfig = idx >= 0
    ? { ...existing[idx], fields, updatedAt: now }
    : { id: `qc_${randomUUID()}`, name: trimmed, requestId: request.id, storageTarget: 'project', fields, createdAt: now, updatedAt: now }
  if (idx >= 0) existing[idx] = saved; else existing.push(saved)
  writeProjectConfigs(request, [...existing])
  return { ok: true, config: saved }
}

/** Update a PROJECT-target quick-config's fields and/or name by id. */
export function updateConfig(
  request: Request,
  configId: string,
  patch: { fields?: Record<string, unknown>; name?: string }
): QuickConfigOutcome {
  const protocol = requestProtocol(request)
  if (!protocol) return { ok: false, error: `request ${request.id} has no recognised protocol` }
  if (patch.fields !== undefined) {
    const fieldError = validateConfigFields(protocol, patch.fields)
    if (fieldError) return { ok: false, error: fieldError }
  }
  const trimmedName = patch.name?.trim()
  const project = readProjectConfigs(request)
  const idx = project.findIndex((c) => c.id === configId)
  if (idx < 0) return { ok: false, error: notFoundError(request, configId) }
  const next: QuickConfig = {
    ...project[idx],
    ...(patch.fields !== undefined ? { fields: patch.fields } : {}),
    ...(trimmedName ? { name: trimmedName } : {}),
    updatedAt: new Date().toISOString()
  }
  project[idx] = next
  writeProjectConfigs(request, [...project])
  return { ok: true, config: next }
}

/** Delete a PROJECT-target quick-config by id. */
export function deleteConfig(request: Request, configId: string): QuickConfigOutcome {
  const project = readProjectConfigs(request)
  if (!project.some((c) => c.id === configId)) return { ok: false, error: notFoundError(request, configId) }
  writeProjectConfigs(request, project.filter((c) => c.id !== configId))
  return { ok: true }
}

/** A not-found message that also explains the settings-target is read-only here. */
function notFoundError(request: Request, configId: string): string {
  const uuid = activeProjectUuid()
  const inSettings = uuid !== null && readSettingsConfigs(uuid, request.id).some((c) => c.id === configId)
  return inSettings
    ? `quick-config ${configId} is a user-settings config — those are managed in the app; MCP manages project configs`
    : `no project quick-config with id ${configId} on request ${request.id}`
}
