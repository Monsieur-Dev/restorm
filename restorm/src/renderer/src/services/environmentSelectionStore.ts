/**
 * Environment selection persistence — workspace-scoped.
 *
 * Two tiers, both keyed by the project's UUID so they survive file
 * moves / renames outside the app (the UUID is stamped into the
 * collection file itself — see `PROJECT_UUID_KEY`):
 *
 *   1. **Folder default** — the env applied to every request of an
 *      env folder. This is the primary model and is what the
 *      "Apply to all" checkbox writes.
 *   2. **Per-request override** — the legacy "pick a different env
 *      for this one request only" flow. Written when the user
 *      un-ticks the checkbox before picking; wins over the folder
 *      default during resolution.
 *
 * Storage layout (`window.api.storage`):
 *
 *   key:   `env_folder_selections:${projectUuid}`
 *   value: `Record<envFolderId, envId>`
 *
 *   key:   `request_env_overrides:${projectUuid}`
 *   value: `Record<requestId, envId>`
 */

import type { Environment } from '../../../shared/types/collections'

const FOLDER_KEY_PREFIX = 'env_folder_selections:'
const OVERRIDE_KEY_PREFIX = 'request_env_overrides:'

type Selections = Record<string, string>

interface StorageApi {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<boolean>
  delete: (key: string) => Promise<boolean>
}

function getStorageApi(): StorageApi | undefined {
  return window.api.storage
}

function folderStorageKey(projectUuid: string): string {
  return `${FOLDER_KEY_PREFIX}${projectUuid}`
}

function overrideStorageKey(projectUuid: string): string {
  return `${OVERRIDE_KEY_PREFIX}${projectUuid}`
}

async function readAll(key: string): Promise<Selections> {
  const api = getStorageApi()
  if (!api) return {}
  const value = await api.get(key)
  if (value && typeof value === 'object') return value as Selections
  return {}
}

async function writeAll(key: string, selections: Selections): Promise<void> {
  const api = getStorageApi()
  if (!api) return
  if (Object.keys(selections).length === 0) {
    await api.delete(key)
    return
  }
  await api.set(key, selections)
}

/**
 * Per-storage-key write queue. A persisted selection is a read-all →
 * mutate → write-all cycle; two concurrent un-awaited writers (a folder
 * default + a request override flipped in the same tick) would each
 * read the pre-mutation map and the second write would clobber the
 * first. Chaining every mutation for a given key onto the previous one
 * serialises the RMW so no update is lost.
 */
const writeChains = new Map<string, Promise<void>>()

function runSerialized(key: string, task: () => Promise<void>): Promise<void> {
  const prev = writeChains.get(key) ?? Promise.resolve()
  // Swallow a prior rejection so one failed write doesn't poison the chain.
  const next = prev.catch(() => undefined).then(task)
  writeChains.set(key, next)
  // Drop the chain entry once it's the tail and settled, to avoid an
  // unbounded map of resolved promises.
  void next.catch(() => undefined).finally(() => {
    if (writeChains.get(key) === next) writeChains.delete(key)
  })
  return next
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

// ---------- Session in-memory caches ----------

/** Session cache: `${projectUuid}::${envFolderId}` → envId. Survives
 * provider remounts so React tree churn doesn't revert the picked env. */
const folderEnvSession = new Map<string, string>()
/** Session cache: `${projectUuid}::${requestId}` → envId (override). */
const requestOverrideSession = new Map<string, string>()

function sessionKey(projectUuid: string, id: string): string {
  return `${projectUuid}::${id}`
}

// ---------- Folder-level API ----------

export function getSessionFolderEnv(projectUuid: string, envFolderId: string): string | undefined {
  if (!projectUuid || !envFolderId) return undefined
  return folderEnvSession.get(sessionKey(projectUuid, envFolderId))
}

export function setSessionFolderEnv(projectUuid: string, envFolderId: string, envId: string): void {
  if (!projectUuid || !envFolderId) return
  folderEnvSession.set(sessionKey(projectUuid, envFolderId), envId)
}

export async function getStoredFolderEnv(projectUuid: string, envFolderId: string): Promise<string | undefined> {
  if (!projectUuid || !envFolderId) return undefined
  const selections = await readAll(folderStorageKey(projectUuid))
  return selections[envFolderId]
}

export async function setStoredFolderEnv(projectUuid: string, envFolderId: string, envId: string): Promise<void> {
  if (!projectUuid || !envFolderId) return
  const key = folderStorageKey(projectUuid)
  // Serialise the read-mutate-write so a concurrent writer can't clobber.
  return runSerialized(key, async () => {
    const selections = await readAll(key)
    if (selections[envFolderId] === envId) return
    selections[envFolderId] = envId
    await writeAll(key, selections)
  })
}

// ---------- Per-request override API ----------

export function getSessionRequestOverride(projectUuid: string, requestId: string): string | undefined {
  if (!projectUuid || !requestId) return undefined
  return requestOverrideSession.get(sessionKey(projectUuid, requestId))
}

export function setSessionRequestOverride(projectUuid: string, requestId: string, envId: string | null): void {
  if (!projectUuid || !requestId) return
  const key = sessionKey(projectUuid, requestId)
  if (envId === null) requestOverrideSession.delete(key)
  else requestOverrideSession.set(key, envId)
}

export async function getStoredRequestOverride(projectUuid: string, requestId: string): Promise<string | undefined> {
  if (!projectUuid || !requestId) return undefined
  const selections = await readAll(overrideStorageKey(projectUuid))
  return selections[requestId]
}

export async function setStoredRequestOverride(
  projectUuid: string,
  requestId: string,
  envId: string | null
): Promise<void> {
  if (!projectUuid || !requestId) return
  const key = overrideStorageKey(projectUuid)
  // Serialise the read-mutate-write so a concurrent writer can't clobber.
  return runSerialized(key, async () => {
    const selections = await readAll(key)
    if (envId === null) {
      if (!(requestId in selections)) return
      const { [requestId]: _removed, ...rest } = selections
      void _removed
      await writeAll(key, rest)
      return
    }
    if (selections[requestId] === envId) return
    selections[requestId] = envId
    await writeAll(key, selections)
  })
}

/** Synchronously wipe per-request override *session* entries for a
 * set of request ids. Split out from the disk-clear variant below so
 * callers can drop session state *before* emitting events that trigger
 * sibling providers to re-resolve — otherwise a sibling might still
 * find its stale override in the session cache and use it instead of
 * the fresh folder default. */
export function clearSessionRequestOverridesForRequests(
  projectUuid: string,
  requestIds: string[]
): void {
  if (!projectUuid || requestIds.length === 0) return
  for (const id of requestIds) {
    requestOverrideSession.delete(sessionKey(projectUuid, id))
  }
}

/** Wipe per-request overrides on disk for a set of request ids in one
 * pass. The session cache is *not* touched here — call
 * `clearSessionRequestOverridesForRequests` synchronously before any
 * event emission that could race with the async disk work. */
export async function clearStoredRequestOverridesForRequests(
  projectUuid: string,
  requestIds: string[]
): Promise<void> {
  if (!projectUuid || requestIds.length === 0) return
  const key = overrideStorageKey(projectUuid)
  // Serialise against the per-request override setter on the same key.
  return runSerialized(key, async () => {
    const selections = await readAll(key)
    const clear = new Set(requestIds)
    let changed = false
    const next: Selections = {}
    for (const [id, envId] of Object.entries(selections)) {
      if (clear.has(id)) {
        changed = true
        continue
      }
      next[id] = envId
    }
    if (changed) await writeAll(key, next)
  })
}
