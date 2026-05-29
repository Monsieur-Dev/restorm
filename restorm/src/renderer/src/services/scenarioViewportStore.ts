/**
 * Per-scenario graph viewport (pan + zoom) — workspace-scoped at the
 * **user** level (ECUI `StorageService` → `userData/config.json`), like
 * the request panel-collapse state. Survives tab close/reopen AND file
 * close/reopen, so reopening a scenario restores the exact view the
 * user left.
 *
 * Storage layout (`window.api.storage`):
 *
 *   key:   `scenario_viewport:${projectUuid}`
 *   value: `Record<scenarioId, { x, y, zoom }>`
 *
 * Reads are SYNC so the editor can seed React Flow's `defaultViewport`
 * on first render — an in-memory mirror per project is primed by
 * `preloadScenarioViewports(...)` when a project loads. Writes mutate
 * the cache synchronously + queue a debounced disk flush.
 */

const STORAGE_KEY_PREFIX = 'scenario_viewport:'
const PERSIST_DEBOUNCE_MS = 300

export interface Viewport {
  x: number
  y: number
  zoom: number
}

interface StorageApi {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<boolean>
  delete: (key: string) => Promise<boolean>
}

function getStorageApi(): StorageApi | undefined {
  return (window as unknown as { api?: { storage?: StorageApi } }).api?.storage
}

function storageKey(projectUuid: string): string {
  return `${STORAGE_KEY_PREFIX}${projectUuid}`
}

const sessionCache = new Map<string, Map<string, Viewport>>()
const pendingPersists = new Map<string, ReturnType<typeof setTimeout>>()

function ensureProjectMap(projectUuid: string): Map<string, Viewport> {
  let map = sessionCache.get(projectUuid)
  if (!map) {
    map = new Map()
    sessionCache.set(projectUuid, map)
  }
  return map
}

function isViewport(v: unknown): v is Viewport {
  return !!v && typeof v === 'object'
    && typeof (v as Viewport).x === 'number'
    && typeof (v as Viewport).y === 'number'
    && typeof (v as Viewport).zoom === 'number'
}

/** Prime the in-memory cache for `projectUuid` from disk. Await before
 *  the first scenario editor mounts so `getScenarioViewport` is warm. */
export async function preloadScenarioViewports(projectUuid: string): Promise<void> {
  if (!projectUuid) return
  if (sessionCache.has(projectUuid)) return
  const api = getStorageApi()
  if (!api) {
    sessionCache.set(projectUuid, new Map())
    return
  }
  const stored = await api.get(storageKey(projectUuid))
  const projectMap = new Map<string, Viewport>()
  if (stored && typeof stored === 'object') {
    for (const [scenarioId, vp] of Object.entries(stored as Record<string, unknown>)) {
      if (isViewport(vp)) projectMap.set(scenarioId, { x: vp.x, y: vp.y, zoom: vp.zoom })
    }
  }
  sessionCache.set(projectUuid, projectMap)
}

/** Sync read of a scenario's saved viewport, or `undefined` when none
 *  is stored (the editor then falls back to `fitView`). */
export function getScenarioViewport(projectUuid: string, scenarioId: string): Viewport | undefined {
  if (!projectUuid || !scenarioId) return undefined
  return sessionCache.get(projectUuid)?.get(scenarioId)
}

/** Record a scenario's viewport. Updates the cache synchronously +
 *  queues a debounced disk write (rapid pan/zoom coalesces). */
export function setScenarioViewport(projectUuid: string, scenarioId: string, viewport: Viewport): void {
  if (!projectUuid || !scenarioId || !isViewport(viewport)) return
  const projectMap = ensureProjectMap(projectUuid)
  const prev = projectMap.get(scenarioId)
  if (prev !== undefined) {
    if (prev.x === viewport.x && prev.y === viewport.y && prev.zoom === viewport.zoom) return
  }
  projectMap.set(scenarioId, { x: viewport.x, y: viewport.y, zoom: viewport.zoom })
  schedulePersist(projectUuid)
}

/** Test-only: clear the in-memory cache + pending timers. */
export function _resetScenarioViewportCacheForTest(): void {
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
  if (!projectMap?.size) {
    await api.delete(key)
    return
  }
  const out: Record<string, Viewport> = {}
  for (const [scenarioId, vp] of projectMap) out[scenarioId] = vp
  await api.set(key, out)
}
