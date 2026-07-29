import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UpdateService, type UpdaterEngine } from './UpdateService'

// ---- module mocks (hoisted) ------------------------------------------------

const settingsStore = new Map<string, unknown>()
const storageStore = new Map<string, unknown>()
const settingListeners = new Map<string, ((v: unknown) => void)[]>()

vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.2.0',
    isPackaged: true,
    getAppPath: () => '/app'
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

// Static import in UpdateService resolves here; never used (we inject a fake).
vi.mock('electron-updater', () => ({ autoUpdater: {} }))

vi.mock('electron-core-ui/main', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  withFirewallBypass: <T,>(fn: () => Promise<T>) => fn(),
  getSettingsService: () => ({
    get: (k: string) => settingsStore.get(k),
    set: (k: string, v: unknown) => {
      settingsStore.set(k, v)
      for (const l of settingListeners.get(k) ?? []) l(v)
    },
    onSettingChanged: (k: string, listener: (v: unknown) => void) => {
      const bucket = settingListeners.get(k) ?? []
      settingListeners.set(k, bucket)
      bucket.push(listener)
      return () => {
        settingListeners.set(
          k,
          (settingListeners.get(k) ?? []).filter((l) => l !== listener)
        )
      }
    }
  }),
  getStorageService: () => ({
    get: (k: string) => storageStore.get(k),
    set: (k: string, v: unknown) => storageStore.set(k, v)
  })
}))

// ---- fake engine -----------------------------------------------------------

interface FakeEngine extends UpdaterEngine {
  emit: (event: string, ...args: unknown[]) => void
  checkForUpdates: ReturnType<typeof vi.fn>
  downloadUpdate: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
}

function makeEngine(): FakeEngine {
  const handlers: Record<string, ((...a: unknown[]) => void)[] | undefined> = {}
  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn(),
    on(event, listener) {
      const bucket = handlers[event] ?? []
      handlers[event] = bucket
      bucket.push(listener)
    },
    emit(event, ...args) {
      for (const h of handlers[event] ?? []) h(...args)
    }
  }
}

beforeEach(() => {
  settingsStore.clear()
  storageStore.clear()
  settingListeners.clear()
  vi.clearAllMocks()
})

function newService(engine: FakeEngine): UpdateService {
  return new UpdateService({ engineFactory: () => engine, now: () => 1_700_000_000_000 })
}

/** Run `body` with `process.platform` forced, then restore it. */
function withPlatform(platform: NodeJS.Platform, body: () => void): void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    body()
  } finally {
    if (original) Object.defineProperty(process, 'platform', original)
  }
}

