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
import { getSettingsService, isSettingsServiceInitialized, logger } from 'electron-core-ui/main'

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

/**
 * Listeners registered before `SettingsService` exists, promoted by
 * {@link activateHistoryRetention}.
 *
 * This queue exists because of a hard ordering fact: the history stores are
 * constructed and `initialize()`d at module scope in `main/index.ts`, which
 * runs BEFORE `initializeApp()` stands up `SettingsService`. Subscribing
 * eagerly there binds nothing at all — and because `src/main/**` is outside
 * the typecheck gate and the stores mock an already-initialized settings
 * service in their unit tests, that failure is invisible to every automated
 * check. It only shows up as "changing the setting does nothing" in the
 * shipped app.
 */
const pendingListeners = new Set<HistoryLimitListener>()
/** Live subscriptions, so an unsubscribe works whichever path registered it. */
const activeUnsubscribers = new Map<HistoryLimitListener, () => void>()

function subscribeNow(listener: HistoryLimitListener): void {
  const unsubscribe = getSettingsService().onSettingChanged(HISTORY_MAX_ENTRIES_KEY, (value) => {
    listener(normalizeHistoryLimit(value))
  })
  activeUnsubscribers.set(listener, unsubscribe)
}

/**
 * Run `listener` whenever the cap changes, with the already-normalized value.
 * Returns an unsubscribe function.
 *
 * Safe to call before `SettingsService` exists: the listener is parked and
 * {@link activateHistoryRetention} promotes it.
 */
export function onHistoryLimitChanged(listener: HistoryLimitListener): () => void {
  if (isSettingsServiceInitialized()) {
    subscribeNow(listener)
  } else {
    pendingListeners.add(listener)
  }

  return () => {
    pendingListeners.delete(listener)
    const unsubscribe = activeUnsubscribers.get(listener)
    if (unsubscribe) {
      unsubscribe()
      activeUnsubscribers.delete(listener)
    }
  }
}

/**
 * Fire every subscribed listener with the cap currently in force.
 *
 * Call this whenever a project becomes the open one. The cap is not a global
 * fact: the history archive lives NEXT TO the open project file, so
 * `getHistoryArchivePath()` returns null while nothing is open and a prune
 * attempted then is a silent no-op. Applying the cap only at startup would
 * therefore enforce nothing in the normal case — the app opens with no
 * project — and an archive that arrives already over the cap (a project
 * shared by a teammate whose history is deeper than your setting) would stay
 * over it until the next write for each item.
 */
export function applyHistoryRetentionNow(): void {
  if (!isSettingsServiceInitialized()) return
  const limit = getHistoryLimit()
  for (const listener of activeUnsubscribers.keys()) {
    try {
      listener(limit)
    } catch (error) {
      logger.error('[historyRetention] Retention pass failed', { error: String(error) })
    }
  }
}

/**
 * Promote every parked listener to a real subscription.
 *
 * Call this from `main/index.ts` right after `initializeApp()`, which is the
 * first point at which `SettingsService` is guaranteed to exist. The stores
 * register at module scope, long before that, so without this call their
 * subscriptions would bind nothing — silently, since nothing throws and the
 * unit suites mock an already-initialized settings service.
 */
export function activateHistoryRetention(): void {
  if (!isSettingsServiceInitialized()) {
    logger.warn('[historyRetention] Activated before the settings service exists; retention listeners stay parked')
    return
  }

  const listeners = [...pendingListeners]
  pendingListeners.clear()
  for (const listener of listeners) subscribeNow(listener)

  // Covers the case where a project is somehow already open at activation.
  // The per-open pass is what carries the normal path.
  applyHistoryRetentionNow()
}
