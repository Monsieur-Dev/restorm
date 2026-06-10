/**
 * ScenarioUsageService — the scenario counterpart of `RequestUsageService`.
 * Counts how many times each scenario has been RUN and remembers the last few
 * run timestamps, so the EmptyBench surfaces recently-run scenarios next to
 * recently-sent requests (cross-API `RecentActivityCard` + per-env-folder
 * `ApiCard`).
 *
 * Mirrors RequestUsageService exactly: user-level storage (ECUI
 * `StorageService` → `userData/config.json`), keyed globally by `scenarioId`,
 * broadcast on every mutation. Only TOP-LEVEL interactive runs are recorded
 * (the `scenario:engine:start` IPC); sub-scenarios launched internally by the
 * scheduler don't go through that path, so the count reflects what the user
 * actually ran, not the fan-out.
 *
 * Deletions are not pruned here (there's no scenario-deleted document event);
 * the renderer filters the returned map against the open project's tree, so an
 * orphaned entry simply isn't rendered. The storage footprint is negligible.
 */
import { BrowserWindow } from 'electron'
import { logger, getStorageService } from 'electron-core-ui/main'

const STORAGE_KEY = 'scenario_usage'
const HISTORY_LIMIT = 10
const SAVE_DEBOUNCE_MS = 500
const CHANGE_EVENT = 'scenario-usage:changed'

/** Per-scenario usage record. */
export interface ScenarioUsageEntry {
  /** Total runs started for this scenario. */
  count: number
  /** ISO timestamp of the last run. */
  lastRunAt: string
  /** Last 10 run timestamps (newest first). */
  history: string[]
}

export type ScenarioUsageMap = Record<string, ScenarioUsageEntry>

function isUsageMap(value: unknown): value is ScenarioUsageMap {
  if (!value || typeof value !== 'object') return false
  for (const v of Object.values(value)) {
    if (!v || typeof v !== 'object') return false
    const entry = v as Partial<ScenarioUsageEntry>
    if (typeof entry.count !== 'number') return false
    if (typeof entry.lastRunAt !== 'string') return false
    if (!Array.isArray(entry.history)) return false
  }
  return true
}

class ScenarioUsageService {
  private data: ScenarioUsageMap = {}
  private saveTimer: NodeJS.Timeout | null = null
  private initialized = false

  initialize(): void {
    if (this.initialized) return
    this.initialized = true
    const stored = getStorageService().get(STORAGE_KEY)
    this.data = isUsageMap(stored) ? stored : {}
  }

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      this.flush()
    }
    this.initialized = false
  }

  /** Record a single run. Called from the `scenario:engine:start` IPC handler
   *  (the interactive Run / Debug entry point). */
  recordRun(scenarioId: string): void {
    if (!scenarioId) return
    const now = new Date().toISOString()
    const existing = this.data[scenarioId]
    const nextHistory = [now, ...(existing?.history ?? [])].slice(0, HISTORY_LIMIT)
    this.data[scenarioId] = {
      count: (existing?.count ?? 0) + 1,
      lastRunAt: now,
      history: nextHistory
    }
    this.scheduleSave()
    this.broadcast()
  }

  /** Current snapshot of the full map (shallow clone). */
  getAll(): ScenarioUsageMap {
    return { ...this.data }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flush()
    }, SAVE_DEBOUNCE_MS)
  }

  private flush(): void {
    try {
      getStorageService().set(STORAGE_KEY, this.data)
    } catch (error) {
      logger.error('[ScenarioUsageService] Failed to persist usage map', { error: String(error) })
    }
  }

  private broadcast(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(CHANGE_EVENT, this.data)
    }
  }
}

export const scenarioUsageService = new ScenarioUsageService()
