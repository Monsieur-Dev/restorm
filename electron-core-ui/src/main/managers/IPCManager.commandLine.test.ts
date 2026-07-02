import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// --- Hoisted mocks ---

const { appendSwitch, mockLogger } = vi.hoisted(() => ({
  appendSwitch: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('electron', () => ({
  // configureCommandLineSwitches only touches app.commandLine; the rest is
  // referenced by other (untested) functions in the module — stub enough that
  // importing the module succeeds. `process.type` is undefined under vitest, so
  // the top-level protocol.registerSchemesAsPrivileged guard is skipped.
  app: { commandLine: { appendSwitch }, isPackaged: false },
  BrowserWindow: vi.fn(),
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
  registerGitHandlers: vi.fn()
}))

vi.mock('./SplashWindow', () => ({ createSplashWindow: vi.fn() }))

import { configureCommandLineSwitches } from './IPCManager'

describe('configureCommandLineSwitches — inactive launch (Wayland focus suppression)', () => {
  const ORIGINAL_ARGV = process.argv

  beforeEach(() => {
    appendSwitch.mockClear()
    mockLogger.info.mockClear()
    delete process.env['XDG_ACTIVATION_TOKEN']
    delete process.env['DESKTOP_STARTUP_ID']
  })

  afterEach(() => {
    process.argv = ORIGINAL_ARGV
    delete process.env['XDG_ACTIVATION_TOKEN']
    delete process.env['DESKTOP_STARTUP_ID']
  })

  it('without --inactive-window: does not force XWayland and leaves the activation tokens', () => {
    process.argv = ['node', 'main.js']
    process.env['XDG_ACTIVATION_TOKEN'] = 'tok-abc'
    process.env['DESKTOP_STARTUP_ID'] = 'startup-1'

    configureCommandLineSwitches()

    const ozoneCalls = appendSwitch.mock.calls.filter((c) => c[0] === 'ozone-platform')
    expect(ozoneCalls).toHaveLength(0)
    // The tokens are untouched on a normal (focusing) launch.
    expect(process.env['XDG_ACTIVATION_TOKEN']).toBe('tok-abc')
    expect(process.env['DESKTOP_STARTUP_ID']).toBe('startup-1')
  })

  it('with --inactive-window: forces ozone-platform=x11 (XWayland)', () => {
    process.argv = ['node', 'main.js', '--inactive-window']

    configureCommandLineSwitches()

    expect(appendSwitch).toHaveBeenCalledWith('ozone-platform', 'x11')
  })

  it('with --inactive-window: DELETES the inherited activation tokens', () => {
    process.argv = ['node', 'main.js', '--inactive-window']
    process.env['XDG_ACTIVATION_TOKEN'] = 'tok-abc'
    process.env['DESKTOP_STARTUP_ID'] = 'startup-1'

    configureCommandLineSwitches()

    // Concrete, platform-independent assertion: the env keys are gone (deleted,
    // not set to the string "undefined"), so neither an inherited token nor a
    // stringified placeholder survives to activate the window.
    expect('XDG_ACTIVATION_TOKEN' in process.env).toBe(false)
    expect('DESKTOP_STARTUP_ID' in process.env).toBe(false)
    expect(process.env['XDG_ACTIVATION_TOKEN']).toBeUndefined()
    expect(process.env['DESKTOP_STARTUP_ID']).toBeUndefined()
  })
})
