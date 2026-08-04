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
import { getHistoryLimit, onHistoryLimitChanged } from './historyRetention'

const STORAGE_KEY = 'scenario_usage'
const SAVE_DEBOUNCE_MS = 500
const CHANGE_EVENT = 'scenario-usage:changed'

/** Per-scenario usage record. */
export interface ScenarioUsageEntry {
  /** Total runs started for this scenario. */
  count: number
  /** ISO timestamp of the last run. */
  lastRunAt: string
  /** The most recent run timestamps (newest first), capped by the
   *  `history:maxEntries` setting. */
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
  private unsubscribeLimit: (() => void) | null = null
  private initialized = false

  initialize(): void {
    if (this.initialized) return
    this.initialized = true
    const stored = getStorageService().get(STORAGE_KEY)
    this.data = isUsageMap(stored) ? stored : {}

    // Lowering the cap has to shrink what is ALREADY stored, not just bound
    // the next run — otherwise a user who drops the limit keeps seeing the
    // old, longer history until every scenario happens to be run again.
    this.unsubscribeLimit = onHistoryLimitChanged((limit) => {
      this.applyLimit(limit)
    })
  }

  dispose(): void {
    if (this.unsubscribeLimit) {
      this.unsubscribeLimit()
      this.unsubscribeLimit = null
    }
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
    const nextHistory = [now, ...(existing?.history ?? [])].slice(0, getHistoryLimit())
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

  /** Truncate every stored history to `limit`. No-op (no save, no broadcast)
   *  when nothing actually exceeded it, so raising the cap costs nothing. */
  private applyLimit(limit: number): void {
    let changed = false
    const next: ScenarioUsageMap = {}
    for (const [scenarioId, entry] of Object.entries(this.data)) {
      if (entry.history.length > limit) {
        next[scenarioId] = { ...entry, history: entry.history.slice(0, limit) }
        changed = true
      } else {
        next[scenarioId] = entry
      }
    }
    if (!changed) return
    this.data = next
    this.scheduleSave()
    this.broadcast()
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
