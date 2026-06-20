/**
 * Per-scenario debug breakpoints — workspace-scoped at the **user** level
 * (ECUI `StorageService` → `userData/config.json`), exactly like the scenario
 * viewport store. Breakpoints are a personal debugging aid (like an editor's
 * gutter breakpoints): they are deliberately NOT written into the scenario
 * file, so they never travel through git and never collide between users.
 *
 * Storage layout (`window.api.storage`):
 *
 *   key:   `scenario_breakpoints:${projectUuid}`
 *   value: `Record<scenarioId, nodeId[]>`
 *
 * Reads are SYNC (an in-memory mirror per project, primed by
 * `preloadScenarioBreakpoints(...)` on project load) so the node boxes can
 * paint their breakpoint glyph on first render. Writes mutate the cache
 * synchronously + queue a debounced disk flush.
 *
 * Because the scenario file can be edited elsewhere (e.g. a teammate deletes a
 * box in git), a stored breakpoint may reference a node that no longer exists.
 * `pruneScenarioBreakpoints(...)` drops those on load — and even if one slips
 * through, the engine only ever receives a `Set<nodeId>` where an unknown id
 * simply never matches, so a stale breakpoint can never crash a run.
 */

const STORAGE_KEY_PREFIX = 'scenario_breakpoints:'
const PERSIST_DEBOUNCE_MS = 300

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

const sessionCache = new Map<string, Map<string, Set<string>>>()
const pendingPersists = new Map<string, ReturnType<typeof setTimeout>>()

function ensureProjectMap(projectUuid: string): Map<string, Set<string>> {
  let map = sessionCache.get(projectUuid)
  if (!map) {
    map = new Map()
    sessionCache.set(projectUuid, map)
  }
  return map
}

/** Prime the in-memory cache for `projectUuid` from disk. Await before the
 *  first scenario editor mounts so the sync reads below are warm. */
export async function preloadScenarioBreakpoints(projectUuid: string): Promise<void> {
  if (!projectUuid) return
  if (sessionCache.has(projectUuid)) return
  const api = getStorageApi()
  if (!api) {
    sessionCache.set(projectUuid, new Map())
    return
  }
  const stored = await api.get(storageKey(projectUuid))
  const projectMap = new Map<string, Set<string>>()
  if (stored && typeof stored === 'object') {
    for (const [scenarioId, ids] of Object.entries(stored as Record<string, unknown>)) {
      if (Array.isArray(ids)) {
        const set = new Set(ids.filter((id): id is string => typeof id === 'string'))
        if (set.size > 0) projectMap.set(scenarioId, set)
      }
    }
  }
  sessionCache.set(projectUuid, projectMap)
}

/** Sync read of a scenario's breakpoint node-ids (a fresh copy; never the live
 *  set). Empty when none are stored. */
export function getScenarioBreakpoints(projectUuid: string, scenarioId: string): Set<string> {
  if (!projectUuid || !scenarioId) return new Set()
  const set = sessionCache.get(projectUuid)?.get(scenarioId)
  return set ? new Set(set) : new Set()
}

/** Whether a specific node currently carries a breakpoint. */
export function isBreakpointSet(projectUuid: string, scenarioId: string, nodeId: string): boolean {
  return sessionCache.get(projectUuid)?.get(scenarioId)?.has(nodeId) === true
}

/** Whether the scenario has at least one breakpoint — drives the debug
 *  button's enabled/greyed state. */
export function hasAnyBreakpoint(projectUuid: string, scenarioId: string): boolean {
  return (sessionCache.get(projectUuid)?.get(scenarioId)?.size ?? 0) > 0
}

/** Toggle a node's breakpoint; returns the new state (`true` = now set). */
export function toggleBreakpoint(projectUuid: string, scenarioId: string, nodeId: string): boolean {
  if (!projectUuid || !scenarioId || !nodeId) return false
  const projectMap = ensureProjectMap(projectUuid)
  let set = projectMap.get(scenarioId)
  if (!set) { set = new Set(); projectMap.set(scenarioId, set) }
  let nowSet: boolean
  if (set.has(nodeId)) { set.delete(nodeId); nowSet = false } else { set.add(nodeId); nowSet = true }
  if (set.size === 0) projectMap.delete(scenarioId)
  schedulePersist(projectUuid)
  return nowSet
}

/** Drop breakpoints whose node no longer exists in the scenario (the file may
 *  have been edited elsewhere). Returns true when something was pruned. */
export function pruneScenarioBreakpoints(projectUuid: string, scenarioId: string, validNodeIds: ReadonlySet<string>): boolean {
  const set = sessionCache.get(projectUuid)?.get(scenarioId)
  if (!set || set.size === 0) return false
  let removed = false
  for (const id of [...set]) {
    if (!validNodeIds.has(id)) { set.delete(id); removed = true }
  }
  if (removed) {
    if (set.size === 0) sessionCache.get(projectUuid)?.delete(scenarioId)
    schedulePersist(projectUuid)
  }
  return removed
}

/** Test-only: clear the in-memory cache + pending timers. */
export function _resetScenarioBreakpointCacheForTest(): void {
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
  const out: Record<string, string[]> = {}
  for (const [scenarioId, ids] of projectMap) out[scenarioId] = [...ids]
  await api.set(key, out)
}
