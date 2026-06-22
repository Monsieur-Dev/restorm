/**
 * Quick-config storage service — two backends behind one interface.
 *
 * The 'settings' backend persists to user settings (`userData/config.json`)
 * via `window.api.storage`, keyed `request_quick_configs:<projectUuid>`.
 * It survives project close/reopen and is user-local.
 *
 * The 'project' backend persists to the .restorm file by writing to an
 * optional `quickConfigs` array on the reactive request proxy. The reactive
 * proxy's set-trap emits a debounced REQUEST_UPDATED event → autosave
 * picks it up. Round-trips through disk like any other request field.
 *
 * Both backends keep an in-memory cache per project session. Writes are
 * always synchronous in-memory and asynchronous to disk (debounced for
 * the settings backend; immediate for the project backend via reactive proxy).
 */

import type { QuickConfig, QuickConfigStorageTarget } from '../../../shared/types/requests/QuickConfig'
import type { Request } from '../../../shared/types/collections'

// ============================================================================
// Helpers
// ============================================================================

/** Generate a random id — used for new QuickConfig.id values. */
function generateId(): string {
  return `qc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Identity fields that are NEVER part of a snapshot. */
const EXCLUDED_FIELDS = new Set([
  'id',
  'name',
  'notes',
  'tags',
  'icon',
  'importOrigin',
  'deprecated',
  'removed',
  'toPlainObject',
  'authenticationRequestId',
  'type'
])

/**
 * Extract the snapshot fields from a reactive request proxy: every field
 * EXCEPT identity + auth route. Works generically across all protocols
 * (comment #4 decision: snapshot uniformly, no curated per-protocol subset).
 */
export function extractSnapshotFields(request: Request): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {}
  const reqMap = request as unknown as Record<string, unknown>
  for (const key of Object.keys(reqMap)) {
    if (!EXCLUDED_FIELDS.has(key)) {
      snapshot[key] = reqMap[key]
    }
  }
  return snapshot
}

// ============================================================================
// Settings backend (user-settings via window.api.storage)
// ============================================================================

const SETTINGS_KEY_PREFIX = 'request_quick_configs:'
const SETTINGS_PERSIST_DEBOUNCE_MS = 300

interface StorageApi {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<boolean>
  delete: (key: string) => Promise<boolean>
}

function getStorageApi(): StorageApi | undefined {
  return window.api.storage
}

function settingsKey(projectUuid: string): string {
  return `${SETTINGS_KEY_PREFIX}${projectUuid}`
}

/** In-memory cache: projectUuid → requestId → QuickConfig[] (settings target only) */
const settingsCache = new Map<string, Map<string, QuickConfig[]>>()
const settingsPendingPersists = new Map<string, ReturnType<typeof setTimeout>>()

function ensureSettingsProjectMap(projectUuid: string): Map<string, QuickConfig[]> {
  let map = settingsCache.get(projectUuid)
  if (!map) {
    map = new Map()
    settingsCache.set(projectUuid, map)
  }
  return map
}

/** Prime the settings cache from disk. Call once after project open. */
export async function preloadQuickConfigSettings(projectUuid: string): Promise<void> {
  if (!projectUuid) return
  if (settingsCache.has(projectUuid)) return
  const api = getStorageApi()
  if (!api) {
    settingsCache.set(projectUuid, new Map())
    return
  }
  const stored = await api.get(settingsKey(projectUuid))
  const projectMap = new Map<string, QuickConfig[]>()
  if (stored && typeof stored === 'object') {
    for (const [reqId, configs] of Object.entries(stored as Record<string, unknown>)) {
      if (!Array.isArray(configs)) continue
      const parsed: QuickConfig[] = []
      for (const item of configs) {
        const rec = item as Record<string, unknown>
        if (item && typeof item === 'object' && typeof rec['id'] === 'string') {
          parsed.push(item as QuickConfig)
        }
      }
      if (parsed.length > 0) projectMap.set(reqId, parsed)
    }
  }
  settingsCache.set(projectUuid, projectMap)
}

function scheduleSettingsPersist(projectUuid: string): void {
  const existing = settingsPendingPersists.get(projectUuid)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    settingsPendingPersists.delete(projectUuid)
    void persistSettingsNow(projectUuid)
  }, SETTINGS_PERSIST_DEBOUNCE_MS)
  settingsPendingPersists.set(projectUuid, timer)
}

async function persistSettingsNow(projectUuid: string): Promise<void> {
  const api = getStorageApi()
  if (!api) return
  const projectMap = settingsCache.get(projectUuid)
  const key = settingsKey(projectUuid)
  if (!projectMap || projectMap.size === 0) {
    await api.delete(key)
    return
  }
  const out: Record<string, QuickConfig[]> = {}
  for (const [reqId, configs] of projectMap) {
    if (configs.length > 0) out[reqId] = configs
  }
  if (Object.keys(out).length === 0) {
    await api.delete(key)
    return
  }
  await api.set(key, out)
}

/** Sync read of settings-target configs for a request. */
export function getSettingsConfigs(projectUuid: string, requestId: string): QuickConfig[] {
  if (!projectUuid || !requestId) return []
  const projectMap = settingsCache.get(projectUuid)
  return projectMap?.get(requestId) ?? []
}

/** Save or overwrite a settings-target config by name. Returns the saved config. */
export function saveSettingsConfig(
  projectUuid: string,
  requestId: string,
  name: string,
  fields: Record<string, unknown>
): QuickConfig {
  const projectMap = ensureSettingsProjectMap(projectUuid)
  const existing = projectMap.get(requestId) ?? []
  const trimmedName = name.trim()
  const existingIdx = existing.findIndex((c) => c.name === trimmedName)
  const now = new Date().toISOString()

  let saved: QuickConfig
  const existingEntry = existingIdx >= 0 ? existing[existingIdx] : undefined
  if (existingIdx >= 0 && existingEntry !== undefined) {
    saved = { ...existingEntry, fields, updatedAt: now }
    existing[existingIdx] = saved
  } else {
    saved = { id: generateId(), name: trimmedName, requestId, storageTarget: 'settings', fields, createdAt: now, updatedAt: now }
    existing.push(saved)
  }
  projectMap.set(requestId, existing)
  scheduleSettingsPersist(projectUuid)
  return saved
}

/** Delete a settings-target config by id. */
export function deleteSettingsConfig(projectUuid: string, requestId: string, configId: string): void {
  const projectMap = settingsCache.get(projectUuid)
  if (!projectMap) return
  const existing = projectMap.get(requestId)
  if (!existing) return
  const next = existing.filter((c) => c.id !== configId)
  if (next.length === 0) {
    projectMap.delete(requestId)
  } else {
    projectMap.set(requestId, next)
  }
  scheduleSettingsPersist(projectUuid)
}

/** Clear in-memory cache (for tests / project close). */
export function resetQuickConfigSettingsCache(): void {
  for (const timer of settingsPendingPersists.values()) clearTimeout(timer)
  settingsPendingPersists.clear()
  settingsCache.clear()
}

// ============================================================================
// Project backend (reads/writes via the reactive request proxy)
// The reactive proxy emits REQUEST_UPDATED on assignment → autosave handles
// serialisation (prepareForSerialization strips runtime ids on save, and
// processAfterDeserialization regenerates them on load).
// ============================================================================

/**
 * Read the project-target configs for a request from its reactive proxy.
 * The `quickConfigs` field is an optional array of QuickConfig on the request.
 */
export function getProjectConfigs(request: Request): QuickConfig[] {
  const raw = (request as unknown as Record<string, unknown>)['quickConfigs']
  if (!Array.isArray(raw)) return []
  return raw.filter((c): c is QuickConfig =>
    c !== null &&
    typeof c === 'object' &&
    typeof (c as Record<string, unknown>)['id'] === 'string'
  )
}

/**
 * Save or overwrite a project-target config by name. Mutates the reactive
 * proxy — the set-trap fires REQUEST_UPDATED → autosave serialises to disk.
 * Returns the saved config.
 */
export function saveProjectConfig(
  request: Request,
  name: string,
  fields: Record<string, unknown>
): QuickConfig {
  const existing = getProjectConfigs(request)
  const trimmedName = name.trim()
  const existingIdx = existing.findIndex((c) => c.name === trimmedName)
  const now = new Date().toISOString()

  let saved: QuickConfig
  const existingEntry = existingIdx >= 0 ? existing[existingIdx] : undefined
  if (existingIdx >= 0 && existingEntry !== undefined) {
    saved = { ...existingEntry, fields, updatedAt: now }
    existing[existingIdx] = saved
  } else {
    saved = { id: generateId(), name: trimmedName, requestId: request.id, storageTarget: 'project', fields, createdAt: now, updatedAt: now }
    existing.push(saved)
  }
  // Assigning to the reactive proxy fires the set-trap → REQUEST_UPDATED.
  ;(request as unknown as Record<string, unknown>)['quickConfigs'] = [...existing]
  return saved
}

/**
 * Delete a project-target config by id. Mutates the reactive proxy.
 */
export function deleteProjectConfig(request: Request, configId: string): void {
  const existing = getProjectConfigs(request)
  const next = existing.filter((c) => c.id !== configId)
  ;(request as unknown as Record<string, unknown>)['quickConfigs'] = next
}

// ============================================================================
// Unified helpers (merge both backends for display)
// ============================================================================

/** Return the merged list of configs for a request from both backends,
 * settings configs first, then project configs. Each entry carries its
 * `storageTarget` badge so the UI can discriminate them. */
export function getAllConfigs(
  request: Request,
  projectUuid: string
): QuickConfig[] {
  const settingsConfigs = getSettingsConfigs(projectUuid, request.id).map((c) => ({
    ...c,
    storageTarget: 'settings' as QuickConfigStorageTarget
  }))
  const projectConfigs = getProjectConfigs(request).map((c) => ({
    ...c,
    storageTarget: 'project' as QuickConfigStorageTarget
  }))
  return [...settingsConfigs, ...projectConfigs]
}

/**
 * Find the first saved config whose fields deep-equal the current snapshot
 * (after stripping KeyValue runtime ids via prepareForSerialization).
 * Returns the config, or undefined if no match.
 */
export function findMatchingConfig(
  configs: QuickConfig[],
  currentFields: Record<string, unknown>
): QuickConfig | undefined {
  if (configs.length === 0) return undefined

  // Normalize for comparison: strip runtime ids from KeyValue arrays.
  // We use a simple JSON round-trip after stripping `id` from every object
  // that looks like a KeyValue (has key/value but no 'name' or 'type' field).
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      return v.map((item) => {
        if (
          item !== null &&
          typeof item === 'object' &&
          'key' in item &&
          'value' in item &&
          !('name' in item)
        ) {
          const { id: _id, ...rest } = item as Record<string, unknown>
          return rest
        }
        return normalize(item)
      })
    }
    if (v !== null && typeof v === 'object') {
      const result: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        result[k] = normalize(val)
      }
      return result
    }
    return v
  }

  const normalizedCurrent = JSON.stringify(normalize(currentFields))

  return configs.find((config) => {
    try {
      return JSON.stringify(normalize(config.fields)) === normalizedCurrent
    } catch {
      return false
    }
  })
}

/**
 * Apply a saved config's fields to a reactive request proxy. Assigning
 * each field triggers the reactive proxy's set-trap, which debounces and
 * emits REQUEST_UPDATED — the same autosave path as any user edit.
 * The tab view's own useEffect hooks subscribe to REQUEST_UPDATED and
 * re-call updateFullRequestData, so Handlebars resolution re-runs
 * automatically without explicit cross-process calls here.
 */
export function applyConfigToRequest(request: Request, config: QuickConfig): void {
  const req = request as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(config.fields)) {
    req[key] = value
  }
}
