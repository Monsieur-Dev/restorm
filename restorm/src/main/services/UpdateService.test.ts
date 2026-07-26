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
    expect(engine.autoInstallOnAppQuit).toBe(true)
    expect(engine.checkForUpdates).toHaveBeenCalledTimes(1)
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
    expect(svc.getSettings()).toEqual({ autoCheckEnabled: true, currentVersion: '1.2.0' })
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
})
