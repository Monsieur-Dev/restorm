/**
 * The single source of truth for "how many entries do we keep?" across the
 * three per-item histories the app maintains:
 *
 * - a request's recorded calls (`ResponseHistoryService` — the response
 *   archive on disk),
 * - a request's send timestamps (`RequestUsageService`),
 * - a scenario's run timestamps (`ScenarioUsageService`).
 *
 * Those are three distinct stores, but they answer the same user-facing
 * question, so they share one setting (`history:maxEntries`, declared in
 * `resources/settings.yaml`) rather than three controls nobody would set
 * differently.
 *
 * The value is read on every use rather than cached at module load: a change
 * has to take effect on an already-running app, and reading through
 * `SettingsService` is what makes that free. `onHistoryLimitChanged` exists
 * for the stores that additionally need to shrink what they ALREADY hold when
 * the user lowers the cap — capping the next write is not enough there.
 */
import { getSettingsService, isSettingsServiceInitialized } from 'electron-core-ui/main'

/** Storage key (`<groupId>:<settingId>`) — see the `history` group in
 *  `resources/settings.yaml`. */
export const HISTORY_MAX_ENTRIES_KEY = 'history:maxEntries'

/** Mirrors the `default` declared in the YAML. Used when the settings service
 *  isn't up yet (very early boot) or the stored value is unusable. */
export const DEFAULT_HISTORY_MAX_ENTRIES = 10

/** Mirrors `params.min` / `params.max` in the YAML. The GUI already clamps,
 *  but a hand-edited settings file or an MCP write can still land out of
 *  range, and an out-of-range cap here would silently truncate or bloat a
 *  user's history. */
const MIN_HISTORY_MAX_ENTRIES = 1
const MAX_HISTORY_MAX_ENTRIES = 1000

function clamp(value: number): number {
  if (value < MIN_HISTORY_MAX_ENTRIES) return MIN_HISTORY_MAX_ENTRIES
  if (value > MAX_HISTORY_MAX_ENTRIES) return MAX_HISTORY_MAX_ENTRIES
  return Math.floor(value)
}

/**
 * Coerce whatever the settings store hands back into a usable cap. The store
 * is typed loosely (`SettingValue`) and a number setting can come back as a
 * string when it round-trips through a hand-edited JSON file, so parse
 * defensively and fall back to the declared default rather than letting a
 * `NaN` cap collapse every history to zero entries.
 */
export function normalizeHistoryLimit(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return clamp(raw)
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) return clamp(parsed)
  }
  return DEFAULT_HISTORY_MAX_ENTRIES
}

/** How many entries each history keeps, right now. */
export function getHistoryLimit(): number {
  if (!isSettingsServiceInitialized()) return DEFAULT_HISTORY_MAX_ENTRIES
  return normalizeHistoryLimit(getSettingsService().get(HISTORY_MAX_ENTRIES_KEY))
}

type HistoryLimitListener = (limit: number) => void

/** Listeners that asked to subscribe before `SettingsService` existed. */
const pendingListeners = new Set<HistoryLimitListener>()
/** Live subscriptions, so an unsubscribe works whichever path registered it. */
const activeUnsubscribers = new Map<HistoryLimitListener, () => void>()
let readyPollTimer: NodeJS.Timeout | null = null

/** How often to re-check whether `SettingsService` has come up. */
const SETTINGS_READY_POLL_MS = 200

function subscribeNow(listener: HistoryLimitListener): void {
  const unsubscribe = getSettingsService().onSettingChanged(HISTORY_MAX_ENTRIES_KEY, (value) => {
    listener(normalizeHistoryLimit(value))
  })
  activeUnsubscribers.set(listener, unsubscribe)
}

/** Promote every deferred listener to a real subscription. */
function flushPending(): boolean {
  if (!isSettingsServiceInitialized()) return false
  for (const listener of [...pendingListeners]) {
    pendingListeners.delete(listener)
    subscribeNow(listener)
  }
  return true
}

function stopPolling(): void {
  if (!readyPollTimer) return
  clearInterval(readyPollTimer)
  readyPollTimer = null
}

function schedulePendingFlush(): void {
  if (readyPollTimer) return
  readyPollTimer = setInterval(() => {
    if (pendingListeners.size === 0 || flushPending()) stopPolling()
  }, SETTINGS_READY_POLL_MS)
  // Never keep the process alive just to wait for the settings service.
  readyPollTimer.unref()
}

/**
 * Run `listener` whenever the cap changes, with the already-normalized value.
 * Returns an unsubscribe function.
 *
 * The deferral matters: the history stores are constructed and `initialize()`d
 * at module scope in `main/index.ts`, which runs BEFORE `initializeApp()`
 * stands up `SettingsService`. Subscribing eagerly there would silently bind
 * nothing, and the "changing the setting re-prunes what is already stored"
 * behaviour would be dead in the shipped app while every unit test — which
 * mocks an already-initialized settings service — stayed green. So a listener
 * registered too early is parked and promoted as soon as the service appears,
 * rather than dropped.
 */
export function onHistoryLimitChanged(listener: HistoryLimitListener): () => void {
  if (isSettingsServiceInitialized()) {
    subscribeNow(listener)
  } else {
    pendingListeners.add(listener)
    schedulePendingFlush()
  }

  return () => {
    pendingListeners.delete(listener)
    const unsubscribe = activeUnsubscribers.get(listener)
    if (unsubscribe) {
      unsubscribe()
      activeUnsubscribers.delete(listener)
    }
    if (pendingListeners.size === 0) stopPolling()
  }
}
