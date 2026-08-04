/**
 * RequestUsageService — counts how many times each request has been
 * sent and remembers the last few send timestamps. Powers the
 * EmptyBench's "Top played" / "Recently played" sections per ApiCard
 * and the cross-API RecentActivityCard.
 *
 * The data lives at the **user** level (ECUI `StorageService` →
 * `userData/config.json`), not in the `.restorm` collection file:
 * usage is the user's history of how they drive the app, not part of
 * the API description they share with teammates.
 *
 * Keying is global by `requestId` (UUIDs are unique across projects).
 * The renderer filters the returned map against the open project's
 * `rootItems` to scope per-API. Renames/moves of env folders +
 * requests need no work here — the renderer re-reads `rootItems` and
 * the `requestId` keys are stable across rename. Deletions invalidate
 * here via the `REQUEST_DELETED` document event.
 */
import { BrowserWindow } from 'electron'
import {
  eventBusService,
  logger,
  getStorageService,
  type Subscription
} from 'electron-core-ui/main'
import { DocumentEvents, type DocumentDeletedPayload } from './DocumentEvents'

const STORAGE_KEY = 'request_usage'
/** The EmptyBench's "recently played" depth is deliberately FIXED, not tied to
 *  the `history:maxEntries` setting: that setting governs the histories a user
 *  reads and prunes (a request's recorded calls, a scenario's runs), whereas
 *  this list only feeds the home screen's recent-activity cards, where a
 *  longer tail would not change what the cards show. */
const HISTORY_LIMIT = 10
const SAVE_DEBOUNCE_MS = 500
const CHANGE_EVENT = 'request-usage:changed'

/** Per-request usage record. */
export interface RequestUsageEntry {
  /** Total successful + failed sends for this request. */
  count: number
  /** ISO timestamp of the last send. */
  lastSentAt: string
  /** Last 10 send timestamps (newest first). */
  history: string[]
}

export type RequestUsageMap = Record<string, RequestUsageEntry>

function isUsageMap(value: unknown): value is RequestUsageMap {
  if (!value || typeof value !== 'object') return false
  for (const v of Object.values(value)) {
    if (!v || typeof v !== 'object') return false
    const entry = v as Partial<RequestUsageEntry>
    if (typeof entry.count !== 'number') return false
    if (typeof entry.lastSentAt !== 'string') return false
    if (!Array.isArray(entry.history)) return false
  }
  return true
}

class RequestUsageService {
  private data: RequestUsageMap = {}
  private subscriptions: Subscription[] = []
  private saveTimer: NodeJS.Timeout | null = null
  private initialized = false

  initialize(): void {
    if (this.initialized) return
    this.initialized = true

    const stored = getStorageService().get(STORAGE_KEY)
    this.data = isUsageMap(stored) ? stored : {}

    this.subscriptions = [
      eventBusService.subscribe<DocumentDeletedPayload>(DocumentEvents.REQUEST_DELETED, (payload) => {
        this.handleRequestDeleted(payload.id)
      })
    ]
  }

  dispose(): void {
    for (const sub of this.subscriptions) sub.unsubscribe()
    this.subscriptions = []
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      this.flush()
    }
    this.initialized = false
  }

  /** Record a single send. Called from each protocol's execute IPC
   *  handler after the result is returned. Outcome is intentionally
   *  not differentiated — "most played" means "most attempted". */
  recordSend(requestId: string): void {
    if (!requestId) return
    const now = new Date().toISOString()
    const existing = this.data[requestId]
    const nextHistory = [now, ...(existing?.history ?? [])].slice(0, HISTORY_LIMIT)
    this.data[requestId] = {
      count: (existing?.count ?? 0) + 1,
      lastSentAt: now,
      history: nextHistory
    }
    this.scheduleSave()
    this.broadcast()
  }

  /** Current snapshot of the full map. Returns a shallow clone so the
   *  caller can't mutate the service's internal state by accident. */
  getAll(): RequestUsageMap {
    return { ...this.data }
  }

  private handleRequestDeleted(requestId: string): void {
    if (!(requestId in this.data)) return
    const { [requestId]: _removed, ...rest } = this.data
    void _removed
    this.data = rest
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
      logger.error('[RequestUsageService] Failed to persist usage map', { error: String(error) })
    }
  }

  private broadcast(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(CHANGE_EVENT, this.data)
    }
  }
}

export const requestUsageService = new RequestUsageService()
