import { BrowserWindow } from 'electron'
import { logger } from './LoggerService'
import type { FileService } from './FileService'
import type { SettingsService } from './SettingsService'

/**
 * Auto-save modes mirroring VSCode's `files.autoSave`:
 *
 * - `off`             — autosave disabled.
 * - `afterDelay`      — debounce on dirty transitions; save after
 *                       `autoSaveDelay` ms of inactivity.
 * - `onWindowChange`  — save when the active window loses focus,
 *                       provided anything is dirty.
 */
export type AutoSaveMode = 'off' | 'afterDelay' | 'onWindowChange'

export interface AutoSaveControllerOptions {
  /** Source of the live `autoSave` and `autoSaveDelay` setting values. */
  readonly settings: SettingsService
  /** Source of dirty-state transitions and snapshots. */
  readonly fileService: FileService
  /**
   * What to invoke when an autosave should fire. The controller does
   * not know how a host app actually persists — it only decides
   * *when* to save. Default wiring (in `initAutoSaveController`)
   * broadcasts `'file:autosave-trigger'` to every open window so the
   * renderer can run its existing "Save all" flow; tests inject a
   * direct spy.
   */
  readonly triggerSaveAll: () => void
  /**
   * Override the window enumeration. Defaults to
   * `BrowserWindow.getAllWindows()`; tests inject a stub. The list
   * is re-queried on every relevant transition so newly-opened
   * windows pick up the blur listener.
   */
  readonly getWindows?: () => BrowserWindow[]
}

// Storage keys are composed by SettingsService as `<groupPath>:<settingId>`.
// Both settings live under the `files` group in `defaults.yaml`, so the
// controller must subscribe and query through the namespaced key.
const SETTING_MODE = 'files:autoSave'
const SETTING_DELAY = 'files:autoSaveDelay'

const DEFAULT_MODE: AutoSaveMode = 'off'
const DEFAULT_DELAY_MS = 1000

const VALID_MODES: ReadonlySet<string> = new Set(['off', 'afterDelay', 'onWindowChange'])

/**
 * Reacts to `autoSave` and `autoSaveDelay` setting changes plus
 * `FileService` dirty events to fire the host-app save flow at the
 * right time. The controller is intentionally a thin coordinator —
 * it owns timers and listener bookkeeping, but never reads document
 * state directly.
 */
export class AutoSaveController {
  private readonly settings: SettingsService
  private readonly fileService: FileService
  private readonly triggerSaveAll: () => void
  private readonly getWindows: () => BrowserWindow[]

  private mode: AutoSaveMode = DEFAULT_MODE
  private delay: number = DEFAULT_DELAY_MS
  private isDirty = false
  private timer: ReturnType<typeof setTimeout> | null = null

  private unsubMode: (() => void) | null = null
  private unsubDelay: (() => void) | null = null
  private unsubDirty: (() => void) | null = null
  private unsubState: (() => void) | null = null
  private blurAttachments: { window: BrowserWindow; handler: () => void }[] = []
  private started = false

  constructor(opts: AutoSaveControllerOptions) {
    this.settings = opts.settings
    this.fileService = opts.fileService
    this.triggerSaveAll = opts.triggerSaveAll
    this.getWindows = opts.getWindows ?? (() => BrowserWindow.getAllWindows())
  }

  /**
   * Begin reacting to settings + dirty events. Idempotent — calling
   * twice without `stop()` in between is a no-op.
   */
  start(): void {
    if (this.started) return
    this.started = true

    this.mode = parseMode(this.settings.get(SETTING_MODE))
    this.delay = parseDelay(this.settings.get(SETTING_DELAY))
    this.isDirty = this.fileService.getSaveUnitsSnapshot().isDirty

    this.unsubMode = this.settings.onSettingChanged(SETTING_MODE, (v) => {
      const next = parseMode(v)
      if (next === this.mode) return
      const prev = this.mode
      this.mode = next
      this.handleModeTransition(prev, next)
    })
    this.unsubDelay = this.settings.onSettingChanged(SETTING_DELAY, (v) => {
      this.delay = parseDelay(v)
      // No need to reschedule mid-flight: the running timer fires at
      // the originally-scheduled tick, and the *next* dirty event
      // picks up the new delay. This matches the ticket's "applies
      // to the next timer cycle" rule.
    })
    this.unsubDirty = this.fileService.onDirtyChanged((dirty) => {
      logger.debug('[AutoSaveController] onDirtyChanged', { dirty, mode: this.mode })
      this.isDirty = dirty
      if (this.mode === 'afterDelay' && dirty) {
        this.armDelayTimer()
      } else if (!dirty) {
        // A clean transition (e.g. user-initiated save) makes any
        // pending timer a no-op; cancel it so we don't fire a
        // redundant save right after.
        this.clearDelayTimer()
      }
    })
    // `currentFile.isDirty` is edge-triggered by FileService — only
    // flips fire `onDirtyChanged`. After a close→open round-trip, the
    // controller's cached `isDirty` may have drifted from the registry's
    // snapshot (the close clears units; the open hydrates clean units;
    // neither emits an event). Resync from the snapshot whenever the
    // file path changes so the next user edit lands on a correct
    // baseline and arms the timer reliably.
    this.unsubState = this.fileService.onStateChanged((state) => {
      const path = state.currentFile.path
      const snap = this.fileService.getSaveUnitsSnapshot()
      logger.debug('[AutoSaveController] onStateChanged', { path, snapshotIsDirty: snap.isDirty, cachedIsDirty: this.isDirty })
      this.isDirty = snap.isDirty
      if (path === null) {
        // File closed — drop any pending timer. Detach blur listeners
        // is not needed (windows can stay open across files).
        this.clearDelayTimer()
        return
      }
      if (this.mode === 'afterDelay' && snap.isDirty) {
        this.armDelayTimer()
      }
    })

    this.applyMode()
    logger.info('[AutoSaveController] Started', { mode: this.mode, delayMs: this.delay, initialDirty: this.isDirty })
  }

