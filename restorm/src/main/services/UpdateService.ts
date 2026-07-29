/**
 * UpdateService — silent background auto-update for the packaged app.
 *
 * Wraps electron-updater's `autoUpdater` behind a small injectable engine so the
 * state machine is unit-testable (fake engine) and dev-mockable (a scripted
 * engine wired via an env flag, for e2e) without a real release feed.
 *
 * State machine: idle → checking → (idle | available) → downloading → downloaded,
 * plus a terminal-ish `error`. Downloads are automatic (`autoDownload`) but the
 * install is NEVER applied on quit (`autoInstallOnAppQuit` stays off): the
 * renderer's "Restart now" button is the only way in. Checks fire at launch, every 4 h, and on a
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
import {
  logger,
  getSettingsService,
  getStorageService,
  withFirewallBypass
} from 'electron-core-ui/main'
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
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
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

    // Stay inert when this build doesn't self-manage updates: a store /
    // package-manager build (the store owns updates), or a dev build without the
    // mock (no feed → electron-updater would throw). The manual "Check for
    // updates" entry is hidden in those builds (autoUpdateSupported=false).
    if (!this.#isAutoUpdateSupported()) {
      logger.info('UpdateService: auto-update not managed by this build — inert')
      return
    }

    try {
      const engine = this.#getEngine()
      engine.autoDownload = true
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
      currentVersion: app.getVersion(),
      autoUpdateSupported: this.#isAutoUpdateSupported()
    }
  }

  /**
   * True when THIS build self-manages updates via electron-updater — a
   * direct-download build (packaged, not from a store). A store /
   * package-manager build sets `RESTORM_STORE_BUILD` so the in-app updater goes
   * inert and the "Check for updates" menu entry hides (the store owns updates).
   * A dev build with the mock engine counts as supported (for QA of the flow).
   */
  #isAutoUpdateSupported(): boolean {
    if (process.env.RESTORM_STORE_BUILD) return false
    return app.isPackaged || Boolean(process.env.RESTORM_UPDATE_MOCK)
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
      // The updater's requests to the feed are a background system operation the
      // user's firewall would otherwise block/prompt on. `withFirewallBypass`
      // (AsyncLocalStorage) exempts every socket connect made within this scope
      // — including the auto-download electron-updater kicks off SYNCHRONOUSLY
      // inside checkForUpdates when `autoDownload` is on, so it inherits the
      // bypass too. Same mechanism the cloud backend fetch uses for its own
      // external host.
      await withFirewallBypass(() => engine.checkForUpdates())
    } catch (err) {
      this.#onError(err, trigger)
    }
  }

  quitAndInstall(): void {
    try {
      // The button this comes from says "restart now", so the app has to come
      // BACK. With `isSilent: false` electron-updater resolves the force-run
      // flag from its own `autoRunAppAfterInstall` (default `true`) and
      // discards the one passed here — so the relaunch already holds. The
      // explicit `isForceRunAfter` is belt-and-braces: it is the operative
      // argument only on the silent path (the install-on-quit route, which we
      // never take).
      this.#getEngine().quitAndInstall(false, true)
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
   * including the current version — the body of the post-update "What's new".
   * `locale` selects the localized changelog (falls back to English). */
  getChangelogSince(fromVersion: string, locale?: string): string {
    const md = this.#readChangelog(locale)
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
    if (!this.#engine) {
      this.#engine = this.#engineFactory()
      // An update NEVER installs itself on quit. electron-updater's quit-time
      // installer runs from the `quit` handler — after every window is already
      // gone — and on some platforms it is a BLOCKING child process behind a
      // graphical privilege prompt. A prompt with no window to belong to, on a
      // main thread that can no longer process anything, is how the app ends up
      // as a process the user can neither see nor stop. An update is applied
      // only when the user asks for it, with the app still on screen.
      //
      // macOS caveat for whoever enables signing/notarization: there this flag
      // ALSO gates whether Squirrel ever stages the payload (`MacUpdater` only
      // calls the native `checkForUpdates()` when it is on), so with it off the
      // staging happens at button-press time and the user waits through it.
      //
      // Set HERE, not at the call site: an engine acquired outside `initialize`
      // (a manual check on a build where init bailed out early) would otherwise
      // carry electron-updater's default and register that handler behind our
      // back.
      this.#engine.autoInstallOnAppQuit = false
    }
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
        // Retry download under the same firewall bypass as the initial fetch.
        void withFirewallBypass(() => this.#getEngine().downloadUpdate()).catch(
          (e: unknown) => {
            this.#onDownloadOrEngineError(e)
          }
        )
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

  #readChangelog(locale?: string): string | null {
    // Localized "What's new": prefer changelogs/<locale>.md (exact, then the base
    // language), and fall back to the English CHANGELOG.md. English (or an unknown
    // locale) reads CHANGELOG.md directly — no changelogs/en.md duplication.
    const localeCandidates: string[] = []
    const norm = (locale ?? '').trim()
    if (norm && norm.toLowerCase() !== 'en') {
      const base = norm.split('-')[0]
      const names = base && base !== norm ? [norm, base] : [norm]
      for (const name of names) {
        localeCandidates.push(
          join(process.resourcesPath, 'restorm-resources', 'changelogs', `${name}.md`),
          join(app.getAppPath(), 'changelogs', `${name}.md`),
          join(process.cwd(), 'changelogs', `${name}.md`)
        )
      }
    }
    const englishCandidates = [
      join(process.resourcesPath, 'restorm-resources', 'CHANGELOG.md'),
      join(app.getAppPath(), 'CHANGELOG.md'),
      join(process.cwd(), 'CHANGELOG.md')
    ]
    for (const p of [...localeCandidates, ...englishCandidates]) {
      try {
        if (existsSync(p)) return readFileSync(p, 'utf8')
      } catch {
        // try next
      }
    }
    logger.warn('UpdateService: CHANGELOG.md not found', { locale, englishCandidates })
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
