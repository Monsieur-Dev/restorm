/**
 * Per-request panel collapsed/expanded state — workspace-scoped at
 * the **user** level (ECUI `StorageService` → `userData/config.json`).
 * Survives tab close/reopen AND file close/reopen.
 *
 * Storage layout (`window.api.storage`):
 *
 *   key:   `request_panel_state:${projectUuid}`
 *   value: `Record<requestId, Record<paneId, boolean>>`
 *
 * Reads need to be SYNC so each `*RequestTabView` can seed its
 * `useState` lazy initializer on first render — we keep an
 * in-memory mirror of the on-disk map per project. `preload(...)` is
 * called once when a project finishes loading and primes the cache;
 * later reads hit the cache only. Writes mutate the cache
 * synchronously and queue a debounced disk flush.
 */

const STORAGE_KEY_PREFIX = 'request_panel_state:'
const PERSIST_DEBOUNCE_MS = 300

type PaneMap = Record<string, boolean>

interface StorageApi {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<boolean>
  delete: (key: string) => Promise<boolean>
}

function getStorageApi(): StorageApi | undefined {
  return window.api.storage
}

function storageKey(projectUuid: string): string {
  return `${STORAGE_KEY_PREFIX}${projectUuid}`
}

const sessionCache = new Map<string, Map<string, PaneMap>>()
const pendingPersists = new Map<string, ReturnType<typeof setTimeout>>()

function ensureProjectMap(projectUuid: string): Map<string, PaneMap> {
  let map = sessionCache.get(projectUuid)
  if (!map) {
    map = new Map()
    sessionCache.set(projectUuid, map)
  }
  return map
}

/** Prime the in-memory cache for `projectUuid` from disk. Must be
 *  awaited before the first `*RequestTabView` mounts — otherwise the
 *  sync getter below returns `undefined` and the tab falls back to
 *  its heuristic defaults instead of the persisted state. */
export async function preloadRequestPanelStates(projectUuid: string): Promise<void> {
  if (!projectUuid) return
  // Don't trample an existing in-memory entry: the cache is the
  // source of truth once it's been touched (a re-preload triggered
  // by a remount would otherwise drop unsaved toggles still in
  // flight to disk).
  if (sessionCache.has(projectUuid)) return
  const api = getStorageApi()
  if (!api) {
    sessionCache.set(projectUuid, new Map())
    return
  }
  const stored = await api.get(storageKey(projectUuid))
  const projectMap = new Map<string, PaneMap>()
  if (stored && typeof stored === 'object') {
    for (const [reqId, paneRaw] of Object.entries(stored as Record<string, unknown>)) {
      if (!paneRaw || typeof paneRaw !== 'object') continue
      const paneMap: PaneMap = {}
      for (const [paneId, value] of Object.entries(paneRaw as Record<string, unknown>)) {
        if (typeof value === 'boolean') paneMap[paneId] = value
      }
      projectMap.set(reqId, paneMap)
    }
  }
  sessionCache.set(projectUuid, projectMap)
}

/** Sync read of the panel-state map for a single request. Returns
 *  `undefined` when no entry is stored (the tab view then falls
 *  back to its per-section heuristic). */
export function getRequestPanelState(projectUuid: string, requestId: string): PaneMap | undefined {
  if (!projectUuid || !requestId) return undefined
  const projectMap = sessionCache.get(projectUuid)
  return projectMap?.get(requestId)
}

/** Mutate a single pane's collapsed flag. Synchronously updates the
 *  cache + queues a debounced disk write. Multiple toggles inside
 *  the debounce window coalesce into one storage round-trip. */
export function setRequestPanelCollapsed(
  projectUuid: string,
  requestId: string,
  paneId: string,
  collapsed: boolean
): void {
  if (!projectUuid || !requestId || !paneId) return
  const projectMap = ensureProjectMap(projectUuid)
  const paneMap = projectMap.get(requestId) ?? {}
  if (paneMap[paneId] === collapsed) return
  paneMap[paneId] = collapsed
  projectMap.set(requestId, paneMap)
  schedulePersist(projectUuid)
}

/** Drop the per-request entry when a request is deleted. Called by
 *  the renderer-side delete pipeline so the user-level store
 *  doesn't accumulate orphaned ids. */
export function removeRequestPanelState(projectUuid: string, requestId: string): void {
  if (!projectUuid || !requestId) return
  const projectMap = sessionCache.get(projectUuid)
  if (!projectMap?.has(requestId)) return
  projectMap.delete(requestId)
  schedulePersist(projectUuid)
}

/** Test-only escape hatch — clears the in-memory cache so unit
 *  tests can start from a known state. NOT exported via the
 *  service barrel; reach for it explicitly from test files. */
export function _resetSessionCacheForTest(): void {
  for (const timer of pendingPersists.values()) clearTimeout(timer)
  pendingPersists.clear()
  sessionCache.clear()
}

function schedulePersist(projectUuid: string): void {
  const existing = pendingPersists.get(projectUuid)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    pendingPersists.delete(projectUuid)
    void persistNow(projectUuid)
  }, PERSIST_DEBOUNCE_MS)
  pendingPersists.set(projectUuid, timer)
}

async function persistNow(projectUuid: string): Promise<void> {
  const api = getStorageApi()
  if (!api) return
  const projectMap = sessionCache.get(projectUuid)
  const key = storageKey(projectUuid)
  if (!projectMap || projectMap.size === 0) {
    await api.delete(key)
    return
  }
  const out: Record<string, PaneMap> = {}
  for (const [reqId, paneMap] of projectMap) {
    if (Object.keys(paneMap).length > 0) out[reqId] = paneMap
  }
  if (Object.keys(out).length === 0) {
    await api.delete(key)
    return
  }
  await api.set(key, out)
}
