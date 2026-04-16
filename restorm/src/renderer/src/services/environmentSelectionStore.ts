/**
 * Per-file, per-request environment-selection persistence.
 *
 * Request and environment document ids are now persisted in the collection
 * file, so this store keys by `requestId` and saves the selected env by
 * `envId` directly — no more name-path walking, and duplicates at any
 * level of the tree no longer collide.
 *
 * Storage layout (`window.api.storage`):
 *
 *   key:   `request_env_selections:${filePath}`
 *   value: `Record<requestId, envId>`
 */

import type { Environment } from '../../../shared/types/collections'

const STORAGE_KEY_PREFIX = 'request_env_selections:'

type Selections = Record<string, string>

interface StorageApi {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<boolean>
  delete: (key: string) => Promise<boolean>
}

function getStorageApi(): StorageApi | undefined {
  return (window as unknown as { api?: { storage?: StorageApi } }).api?.storage
}

function storageKey(filePath: string): string {
  return `${STORAGE_KEY_PREFIX}${filePath}`
}

async function readAll(filePath: string): Promise<Selections> {
  const api = getStorageApi()
  if (!api || !filePath) return {}
  const value = await api.get(storageKey(filePath))
  if (value && typeof value === 'object') return value as Selections
  return {}
}

async function writeAll(filePath: string, selections: Selections): Promise<void> {
  const api = getStorageApi()
  if (!api || !filePath) return
  if (Object.keys(selections).length === 0) {
    await api.delete(storageKey(filePath))
    return
  }
  await api.set(storageKey(filePath), selections)
}

// ---------- Environment tree lookup ----------

/** Find an environment (including nested sub-envs) by its id. */
export function findEnvironmentById(environments: Environment[] | undefined, envId: string): Environment | null {
  if (!environments) return null
  for (const env of environments) {
    if (env.id === envId) return env
    const nested = findEnvironmentById(env.subEnvironments, envId)
    if (nested) return nested
  }
  return null
}

// ---------- Session in-memory cache ----------

/**
 * In-memory session cache mapping `${filePath}::${requestId}` to the most
 * recently chosen env id during the session. Survives EnvironmentProvider
 * remounts so reactive re-renders of the workbench don't revert to the
 * default environment.
 */
const sessionSelectionCache = new Map<string, string>()

function sessionCacheKey(filePath: string, requestId: string): string {
  return `${filePath}::${requestId}`
}

export function getSessionEnvSelection(filePath: string, requestId: string): string | undefined {
  return sessionSelectionCache.get(sessionCacheKey(filePath, requestId))
}

export function setSessionEnvSelection(filePath: string, requestId: string, envId: string): void {
  sessionSelectionCache.set(sessionCacheKey(filePath, requestId), envId)
}

export function hasSessionEnvSelection(filePath: string, requestId: string): boolean {
  return sessionSelectionCache.has(sessionCacheKey(filePath, requestId))
}

// ---------- Public API ----------

export async function getStoredEnvForRequest(
  filePath: string,
  requestId: string
): Promise<string | undefined> {
  const selections = await readAll(filePath)
  return selections[requestId]
}

export async function setStoredEnvForRequest(
  filePath: string,
  requestId: string,
  envId: string
): Promise<void> {
  const selections = await readAll(filePath)
  if (selections[requestId] === envId) return
  selections[requestId] = envId
  await writeAll(filePath, selections)
}
