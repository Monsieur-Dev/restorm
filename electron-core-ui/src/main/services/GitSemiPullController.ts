import { logger } from './LoggerService'
import type { GitService } from './GitService'
import type { SettingsService } from './SettingsService'

/** CRON frequency presets for the semi-pull check (Q11: 15m/30m/1h/4h/
 * 12h/24h/off, default 1h). `'off'` disables the timer entirely — the
 * folder watch and check-on-open triggers keep working regardless. */
export type GitSemiPullFrequency = 'off' | '15m' | '30m' | '1h' | '4h' | '12h' | '24h'

export interface GitSemiPullControllerOptions {
  /** Source of the live `git:semiPullFrequency` setting value. */
  readonly settings: SettingsService
  /** The service whose `checkForRemoteUpdate()` this controller schedules. */
  readonly gitService: GitService
}

// Storage key composed by SettingsService as `<groupPath>:<settingId>` —
// the setting itself is registered in the host app's own settings config
// (restorm: `resources/settings.yaml`'s `git` group), not ECUI's defaults,
// same as `AutoSaveController`'s `files:autoSave` lives in ECUI's — the
// controller only needs the key to exist somewhere in the merged tree.
const SETTING_FREQUENCY = 'git:semiPullFrequency'

const DEFAULT_FREQUENCY: GitSemiPullFrequency = '1h'

const FREQUENCY_MS: Record<GitSemiPullFrequency, number | null> = {
  off: null,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000
}

const VALID_FREQUENCIES: ReadonlySet<string> = new Set(Object.keys(FREQUENCY_MS))

/**
 * Drives the "CRON" half of the semi-pull feature (91.6): on a schedule
 * read from the `git:semiPullFrequency` setting, calls
 * `GitService.checkForRemoteUpdate()` — which itself no-ops unless the
 * active folder is a git repo (AC#3), so this controller can fire
 * unconditionally without tracking repo state of its own. Reacts to the
 * setting changing at runtime by clearing and rescheduling immediately
 * (unlike `AutoSaveController`'s delay setting, there is no "let the
 * current cycle finish" nuance here — a shorter/longer/off frequency
 * should take effect right away).
 *
 * Deliberately does NOT fire an immediate check on `start()`: that's
 * `checkForRemoteUpdate`'s check-on-open job (`GitService.setActiveFolder`)
 * — firing here too would double up the very first check on every app
 * launch. This controller only owns the periodic, unattended background
 * poll.
 */
export class GitSemiPullController {
  private readonly settings: SettingsService
  private readonly gitService: GitService

  private frequency: GitSemiPullFrequency = DEFAULT_FREQUENCY
  private timer: ReturnType<typeof setInterval> | null = null
  private unsubFrequency: (() => void) | null = null
  private started = false

  constructor(opts: GitSemiPullControllerOptions) {
    this.settings = opts.settings
    this.gitService = opts.gitService
  }

  /** Begin reacting to the frequency setting. Idempotent — calling twice
   * without `stop()` in between is a no-op. */
  start(): void {
    if (this.started) return
    this.started = true

    this.frequency = parseFrequency(this.settings.get(SETTING_FREQUENCY))
    this.unsubFrequency = this.settings.onSettingChanged(SETTING_FREQUENCY, (v) => {
      const next = parseFrequency(v)
      if (next === this.frequency) return
      this.frequency = next
      this.applyFrequency()
    })

    this.applyFrequency()
    logger.info('[GitSemiPullController] Started', { frequency: this.frequency })
  }

  /** Tear down the timer + setting subscription. Safe to call before `start()`. */
  stop(): void {
    if (!this.started) return
    this.started = false
    this.clearTimer()
    this.unsubFrequency?.()
    this.unsubFrequency = null
    logger.info('[GitSemiPullController] Stopped')
  }

  private applyFrequency(): void {
    this.clearTimer()
    const intervalMs = FREQUENCY_MS[this.frequency]
    if (intervalMs === null) return
    this.timer = setInterval(() => {
      void this.gitService.checkForRemoteUpdate()
    }, intervalMs)
    // `stop()` is what actually ends this poll; un-ref'ing is belt-and-braces
    // for the case where it is never called, so a background refresh can never
    // be the handle that keeps a would-be-exiting loop open.
    this.timer.unref()
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}

function parseFrequency(raw: unknown): GitSemiPullFrequency {
  if (typeof raw === 'string' && VALID_FREQUENCIES.has(raw)) {
    return raw as GitSemiPullFrequency
  }
  return DEFAULT_FREQUENCY
}

// ── Module-level singleton wiring ─────────────────────────────────────

let instance: GitSemiPullController | null = null

export function initGitSemiPullController(opts: GitSemiPullControllerOptions): GitSemiPullController {
  instance?.stop()
  instance = new GitSemiPullController(opts)
  instance.start()
  return instance
}

export function getGitSemiPullController(): GitSemiPullController | null {
  return instance
}

/** Test-only: reset the singleton between cases. */
export function __resetGitSemiPullControllerForTesting(): void {
  instance?.stop()
  instance = null
}
