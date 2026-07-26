/**
 * UpdateService — silent background auto-update for the packaged app.
 *
 * Wraps electron-updater's `autoUpdater` behind a small injectable engine so the
 * state machine is unit-testable (fake engine) and dev-mockable (a scripted
 * engine wired via an env flag, for e2e) without a real release feed.
 *
 * State machine: idle → checking → (idle | available) → downloading → downloaded,
 * plus a terminal-ish `error`. Downloads are automatic (`autoDownload`) and the
 * install is applied on the next app quit (`autoInstallOnAppQuit`); the renderer
 * offers a "Restart now" shortcut. Checks fire at launch, every 4 h, and on a
 * manual button — all sharing this one machine. Auto-check errors are silent;
 * manual-check errors surface. Download errors retry 3× with exponential backoff
 * then go quiet until the next check.
 *
 * Persistence: `autoCheckEnabled` via ECUI SettingsService; `lastSeenVersion`
 * (drives the post-update "What's new") via ECUI StorageService.
 *
 * The updater only runs in a PACKAGED build fed by the generic feed
 * (dl.restorm.app). In dev it is inert unless the dev-mock engine is enabled.
 * macOS install requires notarization (a separate signing concern); the code
 * here is platform-agnostic and simply relies on the engine.
 */
import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger, getSettingsService, getStorageService } from 'electron-core-ui/main'
import { parseChangelogSince } from './changelog'
import { createMockUpdaterEngine } from './mockUpdaterEngine'
import {
  UPDATE_IPC,
  type UpdateSettings,
  type UpdateState,
  type UpdateTrigger
} from '../../shared/update/updateTypes'

/** Persisted keys. `updates:autoCheckEnabled` is the storage key the declarative
 * Settings toggle (group `updates`, id `autoCheckEnabled`) resolves to, so the
 * toggle and this service read/write the SAME value. */
const AUTO_CHECK_SETTING_KEY = 'updates:autoCheckEnabled'
const LAST_SEEN_VERSION_KEY = 'updates:lastSeenVersion'

/** Background re-check cadence. */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 h
/** Download retry policy. */
const MAX_DOWNLOAD_RETRIES = 3
const RETRY_BASE_DELAY_MS = 5_000

/** The slice of electron-updater's `autoUpdater` this service depends on.
 * Kept minimal so tests + the dev mock can substitute a fake. */
export interface UpdaterEngine {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
  on(event: string, listener: (...args: unknown[]) => void): void
}

interface UpdateInfoLike {
  version?: unknown
}
interface ProgressLike {
  percent?: unknown
}

/** electron-updater's `autoUpdater`, narrowed to the engine slice we use. Unit
 * tests inject a fake via `engineFactory`, so the real one is only touched in a
 * packaged build (or when the dev mock is enabled). */
function defaultEngine(): UpdaterEngine {
  if (process.env.RESTORM_UPDATE_MOCK) {
    return createMockUpdaterEngine(process.env.RESTORM_UPDATE_MOCK)
  }
  return autoUpdater as unknown as UpdaterEngine
}

export class UpdateService {
  #engine: UpdaterEngine | null = null
  #engineFactory: () => UpdaterEngine
  #now: () => number
  #timer: NodeJS.Timeout | null = null
  #downloadRetries = 0
  #started = false
  #unsubSetting: (() => void) | null = null

