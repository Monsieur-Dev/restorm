/**
 * Per-file, per-request environment-selection persistence.
 *
 * When the user switches the environment dropdown on a request, we save the
 * selected environment's *name path* (join of environment names from the
 * root env down to the selected sub-env) keyed by the request's tree path.
 * Environment / request runtime IDs are regenerated at every load so they
 * can't be used as stable keys.
 *
 * Storage layout (`window.api.storage`):
 *
 *   key:   `request_env_selections:${filePath}`
 *   value: `Record<requestPath, envNamePath>`
 *
 * e.g. `{ "1 - Swagger Petstore/1 - pet/1 - Find pet by ID": "Default/Production" }`.
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

// ---------- Environment tree traversal helpers ----------

/** Walk the full env tree (including nested sub-environments) depth-first. */
function* walkEnvironments(environments: Environment[], parentNames: readonly string[] = []): Generator<{ env: Environment; namePath: string[] }> {
  for (const env of environments) {
    const namePath = [...parentNames, env.name]
    yield { env, namePath }
    if (env.subEnvironments && env.subEnvironments.length > 0) {
      yield* walkEnvironments(env.subEnvironments, namePath)
    }
  }
}

/** Find the runtime ID of the environment whose name path (joined by `/`) matches. */
export function findEnvIdByNamePath(environments: Environment[] | undefined, namePath: string): string | null {
  if (!environments) return null
  for (const { env, namePath: candidate } of walkEnvironments(environments)) {
    if (candidate.join('/') === namePath) return env.id
  }
  return null
}

/** Build the name path for a given runtime env ID by walking the tree. */
export function findNamePathByEnvId(environments: Environment[] | undefined, envId: string): string | null {
  if (!environments) return null
  for (const { env, namePath } of walkEnvironments(environments)) {
    if (env.id === envId) return namePath.join('/')
  }
  return null
}

// ---------- Session in-memory cache ----------

/**
 * In-memory session cache mapping `${filePath}::${requestPath}` to the env
 * name path most recently chosen during the session. Survives
 * EnvironmentProvider remounts so reactive re-renders of the workbench
 * don't revert to the default environment.
 */
const sessionSelectionCache = new Map<string, string>()

function sessionCacheKey(filePath: string, requestPath: string): string {
  return `${filePath}::${requestPath}`
}

export function getSessionEnvSelection(filePath: string, requestPath: string): string | undefined {
  return sessionSelectionCache.get(sessionCacheKey(filePath, requestPath))
}

export function setSessionEnvSelection(filePath: string, requestPath: string, envNamePath: string): void {
  sessionSelectionCache.set(sessionCacheKey(filePath, requestPath), envNamePath)
}

export function hasSessionEnvSelection(filePath: string, requestPath: string): boolean {
  return sessionSelectionCache.has(sessionCacheKey(filePath, requestPath))
}

export function renameSessionEnvSelection(filePath: string, oldRequestPath: string, newRequestPath: string): void {
  if (oldRequestPath === newRequestPath) return
  const oldKey = sessionCacheKey(filePath, oldRequestPath)
  const existing = sessionSelectionCache.get(oldKey)
  if (existing === undefined) return
  sessionSelectionCache.delete(oldKey)
  sessionSelectionCache.set(sessionCacheKey(filePath, newRequestPath), existing)
}

// ---------- Public API ----------

export async function getStoredEnvForRequest(
  filePath: string,
  requestPath: string
): Promise<string | undefined> {
  const selections = await readAll(filePath)
  return selections[requestPath]
}

export async function setStoredEnvForRequest(
  filePath: string,
  requestPath: string,
  envNamePath: string
): Promise<void> {
  const selections = await readAll(filePath)
  if (selections[requestPath] === envNamePath) return
  selections[requestPath] = envNamePath
  await writeAll(filePath, selections)
}

/**
 * Rename a request's stored path so its saved environment survives a rename.
 * No-op if there's nothing saved under `oldPath`.
 */
export async function renameStoredRequestPath(
  filePath: string,
  oldPath: string,
  newPath: string
): Promise<void> {
  if (oldPath === newPath) return
  const selections = await readAll(filePath)
  const existing = selections[oldPath]
  if (existing === undefined) return
  const { [oldPath]: _removed, ...rest } = selections
  void _removed
  rest[newPath] = existing
  await writeAll(filePath, rest)
}