describe('UpdateService', () => {
  it('seeds lastSeenVersion on a fresh install (no toast later for a version never run)', () => {
    const svc = newService(makeEngine())
    svc.initialize()
    expect(svc.getLastSeenVersion()).toBe('1.2.0')
  })

  it('does an immediate auto-check + configures the engine when auto-check is on', () => {
    const engine = makeEngine()
    newService(engine).initialize()
    expect(engine.autoDownload).toBe(true)
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('never lets an update install itself on quit, on any platform', () => {
    // The quit-time installer runs after the last window is gone, and where it
    // needs elevation it blocks the main thread behind a windowless prompt —
    // that is how the app ends up alive with nothing on screen. An update is
    // applied only from the user's explicit "restart now".
    for (const platform of ['linux', 'win32', 'darwin'] as NodeJS.Platform[]) {
      withPlatform(platform, () => {
        const engine = makeEngine()
        engine.autoInstallOnAppQuit = true
        newService(engine).initialize()
        expect(engine.autoInstallOnAppQuit).toBe(false)
      })
    }
  })

  it('does NOT auto-check when auto-check is disabled, but manual still works', async () => {
    settingsStore.set('updates:autoCheckEnabled', false)
    const engine = makeEngine()
    const svc = newService(engine)
    svc.initialize()
    expect(engine.checkForUpdates).not.toHaveBeenCalled()
    await svc.checkForUpdates('manual')
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('applies the install-on-quit policy to an engine acquired outside initialize()', () => {
    // A build where `initialize` bailed out early still hands an engine to a
    // manual check; it must not carry electron-updater's install-on-quit
    // default, which registers the quit-time installer behind our back.
    const engine = makeEngine()
    engine.autoInstallOnAppQuit = true
    const svc = newService(engine)
    void svc.checkForUpdates('manual')
    expect(engine.autoInstallOnAppQuit).toBe(false)
  })

  it('asks the installer to relaunch — "restart now" has to actually restart', () => {
    // Locks the CALL SHAPE only: the fake engine cannot tell us what the real
    // backend does with the arguments (with `isSilent: false` it resolves the
    // force-run flag from `autoRunAppAfterInstall` and ignores this one). The
    // point is that the silent path is never the one we take.
    const engine = makeEngine()
    const svc = newService(engine)
    svc.initialize()
    svc.quitAndInstall()
    expect(engine.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('walks available → downloading → downloaded', () => {
    const engine = makeEngine()
    const svc = newService(engine)
    svc.initialize()
    engine.emit('update-available', { version: '1.3.0' })
    expect(svc.getState()).toMatchObject({ phase: 'available', version: '1.3.0' })
    engine.emit('download-progress', { percent: 42.6 })
    expect(svc.getState()).toMatchObject({ phase: 'downloading', percent: 43 })
    engine.emit('update-downloaded', { version: '1.3.0' })
    expect(svc.getState()).toMatchObject({ phase: 'downloaded', version: '1.3.0', percent: 100 })
  })

  it('update-not-available returns to idle and stamps lastCheckedAt', () => {
    const engine = makeEngine()
    const svc = newService(engine)
    svc.initialize()
    engine.emit('update-not-available', {})
    const s = svc.getState()
    expect(s.phase).toBe('idle')
    expect(s.lastCheckedAt).toBe(new Date(1_700_000_000_000).toISOString())
  })

  it('surfaces a manual-check error but stays silent on an auto-check error', async () => {
    // Disable auto-check so init leaves the machine idle (no in-flight check to
    // settle) and both checks below are driven explicitly.
    settingsStore.set('updates:autoCheckEnabled', false)
    const engine = makeEngine()
    const svc = newService(engine)
    svc.initialize()

    engine.checkForUpdates.mockRejectedValueOnce(new Error('boom-manual'))
    await svc.checkForUpdates('manual')
    expect(svc.getState()).toMatchObject({
      phase: 'error',
      error: { trigger: 'manual', message: 'boom-manual' }
    })

    engine.checkForUpdates.mockRejectedValueOnce(new Error('boom-auto'))
    await svc.checkForUpdates('auto')
    expect(svc.getState().phase).toBe('idle')
    expect(svc.getState().error).toBeNull()
  })

  it('retries a download error with backoff before giving up', () => {
    vi.useFakeTimers()
    const engine = makeEngine()
    const svc = newService(engine)
    svc.initialize()
    engine.emit('update-available', { version: '1.3.0' })
    engine.emit('download-progress', { percent: 10 }) // now downloading
    engine.emit('error', new Error('net-drop'))
    // first retry scheduled after backoff → downloadUpdate called
    vi.advanceTimersByTime(5_000)
    expect(engine.downloadUpdate).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('getSettings reflects the persisted auto-check flag + current version', () => {
    const svc = newService(makeEngine())
    expect(svc.getSettings()).toEqual({
      autoCheckEnabled: true,
      currentVersion: '1.2.0',
      // isPackaged:true in the electron mock, no RESTORM_STORE_BUILD → supported.
      autoUpdateSupported: true
    })
    svc.setAutoCheckEnabled(false)
    expect(svc.getSettings().autoCheckEnabled).toBe(false)
  })

  it('quitAndInstall delegates to the engine', () => {
    const engine = makeEngine()
    const svc = newService(engine)
    svc.initialize()
    svc.quitAndInstall()
    expect(engine.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  describe('getReleaseNotes', () => {
    const REMOTE = `# Changelog

## v2.0.0

- Second release
![logo](data:image/png;base64,AAAA)
![shot](https://dl.restorm.app/x.png)

## v1.0.0

- First release
`

    const ENGLISH = `# Changelog

## v2.0.0

- Second release, in English

## v1.0.0

- First release
`

    /** Serve `body` for the URLs in `available`, 404 everything else. */
    function serve(available: Record<string, string>): ReturnType<typeof vi.fn> {
      return vi.fn((url: string) =>
        Promise.resolve(
          url in available
            ? { ok: true, text: () => Promise.resolve(available[url] ?? '') }
            : { ok: false, text: () => Promise.resolve('') }
        )
      )
    }

    const urlsOf = (m: ReturnType<typeof vi.fn>): string[] =>
      m.mock.calls.map((c) => String(c[0]))

    it('fetches the localized changelog first and returns sections newest-first', async () => {
      const fetchMock = serve({ 'https://dl.restorm.app/changelogs/fr.md': REMOTE })
      vi.stubGlobal('fetch', fetchMock)
      try {
        const sections = await newService(makeEngine()).getReleaseNotes('fr')

        expect(urlsOf(fetchMock)).toEqual(['https://dl.restorm.app/changelogs/fr.md'])
        expect(sections.map((s) => s.version)).toEqual(['2.0.0', '1.0.0'])
        // The markdown crosses over verbatim — restricting images to inline
        // `data:` URIs is the viewer's job, not this service's, so a remote one
        // is left in the payload rather than scrubbed out of the text.
        const newest = sections[0]?.markdown ?? ''
        expect(newest).toContain('data:image/png;base64,AAAA')
        expect(newest).toContain('dl.restorm.app/x.png')
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('falls back to the English feed changelog when the locale is missing', async () => {
      // Only the English file exists on the feed — `changelogs/de.md` 404s.
      const fetchMock = serve({ 'https://dl.restorm.app/CHANGELOG.md': ENGLISH })
      vi.stubGlobal('fetch', fetchMock)
      try {
        const sections = await newService(makeEngine()).getReleaseNotes('de')

        expect(urlsOf(fetchMock)).toEqual([
          'https://dl.restorm.app/changelogs/de.md',
          'https://dl.restorm.app/CHANGELOG.md'
        ])
        expect(sections.map((s) => s.version)).toEqual(['2.0.0', '1.0.0'])
        expect(sections[0]?.markdown ?? '').toContain('Second release, in English')
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('tries the region tag then the base language before English', async () => {
      const fetchMock = serve({ 'https://dl.restorm.app/changelogs/zh.md': ENGLISH })
      vi.stubGlobal('fetch', fetchMock)
      try {
        await newService(makeEngine()).getReleaseNotes('zh-TW')
        expect(urlsOf(fetchMock)).toEqual([
          'https://dl.restorm.app/changelogs/zh-TW.md',
          'https://dl.restorm.app/changelogs/zh.md'
        ])
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('goes straight to English for an English locale (no guaranteed 404s)', async () => {
      const fetchMock = serve({ 'https://dl.restorm.app/CHANGELOG.md': ENGLISH })
      vi.stubGlobal('fetch', fetchMock)
      try {
        await newService(makeEngine()).getReleaseNotes('en-US')
        expect(urlsOf(fetchMock)).toEqual(['https://dl.restorm.app/CHANGELOG.md'])
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('never interpolates an implausible locale into the feed URL', async () => {
      const fetchMock = serve({ 'https://dl.restorm.app/CHANGELOG.md': ENGLISH })
      vi.stubGlobal('fetch', fetchMock)
      try {
        await newService(makeEngine()).getReleaseNotes('../../etc/passwd')
        expect(urlsOf(fetchMock)).toEqual(['https://dl.restorm.app/CHANGELOG.md'])
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('falls back to the bundled changelog when the feed is unreachable', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))
      vi.stubGlobal('fetch', fetchMock)
      try {
        const sections = await newService(makeEngine()).getReleaseNotes('fr')

        // Both candidates were attempted, and the shipped file answered instead.
        expect(urlsOf(fetchMock)).toEqual([
          'https://dl.restorm.app/changelogs/fr.md',
          'https://dl.restorm.app/CHANGELOG.md'
        ])
        // Compare against the real bundled French changelog rather than a fixed
        // version string, so cutting a release doesn't break this test.
        const bundled = readFileSync(join(process.cwd(), 'changelogs', 'fr.md'), 'utf-8')
        const expected = [...bundled.matchAll(/^##\s+v(\d+\.\d+\.\d+)/gm)].map((m) => m[1])
        expect(expected.length).toBeGreaterThan(0)
        expect(sections.map((s) => s.version)).toEqual(expected)
        expect((sections[0]?.markdown ?? '').trim().length).toBeGreaterThan(0)
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('returns an empty list rather than throwing when nothing can be resolved', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent')
      try {
        await expect(newService(makeEngine()).getReleaseNotes('fr')).resolves.toEqual([])
      } finally {
        cwd.mockRestore()
        vi.unstubAllGlobals()
      }
    })
  })
})