  #state: UpdateState = {
    phase: 'idle',
    version: null,
    currentVersion: '0.0.0',
    percent: null,
    lastCheckedAt: null,
    error: null,
    trigger: null
  }

  constructor(opts: { engineFactory?: () => UpdaterEngine; now?: () => number } = {}) {
    this.#engineFactory = opts.engineFactory ?? defaultEngine
    this.#now = opts.now ?? Date.now
  }

  /** Wire the engine + listeners, seed `lastSeenVersion` on a fresh install,
   * then (if enabled) do an immediate check and start the periodic timer.
   * Safe to call once; subsequent calls are ignored. */
  initialize(): void {
    if (this.#started) return
    this.#started = true
    this.#state.currentVersion = app.getVersion()

    // Fresh install: seed lastSeenVersion silently so we never show "What's new"
    // for a version the user never ran a previous build of.
    if (this.#readLastSeenVersion() === null) {
      this.#writeLastSeenVersion(this.#state.currentVersion)
    }

    // In dev without a mock engine, electron-updater has no feed and throws —
    // stay inert (the manual button + settings still work, checks are no-ops).
    if (!app.isPackaged && !process.env.RESTORM_UPDATE_MOCK) {
      logger.info('UpdateService: dev build without mock — auto-update inert')
      return
    }

    try {
      const engine = this.#getEngine()
      engine.autoDownload = true
      engine.autoInstallOnAppQuit = true
      this.#attachListeners(engine)
    } catch (err) {
      logger.warn('UpdateService: engine init failed', {
        message: err instanceof Error ? err.message : String(err)
      })
      return
    }

    // React to the auto-check toggle changing from ANYWHERE (the declarative
    // Settings toggle writes the same key directly, not through this service).
    this.#unsubSetting = getSettingsService().onSettingChanged(
      AUTO_CHECK_SETTING_KEY,
      () => {
        this.#syncTimerToSetting()
      }
    )

    if (this.getSettings().autoCheckEnabled) {
      void this.checkForUpdates('auto')
      this.#startTimer()
    }
  }

  /** Start/stop the periodic timer to match the persisted auto-check flag. */
  #syncTimerToSetting(): void {
    if (this.#readAutoCheckEnabled()) this.#startTimer()
    else this.#stopTimer()
  }

  getState(): UpdateState {
    return { ...this.#state }
  }

  getSettings(): UpdateSettings {
    return {
      autoCheckEnabled: this.#readAutoCheckEnabled(),
      currentVersion: app.getVersion()
    }
  }

  /** Run a check. `manual` errors surface to the user; `auto` errors stay silent. */
  async checkForUpdates(trigger: UpdateTrigger): Promise<void> {
    if (this.#state.phase === 'checking' || this.#state.phase === 'downloading') {
      return // a check/download is already in flight
    }
    let engine: UpdaterEngine
    try {
      engine = this.#getEngine()
    } catch {
      return // no engine (inert dev build) — nothing to do
    }
    this.#downloadRetries = 0
    this.#setState({ phase: 'checking', trigger, error: null })
    try {
      await engine.checkForUpdates()
    } catch (err) {
      this.#onError(err, trigger)
    }
  }

  quitAndInstall(): void {
    try {
      this.#getEngine().quitAndInstall()
    } catch (err) {
      logger.warn('UpdateService: quitAndInstall failed', {
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  /** Toggle the periodic auto-check. The manual button keeps working either way.
   * The `onSettingChanged` listener wired in `initialize` starts/stops the timer,
   * so this also covers the toggle being flipped from the Settings UI. */
  setAutoCheckEnabled(enabled: boolean): void {
    getSettingsService().set(AUTO_CHECK_SETTING_KEY, enabled)
    // In case the service was never initialized (no listener), sync directly.
    this.#syncTimerToSetting()
  }

  /** Markdown span of CHANGELOG entries strictly after `fromVersion` up to and
   * including the current version — the body of the post-update "What's new". */
  getChangelogSince(fromVersion: string): string {
    const md = this.#readChangelog()
    if (!md) return ''
    return parseChangelogSince(md, fromVersion, app.getVersion())
  }

  /** The last version we showed "What's new" for (or seeded at install). */
  getLastSeenVersion(): string | null {
    return this.#readLastSeenVersion()
  }

  /** Record that the current version's "What's new" has been shown. */
  markVersionSeen(version: string): void {
    this.#writeLastSeenVersion(version)
  }

  /** Stop the timer + drop listeners (called at quit). */
  dispose(): void {
    this.#stopTimer()
    this.#unsubSetting?.()
    this.#unsubSetting = null
  }

  // ---- internals ----------------------------------------------------------

  #getEngine(): UpdaterEngine {
    if (!this.#engine) this.#engine = this.#engineFactory()
    return this.#engine
  }

  #attachListeners(engine: UpdaterEngine): void {
    engine.on('checking-for-update', () => {
      this.#setState({ phase: 'checking', error: null })
    })
    engine.on('update-available', (info: unknown) => {
      const version = versionOf(info)
      this.#setState({
        phase: 'available',
        version,
        lastCheckedAt: this.#iso()
      })
      // autoDownload=true means electron-updater starts the download itself; we
      // reflect the transition and let 'download-progress' drive the percent.
    })
    engine.on('update-not-available', () => {
      this.#setState({
        phase: 'idle',
        version: null,
        percent: null,
        lastCheckedAt: this.#iso()
      })
    })
    engine.on('download-progress', (progress: unknown) => {
      this.#setState({ phase: 'downloading', percent: percentOf(progress) })
    })
    engine.on('update-downloaded', (info: unknown) => {
      this.#downloadRetries = 0
      this.#setState({
        phase: 'downloaded',
        version: versionOf(info) ?? this.#state.version,
        percent: 100
      })
    })
    engine.on('error', (err: unknown) => {
      this.#onDownloadOrEngineError(err)
    })
  }

  #onDownloadOrEngineError(err: unknown): void {
    // While downloading, retry with exponential backoff before giving up.
    if (this.#state.phase === 'downloading' && this.#downloadRetries < MAX_DOWNLOAD_RETRIES) {
      const attempt = this.#downloadRetries + 1
      this.#downloadRetries = attempt
      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
      logger.warn('UpdateService: download error — retrying', {
        attempt,
        delay,
        message: err instanceof Error ? err.message : String(err)
      })
      setTimeout(() => {
        void this.#getEngine()
          .downloadUpdate()
          .catch((e: unknown) => {
            this.#onDownloadOrEngineError(e)
          })
      }, delay)
      return
    }
    this.#onError(err, this.#state.trigger ?? 'auto')
  }

  #onError(err: unknown, trigger: UpdateTrigger): void {
    const message = err instanceof Error ? err.message : String(err)
    // Auto errors are silent (stay idle); manual errors surface as `error`.
    if (trigger === 'manual') {
      this.#setState({ phase: 'error', error: { trigger, message } })
    } else {
      logger.warn('UpdateService: auto check/download failed (silent)', { message })
      this.#setState({ phase: 'idle', error: null })
    }
  }

  #startTimer(): void {
    if (this.#timer) return
    this.#timer = setInterval(() => {
      void this.checkForUpdates('auto')
    }, CHECK_INTERVAL_MS)
    // Do not keep the event loop alive solely for the update timer.
    this.#timer.unref()
  }

  #stopTimer(): void {
    if (this.#timer) {
      clearInterval(this.#timer)
      this.#timer = null
    }
  }

  #setState(patch: Partial<UpdateState>): void {
    this.#state = { ...this.#state, ...patch }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(UPDATE_IPC.STATE_CHANGED, this.getState())
    }
  }

  #iso(): string {
    return new Date(this.#now()).toISOString()
  }

  #readAutoCheckEnabled(): boolean {
    // Default ON: only an explicit stored `false` disables auto-check.
    const v = getSettingsService().get(AUTO_CHECK_SETTING_KEY) as unknown
    return typeof v === 'boolean' ? v : true
  }

  #readLastSeenVersion(): string | null {
    const v = getStorageService().get(LAST_SEEN_VERSION_KEY)
    return typeof v === 'string' ? v : null
  }

  #writeLastSeenVersion(version: string): void {
    getStorageService().set(LAST_SEEN_VERSION_KEY, version)
  }

  #readChangelog(): string | null {
    // Packaged: bundled under resources; dev: repo-root CHANGELOG.md.
    const candidates = [
      join(process.resourcesPath, 'restorm-resources', 'CHANGELOG.md'),
      join(app.getAppPath(), 'CHANGELOG.md'),
      join(process.cwd(), 'CHANGELOG.md')
    ]
    for (const p of candidates) {
      try {
        if (existsSync(p)) return readFileSync(p, 'utf8')
      } catch {
        // try next
      }
    }
    logger.warn('UpdateService: CHANGELOG.md not found', { candidates })
    return null
  }
}

function versionOf(info: unknown): string | null {
  const v = (info as UpdateInfoLike | null)?.version
  return typeof v === 'string' ? v : null
}
function percentOf(progress: unknown): number | null {
  const p = (progress as ProgressLike | null)?.percent
  return typeof p === 'number' ? Math.round(p) : null
}

export const updateService = new UpdateService()
