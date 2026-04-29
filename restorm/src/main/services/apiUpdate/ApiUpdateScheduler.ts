import { logger } from 'electron-core-ui'
import type { ApiUpdateConfig, ImportSourceType } from '../../../shared/types/baseTypes'
import { isApiUpdateDue } from './scheduling'
import { runApiUpdateCheck } from './ApiUpdateChecker'

/**
 * Per-folder snapshot the scheduler iterates on every tick. The
 * scheduler does not own the env folders — `CollectionStore` does
 * — so the bootstrap layer feeds it through `setFolders()` whenever
 * the project changes (file open / close / save).
 */
export interface ApiUpdateSchedulerFolder {
  folderId: string
  importSource: ImportSourceType
  config: ApiUpdateConfig
  /** Resolved env-folder variables for `${VAR}` substitution. */
  variables: Record<string, string>
  /**
   * Hook called whenever the scheduler decides a check ran. Lets the
   * caller persist the updated `lastCheckedAt` (and on success, the
   * latest version + hash) without the scheduler reaching back into
   * the store directly.
   */
  onCheckCompleted: (patch: Pick<ApiUpdateConfig, 'lastCheckedAt'>) => void
}

/**
 * Polls registered folders on a fixed interval and dispatches
 * `runApiUpdateCheck` against the ones that are "due".
 *
 * The tick interval is intentionally coarse (5 minutes by default)
 * — the per-folder cadence (`hourly`, `daily`, …) is enforced by
 * `isApiUpdateDue`. A 5-min granularity means a "weekly" folder may
 * fire up to 5 minutes late, which is fine and saves the cost of
 * spinning the timer faster.
 */
export class ApiUpdateScheduler {
  private folders = new Map<string, ApiUpdateSchedulerFolder>()
  private timer: NodeJS.Timeout | null = null
  private readonly tickMs: number

  constructor(tickMs = 5 * 60 * 1000) {
    this.tickMs = tickMs
  }

  /** Replace the current folder map. Idempotent — calling it with
   * the same content is a no-op. */
  setFolders(folders: ApiUpdateSchedulerFolder[]): void {
    this.folders.clear()
    for (const folder of folders) this.folders.set(folder.folderId, folder)
  }

  /** Begin the periodic tick. Safe to call multiple times. */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.tick()
    }, this.tickMs)
    // Kick off an immediate first sweep so a folder that was due at
    // app start surfaces a notification within seconds rather than
    // waiting a full tickMs.
    setImmediate(() => {
      void this.tick()
    })
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * Run one pass over the registered folders. Exposed so tests (and
   * the IPC `checkAll` handler) can trigger a sweep without waiting
   * for the timer.
   */
  async tick(now: number = Date.now()): Promise<void> {
    const due: ApiUpdateSchedulerFolder[] = []
    for (const folder of this.folders.values()) {
      if (isApiUpdateDue(folder.config, now)) due.push(folder)
    }
    if (due.length === 0) return
    await Promise.all(due.map((folder) => this.runOne(folder)))
  }

  /**
   * Force an immediate check for one folder, ignoring `interval` and
   * `autoCheckEnabled`. Used by the renderer's "Check now" button —
   * the user explicitly asked, so we don't gate on the schedule.
   */
  async checkNow(folderId: string): Promise<void> {
    const folder = this.folders.get(folderId)
    if (!folder) return
    await this.runOne(folder, true)
  }

  private async runOne(folder: ApiUpdateSchedulerFolder, manual = false): Promise<void> {
    try {
      await runApiUpdateCheck({
        folderId: folder.folderId,
        importSource: folder.importSource,
        config: folder.config,
        variables: folder.variables,
        manual
      })
    } catch (err) {
      logger.error(`[ApiUpdateScheduler] runOne crashed for ${folder.folderId}`, err)
    } finally {
      folder.onCheckCompleted({ lastCheckedAt: Date.now() })
    }
  }
}

export const apiUpdateScheduler = new ApiUpdateScheduler()
