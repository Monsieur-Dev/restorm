/**
 * Active-state cache. The renderer owns the truth (which workbench tab
 * is active, which env is selected per env-folder) — there's no easy
 * way for the main process to query React state synchronously, so we
 * flip the data flow: the renderer pushes a small patch any time
 * something interesting changes, and the main process maintains a
 * cache that the MCP tools read in O(1).
 *
 * Channels (renderer → main):
 *   - `mcp:active-tab-changed` → `{ tabId, itemId, kind }`
 *   - `mcp:active-env-changed` → `{ envFolderId, envId }` (envId may be `null` to clear)
 *
 * Stale-cache risk: if the renderer crashes, the main process keeps
 * the last-pushed value. That's fine — readers get a slightly stale
 * but well-formed answer rather than `null`. The renderer flushes a
 * fresh snapshot on every reload via `mcp:active-state-bootstrap`.
 */

import { ipcMain } from 'electron'
import { logger } from 'electron-core-ui/main'
import type { CurrentTabInfo } from '../types'

const tabSnapshot: CurrentTabInfo = { tabId: null, itemId: null, kind: null }
const selectedEnvByFolder = new Map<string, string | null>()

let registered = false

/** Fired after the active-env selection changes (or is bootstrapped), so a
 * consumer can react — e.g. ContextService recomputing per-item secret badges,
 * since switching the active env changes which env an item inherits. Registered
 * via {@link setActiveEnvChangeListener} to avoid an import cycle. */
let onActiveEnvChange: (() => void) | null = null

/** Register the active-env-change listener (idempotent — last one wins). */
export function setActiveEnvChangeListener(cb: () => void): void {
  onActiveEnvChange = cb
}

/**
 * Wire IPC listeners. Idempotent: safe to call once during boot or
 * multiple times during tests (the second call just no-ops).
 */
export function registerActiveStateBridge(): void {
  if (registered) return
  registered = true

  ipcMain.on('mcp:active-tab-changed', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const p = payload as Record<string, unknown>
    tabSnapshot.tabId = typeof p['tabId'] === 'string' ? p['tabId'] : null
    tabSnapshot.itemId = typeof p['itemId'] === 'string' ? p['itemId'] : null
    const k = p['kind']
    tabSnapshot.kind = k === 'request' || k === 'folder' || k === 'env-folder' || k === 'scenario' ? k : null
  })

  ipcMain.on('mcp:active-env-changed', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const p = payload as Record<string, unknown>
    const envFolderId = typeof p['envFolderId'] === 'string' ? p['envFolderId'] : null
    if (!envFolderId) return
    const envId = typeof p['envId'] === 'string' ? p['envId'] : null
    selectedEnvByFolder.set(envFolderId, envId)
    onActiveEnvChange?.()
  })

  ipcMain.on('mcp:active-state-bootstrap', (_event, payload: unknown) => {
    // Full-snapshot push the renderer fires on (re)load — useful when
    // the cache is empty or after an HMR cycle restarted the renderer
    // without restarting the main process.
    if (!payload || typeof payload !== 'object') return
    const p = payload as Record<string, unknown>
    const tab = p['tab']
    if (tab && typeof tab === 'object') {
      const t = tab as Record<string, unknown>
      tabSnapshot.tabId = typeof t['tabId'] === 'string' ? t['tabId'] : null
      tabSnapshot.itemId = typeof t['itemId'] === 'string' ? t['itemId'] : null
      const k = t['kind']
      tabSnapshot.kind = k === 'request' || k === 'folder' || k === 'env-folder' || k === 'scenario' ? k : null
    }
    const envs = p['envByFolder']
    // Only replace the cache from a NON-EMPTY snapshot. An empty `envByFolder`
    // (the MCP bridge's stub — per-folder selections are reported directly by
    // each EnvironmentProvider, not aggregated here) must NOT wipe those live
    // reports.
    if (envs && typeof envs === 'object' && Object.keys(envs).length > 0) {
      selectedEnvByFolder.clear()
      for (const [k, v] of Object.entries(envs as Record<string, unknown>)) {
        if (typeof v === 'string') selectedEnvByFolder.set(k, v)
        else if (v === null) selectedEnvByFolder.set(k, null)
      }
    }
    logger.debug('[mcp/activeState] bootstrap received', { tab: tabSnapshot, envCount: selectedEnvByFolder.size })
    onActiveEnvChange?.()
  })
}

export function getCurrentTabSnapshot(): CurrentTabInfo {
  return { ...tabSnapshot }
}

/**
 * Pick the renderer-selected env id for a folder. When the renderer
 * has reported a selection, return it (only if it's still in the live
 * env list — guards against stale values after the user deletes an
 * env). Returns `null` to let the caller fall back to its default.
 */
export function pickSelectedEnvId(envFolderId: string, liveEnvIds: readonly string[]): string | null {
  const cached = selectedEnvByFolder.get(envFolderId)
  if (cached === undefined || cached === null) return null
  return liveEnvIds.includes(cached) ? cached : null
}

/** Test-only reset. */
export function _resetActiveStateForTests(): void {
  tabSnapshot.tabId = null
  tabSnapshot.itemId = null
  tabSnapshot.kind = null
  selectedEnvByFolder.clear()
}
