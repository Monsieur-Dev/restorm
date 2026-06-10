/**
 * Persists scenario runs to the shared history archive (the same
 * `<project>.responses.zip` as the response history). Each run stores the
 * complete run-tree log + deep copies of every scenario the run
 * references (main + transitively-referenced sub-scenarios), under
 * `scenarioRuns/<guid>.json`, indexed by the archive's `scenarios` slice.
 *
 * Retention mirrors the response history: the newest
 * `DEFAULT_MAX_PER_SCENARIO` non-pinned runs per scenario are kept,
 * pinned runs are kept indefinitely. All writes go through the shared
 * `queueHistoryWrite` so they never interleave with response writes; each
 * write preserves the `responses/` slice it doesn't own.
 */
import { randomUUID } from 'crypto'
import { logger } from 'electron-core-ui/main'
import {
  getHistoryArchivePath,
  readHistoryArchive,
  writeHistoryArchive,
  queueHistoryWrite,
  INDEX_FILE_NAME,
  SCENARIO_RUNS_FOLDER,
  type HistoryArchiveIndex
} from './historyArchive'
import type {
  ScenarioRunHistoryDetail,
  ScenarioRunHistoryEntry,
  ScenarioRunHistoryStatus,
  ScenarioRunLogEntry,
  ScenarioRunSnapshot
} from '../../shared/types/scenarioRunHistory'

const DEFAULT_MAX_PER_SCENARIO = 10

export interface StoreScenarioRunInput {
  scenarioId: string
  scenarioName: string
  startedAt: string
  endedAt: string
  status: ScenarioRunHistoryStatus
  scenarios: ScenarioRunSnapshot[]
  log: ScenarioRunLogEntry[]
}

class ScenarioRunHistoryService {
  /** Persist one completed run. No-ops (with a debug log) when no project
   * file is open. */
  async storeRun(input: StoreScenarioRunInput): Promise<void> {
    try {
      const archivePath = getHistoryArchivePath()
      if (!archivePath) {
        logger.debug('[ScenarioRunHistoryService] No archive path, skipping run save')
        return
      }
      const guid = randomUUID()
      const detail: ScenarioRunHistoryDetail = {
        guid,
        scenarioId: input.scenarioId,
        scenarioName: input.scenarioName,
        timestamp: input.startedAt,
        endedAt: input.endedAt,
        pinned: false,
        status: input.status,
        scenarios: input.scenarios,
        log: input.log
      }

      await queueHistoryWrite(async () => {
        const { index, entriesData } = await readHistoryArchive(archivePath)
        const { updatedIndex, keptGuids } = this.addRunAndPrune(index, detail)

        const nextEntriesData = new Map<string, string>()
        for (const [entryName, entryText] of entriesData.entries()) {
          if (entryName === INDEX_FILE_NAME) continue
          if (entryName.startsWith(`${SCENARIO_RUNS_FOLDER}/`) && entryName.endsWith('.json')) {
            const entryGuid = entryName.slice(`${SCENARIO_RUNS_FOLDER}/`.length, -'.json'.length)
            if (keptGuids.has(entryGuid)) nextEntriesData.set(entryName, entryText)
          } else {
            // Preserve the response-history slice we don't own.
            nextEntriesData.set(entryName, entryText)
          }
        }
        nextEntriesData.set(this.detailEntryName(guid), JSON.stringify(detail))
        await writeHistoryArchive(archivePath, updatedIndex, nextEntriesData)
      })
    } catch (error) {
      logger.error('[ScenarioRunHistoryService] Failed to store scenario run', {
        scenarioId: input.scenarioId,
        error: String(error)
      })
    }
  }

  /** Runs for one scenario, most recent first. */
  async list(scenarioId: string): Promise<ScenarioRunHistoryEntry[]> {
    const archivePath = getHistoryArchivePath()
    if (!archivePath) return []
    const { index } = await readHistoryArchive(archivePath)
    const scenario = index.scenarios.find((s) => s.scenarioId === scenarioId)
    return scenario?.runs.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp)) ?? []
  }

  /** Full detail (logs + scenario snapshots) for one run. */
  async getDetail(guid: string): Promise<ScenarioRunHistoryDetail | null> {
    const archivePath = getHistoryArchivePath()
    if (!archivePath) return null
    const { entriesData } = await readHistoryArchive(archivePath)
    const text = entriesData.get(this.detailEntryName(guid))
    if (!text) return null
    return this.parseDetail(text)
  }

  /** Pin / unpin a run. Pinned runs are never pruned. */
  async togglePin(guid: string, pinned: boolean): Promise<boolean> {
    const archivePath = getHistoryArchivePath()
    if (!archivePath) return false
    return queueHistoryWrite(async () => {
      const { index, entriesData } = await readHistoryArchive(archivePath)
      let entry: ScenarioRunHistoryEntry | null = null
      for (const scenario of index.scenarios) {
        const found = scenario.runs.find((r) => r.guid === guid)
        if (found) { entry = found; break }
      }
      if (!entry) return false
      entry.pinned = pinned
      const detailName = this.detailEntryName(guid)
      const detailText = entriesData.get(detailName)
      if (detailText) {
        const parsed = this.parseDetail(detailText)
        if (parsed) {
          parsed.pinned = pinned
          entriesData.set(detailName, JSON.stringify(parsed))
        }
      }
      await writeHistoryArchive(archivePath, index, entriesData)
      return true
    })
  }

  private addRunAndPrune(
    index: HistoryArchiveIndex,
    detail: ScenarioRunHistoryDetail
  ): { updatedIndex: HistoryArchiveIndex; keptGuids: Set<string> } {
    const entry: ScenarioRunHistoryEntry = {
      guid: detail.guid,
      timestamp: detail.timestamp,
      pinned: detail.pinned,
      status: detail.status,
      scenarioName: detail.scenarioName
    }

    const scenarios = index.scenarios.map((s) => ({ ...s, runs: [...s.runs] }))
    let target = scenarios.find((s) => s.scenarioId === detail.scenarioId)
    if (!target) {
      target = { scenarioId: detail.scenarioId, runs: [] }
      scenarios.push(target)
    }
    target.runs.push(entry)

    const pinnedRuns = target.runs.filter((r) => r.pinned)
    const keptNonPinned = target.runs
      .filter((r) => !r.pinned)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, DEFAULT_MAX_PER_SCENARIO)
    const keepGuids = new Set([...pinnedRuns, ...keptNonPinned].map((r) => r.guid))
    target.runs = target.runs.filter((r) => keepGuids.has(r.guid))

    const keptGuidsAll = new Set<string>()
    for (const s of scenarios) for (const r of s.runs) keptGuidsAll.add(r.guid)

    return {
      updatedIndex: { ...index, scenarios: scenarios.filter((s) => s.runs.length > 0) },
      keptGuids: keptGuidsAll
    }
  }

  private detailEntryName(guid: string): string {
    return `${SCENARIO_RUNS_FOLDER}/${guid}.json`
  }

  private parseDetail(text: string): ScenarioRunHistoryDetail | null {
    try {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null) return null
      const rec = parsed as Record<string, unknown>
      if (typeof rec['guid'] !== 'string') return null
      if (typeof rec['scenarioId'] !== 'string') return null
      if (!Array.isArray(rec['log'])) return null
      if (!Array.isArray(rec['scenarios'])) return null
      return parsed as ScenarioRunHistoryDetail
    } catch {
      return null
    }
  }
}

export const scenarioRunHistoryService = new ScenarioRunHistoryService()
