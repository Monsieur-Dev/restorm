import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Stub LoggerService so the controller imports without dragging in an
// Electron `app` reference (same rationale as AutoSaveController.test.ts).
vi.mock('./LoggerService', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import {
  GitSemiPullController,
  __resetGitSemiPullControllerForTesting,
  initGitSemiPullController,
  getGitSemiPullController
} from './GitSemiPullController'
import type { GitService } from './GitService'
import type { SettingsService, SettingChangedListener } from './SettingsService'

// ── Fakes ────────────────────────────────────────────────────────────

interface FakeSettings {
  service: SettingsService
  set: (key: string, value: unknown) => void
}

function makeFakeSettings(initial: Record<string, unknown>): FakeSettings {
  const values = new Map<string, unknown>(Object.entries(initial))
  const listeners = new Map<string, Set<SettingChangedListener>>()

  const service: Partial<SettingsService> = {
    get: ((key: string) => values.get(key)) as SettingsService['get'],
    onSettingChanged: ((key: string, cb: SettingChangedListener) => {
      let bucket = listeners.get(key)
      if (!bucket) {
        bucket = new Set()
        listeners.set(key, bucket)
      }
      bucket.add(cb)
      return () => {
        bucket.delete(cb)
      }
    }) as SettingsService['onSettingChanged']
  }

  return {
    service: service as SettingsService,
    set: (key, value) => {
      values.set(key, value)
      listeners.get(key)?.forEach((cb) => {
        cb(value as never)
      })
    }
  }
}

function makeFakeGitService(): { service: GitService; checkForRemoteUpdate: ReturnType<typeof vi.fn> } {
  const checkForRemoteUpdate = vi.fn().mockResolvedValue(undefined)
  const service: Partial<GitService> = {
    checkForRemoteUpdate: checkForRemoteUpdate as GitService['checkForRemoteUpdate']
  }
  return { service: service as GitService, checkForRemoteUpdate }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('GitSemiPullController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults to 1h when the setting is unset', () => {
    const settings = makeFakeSettings({})
    const git = makeFakeGitService()
    const c = new GitSemiPullController({ settings: settings.service, gitService: git.service })
    c.start()

    vi.advanceTimersByTime(60 * 60 * 1000 - 1)
    expect(git.checkForRemoteUpdate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(git.checkForRemoteUpdate).toHaveBeenCalledTimes(1)
  })

  it('fires checkForRemoteUpdate on every tick at the configured interval', () => {
    const settings = makeFakeSettings({ 'git:semiPullFrequency': '15m' })
    const git = makeFakeGitService()
    const c = new GitSemiPullController({ settings: settings.service, gitService: git.service })
    c.start()

    vi.advanceTimersByTime(15 * 60 * 1000)
    expect(git.checkForRemoteUpdate).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(15 * 60 * 1000)
    expect(git.checkForRemoteUpdate).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(15 * 60 * 1000)
    expect(git.checkForRemoteUpdate).toHaveBeenCalledTimes(3)
  })

  it('does not fire an immediate check on start — only check-on-open (GitService) does that', () => {
    const settings = makeFakeSettings({ 'git:semiPullFrequency': '15m' })
    const git = makeFakeGitService()
    const c = new GitSemiPullController({ settings: settings.service, gitService: git.service })
    c.start()

    expect(git.checkForRemoteUpdate).not.toHaveBeenCalled()
  })

  it('"off" disables the timer entirely', () => {
    const settings = makeFakeSettings({ 'git:semiPullFrequency': 'off' })
    const git = makeFakeGitService()
    const c = new GitSemiPullController({ settings: settings.service, gitService: git.service })
    c.start()

    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(git.checkForRemoteUpdate).not.toHaveBeenCalled()
  })

  it('falls back to the default (1h) on an invalid/unrecognized stored value', () => {
    const settings = makeFakeSettings({ 'git:semiPullFrequency': 'every-tuesday' })
    const git = makeFakeGitService()
    const c = new GitSemiPullController({ settings: settings.service, gitService: git.service })
    c.start()

    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(git.checkForRemoteUpdate).toHaveBeenCalledTimes(1)
  })

  it('reschedules immediately when the setting changes mid-run (shorter interval)', () => {
    const settings = makeFakeSettings({ 'git:semiPullFrequency': '1h' })
    const git = makeFakeGitService()
    const c = new GitSemiPullController({ settings: settings.service, gitService: git.service })
    c.start()

    settings.set('git:semiPullFrequency', '15m')
    vi.advanceTimersByTime(15 * 60 * 1000)
    expect(git.checkForRemoteUpdate).toHaveBeenCalledTimes(1)
  })

  it('reschedules immediately when the setting changes to "off" mid-run — cancels the pending tick', () => {
    const settings = makeFakeSettings({ 'git:semiPullFrequency': '15m' })
    const git = makeFakeGitService()
    const c = new GitSemiPullController({ settings: settings.service, gitService: git.service })
    c.start()

    settings.set('git:semiPullFrequency', 'off')
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(git.checkForRemoteUpdate).not.toHaveBeenCalled()
  })

  it('start() is idempotent — calling it twice does not double-schedule', () => {
    const settings = makeFakeSettings({ 'git:semiPullFrequency': '15m' })
    const git = makeFakeGitService()
    const c = new GitSemiPullController({ settings: settings.service, gitService: git.service })
    c.start()
    c.start()

    vi.advanceTimersByTime(15 * 60 * 1000)
    expect(git.checkForRemoteUpdate).toHaveBeenCalledTimes(1)
  })

  it('stop() clears the timer and the setting subscription', () => {
    const settings = makeFakeSettings({ 'git:semiPullFrequency': '15m' })
    const git = makeFakeGitService()
    const c = new GitSemiPullController({ settings: settings.service, gitService: git.service })
    c.start()
    c.stop()

    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(git.checkForRemoteUpdate).not.toHaveBeenCalled()

    // A setting change after stop() must not resurrect a timer.
    settings.set('git:semiPullFrequency', 'off')
    settings.set('git:semiPullFrequency', '15m')
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(git.checkForRemoteUpdate).not.toHaveBeenCalled()
  })

  describe('singleton wiring', () => {
    afterEach(() => {
      __resetGitSemiPullControllerForTesting()
    })

    it('initGitSemiPullController stops a previous instance before creating a new one', () => {
      const settings = makeFakeSettings({ 'git:semiPullFrequency': '15m' })
      const git = makeFakeGitService()

      const first = initGitSemiPullController({ settings: settings.service, gitService: git.service })
      const stopSpy = vi.spyOn(first, 'stop')
      const second = initGitSemiPullController({ settings: settings.service, gitService: git.service })

      expect(stopSpy).toHaveBeenCalled()
      expect(getGitSemiPullController()).toBe(second)
      expect(second).not.toBe(first)
    })
  })
})