  /**
   * Tear down listeners + timers. Safe to call before `start()`.
   */
  stop(): void {
    if (!this.started) return
    this.started = false
    this.clearDelayTimer()
    this.detachBlurListeners()
    this.unsubMode?.()
    this.unsubMode = null
    this.unsubDelay?.()
    this.unsubDelay = null
    this.unsubDirty?.()
    this.unsubDirty = null
    this.unsubState?.()
    this.unsubState = null
    logger.info('[AutoSaveController] Stopped')
  }

  // ── Mode wiring ────────────────────────────────────────────────────

  private applyMode(): void {
    this.clearDelayTimer()
    this.detachBlurListeners()
    if (this.mode === 'onWindowChange') {
      this.attachBlurListeners()
    }
    // `afterDelay` arms its timer lazily on the next dirty event;
    // priming it here would defeat the "no-op when nothing is dirty"
    // rule the ticket calls out.
  }

  private handleModeTransition(prev: AutoSaveMode, next: AutoSaveMode): void {
    if (prev === 'afterDelay') this.clearDelayTimer()
    if (prev === 'onWindowChange') this.detachBlurListeners()
    if (next === 'onWindowChange') this.attachBlurListeners()
    // Switching INTO afterDelay while a file is already open and
    // dirty must arm the timer right away — the user just enabled
    // autosave and expects unsaved work to be picked up without
    // having to type one more character to produce a fresh dirty
    // event. Skip if no file is open (the standard guard) or if
    // nothing is currently dirty (no-op anyway).
    if (next === 'afterDelay' && this.isDirty && this.fileService.getFilePath() !== null) {
      this.armDelayTimer()
    }
    logger.debug('[AutoSaveController] Mode transition', { prev, next, dirty: this.isDirty })
  }

  // ── Timer / blur handlers ─────────────────────────────────────────

  private armDelayTimer(): void {
    this.clearDelayTimer()
    logger.debug('[AutoSaveController] armDelayTimer', { delayMs: this.delay })
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.mode !== 'afterDelay') return
      if (!this.isDirty) return
      this.fire('afterDelay')
    }, Math.max(0, this.delay))
  }

  private clearDelayTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private attachBlurListeners(): void {
    this.detachBlurListeners()
    for (const window of this.getWindows()) {
      if (window.isDestroyed()) continue
      const handler = (): void => {
        if (this.mode !== 'onWindowChange') return
        if (!this.isDirty) return
        this.fire('onWindowChange')
      }
      window.on('blur', handler)
      this.blurAttachments.push({ window, handler })
    }
  }

  private detachBlurListeners(): void {
    for (const { window, handler } of this.blurAttachments) {
      if (!window.isDestroyed()) {
        window.removeListener('blur', handler)
      }
    }
    this.blurAttachments = []
  }

  private fire(reason: AutoSaveMode): void {
    // No file open → nothing to save. This guards against a window
    // closing under us before the timer fires, or a fresh app session
    // where the user hasn't opened anything yet — in either case the
    // host's "Save all" path has nothing to persist and the trigger
    // would be a wasted IPC round-trip.
    if (this.fileService.getFilePath() === null) {
      logger.debug('[AutoSaveController] Skipped — no file open', { reason })
      return
    }
    try {
      this.triggerSaveAll()
      logger.debug('[AutoSaveController] Save triggered', { reason })
    } catch (error) {
      logger.error('[AutoSaveController] Save trigger threw', { reason, error: String(error) })
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function parseMode(raw: unknown): AutoSaveMode {
  if (typeof raw === 'string' && VALID_MODES.has(raw)) {
    return raw as AutoSaveMode
  }
  return DEFAULT_MODE
}

function parseDelay(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_DELAY_MS
  return Math.max(0, Math.floor(n))
}

// ── Module-level singleton wiring ─────────────────────────────────────

let instance: AutoSaveController | null = null

/**
 * Wire the default `AutoSaveController`: settings + file service from
 * the singletons, save trigger broadcasts `'file:autosave-trigger'`
 * to every open window so the renderer's existing save-all flow runs.
 *
 * Hosting apps that need a different trigger can pass a custom
 * `AutoSaveControllerOptions.triggerSaveAll` and construct the
 * controller directly instead of calling this helper.
 */
export function initAutoSaveController(opts: {
  settings: SettingsService
  fileService: FileService
}): AutoSaveController {
  instance?.stop()
  instance = new AutoSaveController({
    settings: opts.settings,
    fileService: opts.fileService,
    triggerSaveAll: () => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send('file:autosave-trigger')
        }
      }
    }
  })
  instance.start()
  return instance
}

export function getAutoSaveController(): AutoSaveController | null {
  return instance
}

/** Test-only: reset the singleton between cases. */
export function __resetAutoSaveControllerForTesting(): void {
  instance?.stop()
  instance = null
}
