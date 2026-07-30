import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'

// --- Hoisted mocks ---

const { appMock, getAllWindows, mockLogger } = vi.hoisted(() => ({
  appMock: { on: vi.fn(), prependListener: vi.fn(), quit: vi.fn(), exit: vi.fn() },
  getAllWindows: vi.fn<() => { isDestroyed: () => boolean }[]>(() => []),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('electron', () => ({
  // `setupAppLifecycle` only touches `app.on/prependListener/quit/exit` +
  // `BrowserWindow`; the
  // rest is referenced by other (untested) functions in the module — stub
  // enough that importing it succeeds. `process.type` is undefined under
  // vitest, so the top-level `registerSchemesAsPrivileged` guard is skipped.
  app: appMock,
  BrowserWindow: Object.assign(vi.fn(), { getAllWindows }),
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  net: { fetch: vi.fn() }
}))

vi.mock('../services', () => ({
  getThemeService: vi.fn(),
  getStorageService: vi.fn(),
  initSettingsService: vi.fn(),
  initFeatureService: vi.fn(),
  logger: mockLogger
}))

vi.mock('./ipc', () => ({
  registerThemeHandlers: vi.fn(),
  registerFileHandlers: vi.fn(),
  registerStorageHandlers: vi.fn(),
  registerSearchHandlers: vi.fn(),
  registerWindowHandlers: vi.fn(),
  registerMiscHandlers: vi.fn(),
  registerSettingsHandlers: vi.fn(),
  registerGitHandlers: vi.fn(),
  registerNativeMenuHandlers: vi.fn()
}))

vi.mock('./SplashWindow', () => ({ createSplashWindow: vi.fn() }))

/** Register the lifecycle handlers on a fresh module instance (the watchdog
 * timer is module state) and hand back the registered app listeners. */
async function setupLifecycle(
  options?: Parameters<typeof import('./IPCManager').setupAppLifecycle>[0]
): Promise<{ onWindowAllClosed: () => void; onBeforeQuit: () => void }> {
  vi.resetModules()
  const { setupAppLifecycle } = await import('./IPCManager')
  setupAppLifecycle(options)
  const listenerFor = (event: string): (() => void) => {
    const calls = [...appMock.on.mock.calls, ...appMock.prependListener.mock.calls]
    const registration = calls.find(([registered]) => registered === event)
    expect(registration).toBeDefined()
    return registration?.[1] as () => void
  }
  return { onWindowAllClosed: listenerFor('window-all-closed'), onBeforeQuit: listenerFor('before-quit') }
}

/** Shorthand for the tests that only drive the last-window-closed route. */
async function setupAndGetWindowAllClosed(
  options?: Parameters<typeof import('./IPCManager').setupAppLifecycle>[0]
): Promise<() => void> {
  return (await setupLifecycle(options)).onWindowAllClosed
}

/** Force `process.platform` for the duration of a test. */
function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

describe('setupAppLifecycle — quit watchdog (no windowless orphan process)', () => {
  const ORIGINAL_PLATFORM_DESCRIPTOR = Object.getOwnPropertyDescriptor(process, 'platform')
  let stderr: MockInstance<typeof process.stderr.write>

  beforeEach(() => {
    vi.useFakeTimers()
    appMock.on.mockClear()
    appMock.prependListener.mockClear()
    appMock.quit.mockReset()
    appMock.quit.mockImplementation(() => undefined)
    appMock.exit.mockClear()
    getAllWindows.mockReset()
    getAllWindows.mockReturnValue([])
    mockLogger.warn.mockClear()
    stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    stderr.mockRestore()
    if (ORIGINAL_PLATFORM_DESCRIPTOR) {
      Object.defineProperty(process, 'platform', ORIGINAL_PLATFORM_DESCRIPTOR)
    }
  })

  it('force-exits when the graceful quit never took the process down', async () => {
    stubPlatform('linux')
    const onWindowAllClosed = await setupAndGetWindowAllClosed()

    onWindowAllClosed()
    expect(appMock.quit).toHaveBeenCalledTimes(1)
    // The graceful quit is given its full grace period first.
    expect(appMock.exit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(9_000)
    expect(appMock.exit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1_000)
    expect(appMock.exit).toHaveBeenCalledWith(0)
    // Reported on BOTH channels: a packaged desktop launch configures neither a
    // console nor a file log transport, so stderr is the only trace left.
    expect(mockLogger.warn).toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('forcing exit'))
  })

  it('leaves the app alone when a window came back before the deadline', async () => {
    stubPlatform('linux')
    const onWindowAllClosed = await setupAndGetWindowAllClosed()

    onWindowAllClosed()
    getAllWindows.mockReturnValue([{ isDestroyed: () => false }])
    vi.advanceTimersByTime(60_000)

    expect(appMock.exit).not.toHaveBeenCalled()
  })

  it('ignores windows that are already destroyed', async () => {
    stubPlatform('linux')
    const onWindowAllClosed = await setupAndGetWindowAllClosed()

    onWindowAllClosed()
    getAllWindows.mockReturnValue([{ isDestroyed: () => true }])
    vi.advanceTimersByTime(60_000)

    expect(appMock.exit).toHaveBeenCalledWith(0)
  })

  it('arms a single watchdog when windows close repeatedly', async () => {
    stubPlatform('linux')
    const onWindowAllClosed = await setupAndGetWindowAllClosed()

    onWindowAllClosed()
    onWindowAllClosed()
    onWindowAllClosed()
    vi.advanceTimersByTime(60_000)

    expect(appMock.exit).toHaveBeenCalledTimes(1)
  })

  it('re-arms after a window came back and closed again', async () => {
    stubPlatform('linux')
    const onWindowAllClosed = await setupAndGetWindowAllClosed()

    // First quit is abandoned: a window is live again when the deadline hits.
    onWindowAllClosed()
    getAllWindows.mockReturnValue([{ isDestroyed: () => false }])
    vi.advanceTimersByTime(60_000)
    expect(appMock.exit).not.toHaveBeenCalled()

    // That window closes in turn — the watchdog must guard this quit too.
    getAllWindows.mockReturnValue([])
    onWindowAllClosed()
    vi.advanceTimersByTime(60_000)
    expect(appMock.exit).toHaveBeenCalledWith(0)
  })

  it('honours a custom grace period', async () => {
    stubPlatform('linux')
    const onWindowAllClosed = await setupAndGetWindowAllClosed({ quitWatchdogMs: 2_000 })

    onWindowAllClosed()
    vi.advanceTimersByTime(1_999)
    expect(appMock.exit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(appMock.exit).toHaveBeenCalledWith(0)
  })

  it('still quits, but never force-exits, when the watchdog is disabled', async () => {
    stubPlatform('linux')
    const onWindowAllClosed = await setupAndGetWindowAllClosed({ quitWatchdogMs: false })

    onWindowAllClosed()
    vi.advanceTimersByTime(600_000)

    expect(appMock.quit).toHaveBeenCalledTimes(1)
    expect(appMock.exit).not.toHaveBeenCalled()
  })

  it('guards a quit that never emits window-all-closed (menu Quit, in-app app.quit)', async () => {
    // Electron closes the windows itself for those routes and goes straight to
    // `will-quit` — `window-all-closed` is never emitted, so `before-quit` is
    // the only place the watchdog can be armed for them.
    stubPlatform('linux')
    const { onBeforeQuit } = await setupLifecycle()

    onBeforeQuit()
    vi.advanceTimersByTime(10_000)

    expect(appMock.exit).toHaveBeenCalledWith(0)
  })

  it('does not force-exit a quit that was cancelled and left a window open', async () => {
    stubPlatform('linux')
    const { onBeforeQuit } = await setupLifecycle()

    // `before-quit` fires while the windows are still up; a listener cancelled
    // the quit, so the window is still there when the deadline hits.
    getAllWindows.mockReturnValue([{ isDestroyed: () => false }])
    onBeforeQuit()
    vi.advanceTimersByTime(60_000)

    expect(appMock.exit).not.toHaveBeenCalled()
  })

  it('arms one watchdog when before-quit and window-all-closed both fire', async () => {
    stubPlatform('linux')
    const { onWindowAllClosed, onBeforeQuit } = await setupLifecycle()

    onBeforeQuit()
    onWindowAllClosed()
    vi.advanceTimersByTime(60_000)

    expect(appMock.exit).toHaveBeenCalledTimes(1)
  })

  it('does not arm from before-quit on macOS, where a cancelled Cmd+Q is normal', async () => {
    stubPlatform('darwin')
    const { onBeforeQuit } = await setupLifecycle()

    onBeforeQuit()
    vi.advanceTimersByTime(60_000)

    expect(appMock.exit).not.toHaveBeenCalled()
  })

  it('is registered AHEAD of the host app\'s own before-quit teardown', async () => {
    // Listeners run in registration order and the chain stops at the first
    // throw. The host registers its teardown at module scope, long before this
    // runs; registering normally would put the watchdog last, where the very
    // failure it guards against would skip it.
    stubPlatform('linux')
    await setupLifecycle()

    expect(appMock.prependListener).toHaveBeenCalledWith('before-quit', expect.any(Function))
    expect(appMock.on.mock.calls.some(([event]) => event === 'before-quit')).toBe(false)
  })

  it('still force-exits when app.quit() itself throws out of the before-quit chain', async () => {
    stubPlatform('linux')
    const onWindowAllClosed = await setupAndGetWindowAllClosed()
    appMock.quit.mockImplementation(() => {
      throw new Error('a before-quit listener blew up')
    })

    expect(() => { onWindowAllClosed() }).toThrow()
    vi.advanceTimersByTime(10_000)

    expect(appMock.exit).toHaveBeenCalledWith(0)
  })

  it('neither quits nor force-exits on macOS, where a windowless app is normal', async () => {
    stubPlatform('darwin')
    const onWindowAllClosed = await setupAndGetWindowAllClosed()

    onWindowAllClosed()
    vi.advanceTimersByTime(60_000)

    expect(appMock.quit).not.toHaveBeenCalled()
    expect(appMock.exit).not.toHaveBeenCalled()
  })
})
