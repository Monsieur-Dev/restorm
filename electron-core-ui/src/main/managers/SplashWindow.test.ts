import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// --- Hoisted mocks (accessible inside vi.mock factories) ---

const { MockBrowserWindow, mockCreateFromPath, instances } = vi.hoisted(() => {
  const instances: MockBrowserWindow[] = []

  class MockBrowserWindow {
    _constructorOptions: Record<string, unknown>
    loadURL = vi.fn((_url: string) => Promise.resolve())
    center = vi.fn()
    // Model Electron's focus contract: `show: true` at construction focuses
    // the window; show() focuses; showInactive() reveals without focus. So
    // isFocused() reflects how the splash was revealed and the test can assert
    // focus deterministically rather than eyeballing it.
    _focused = false
    show = vi.fn(() => {
      this._focused = true
    })
    showInactive = vi.fn(() => {
      this._focused = false
    })
    isFocused = vi.fn(() => this._focused)
    _destroyed = false
    close = vi.fn(() => {
      this._destroyed = true
    })
    isDestroyed = vi.fn(() => this._destroyed)
    constructor(opts: Record<string, unknown>) {
      this._constructorOptions = opts
      // `show: true` (the focusing default) focuses at construction.
      this._focused = opts['show'] === true
      instances.push(this)
    }
  }

  const mockCreateFromPath = vi.fn((): { isEmpty: () => boolean; toDataURL: () => string } => ({
    isEmpty: () => false,
    toDataURL: () => 'data:image/png;base64,LOGO'
  }))

  return { MockBrowserWindow, mockCreateFromPath, instances }
})

vi.mock('../services', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('electron', () => ({
  BrowserWindow: MockBrowserWindow,
  nativeImage: { createFromPath: mockCreateFromPath },
  // WindowManager (imported transitively for isInactiveRevealRequested) reads
  // `app` only inside isDevToolsEnabled(), which these tests never call.
  app: { isPackaged: false }
}))

import { createSplashWindow } from './SplashWindow'

/** Constructor options of the most recently created splash window. */
function lastOptions(): Record<string, unknown> {
  const win = instances[instances.length - 1]
  if (!win) throw new Error('No splash window was created')
  return win._constructorOptions
}

/** The HTML loaded into the most recent splash, decoded from its data URL. */
function lastHtml(): string {
  const win = instances[instances.length - 1]
  if (!win) throw new Error('No splash window was created')
  const call = win.loadURL.mock.calls[0]
  if (!call) throw new Error('loadURL was not called')
  const url = call[0]
  return decodeURIComponent(url.replace(/^data:text\/html;charset=utf-8,/, ''))
}

describe('createSplashWindow', () => {
  beforeEach(() => {
    instances.length = 0
    mockCreateFromPath.mockClear()
  })

  it('creates a centered, frameless, always-on-top, fixed-size window with defaults', () => {
    createSplashWindow({ logoPath: '/tmp/logo.png' })

    const opts = lastOptions()
    expect(opts['width']).toBe(800)
    expect(opts['height']).toBe(350)
    expect(opts['frame']).toBe(false)
    expect(opts['center']).toBe(true)
    expect(opts['resizable']).toBe(false)
    expect(opts['alwaysOnTop']).toBe(true)
    expect(opts['skipTaskbar']).toBe(true)
    // Default background is transparent → window is transparent and paints no bg colour.
    expect(opts['transparent']).toBe(true)
    expect(opts).not.toHaveProperty('backgroundColor')
  })

  it('honors custom size and opaque background', () => {
    createSplashWindow({ logoPath: '/tmp/logo.png', width: 600, height: 300, background: '#1a1a2e' })

    const opts = lastOptions()
    expect(opts['width']).toBe(600)
    expect(opts['height']).toBe(300)
    expect(opts['transparent']).toBe(false)
    expect(opts['backgroundColor']).toBe('#1a1a2e')
  })

  it('inlines the logo file as a data URL and loads draggable splash HTML', () => {
    createSplashWindow({ logoPath: '/tmp/logo.png' })

    expect(mockCreateFromPath).toHaveBeenCalledWith('/tmp/logo.png')
    const html = lastHtml()
    // Logo is embedded + the whole surface is a drag handle.
    expect(html).toContain('data:image/png;base64,LOGO')
    expect(html).toContain('-webkit-app-region: drag')
  })

  it('prefers a provided data URL over reading the file', () => {
    createSplashWindow({ logoDataUrl: 'data:image/png;base64,INLINE', logoPath: '/tmp/logo.png' })

    expect(mockCreateFromPath).not.toHaveBeenCalled()
    expect(lastHtml()).toContain('data:image/png;base64,INLINE')
  })

  it('close() is idempotent and only closes a live window', () => {
    const handle = createSplashWindow({ logoPath: '/tmp/logo.png' })
    const win = instances[0]

    handle.close()
    handle.close()

    expect(win?.close).toHaveBeenCalledTimes(1)
    expect(handle.getWindow()).toBeNull()
  })

  it('renders without a logo when none resolves', () => {
    mockCreateFromPath.mockReturnValueOnce({ isEmpty: () => true, toDataURL: () => '' })
    createSplashWindow({ logoPath: '/tmp/missing.png' })

    expect(lastHtml()).not.toContain('<img')
  })

  describe('revealInactive (no-focus reveal)', () => {
    const ORIGINAL_ARGV = process.argv

    afterEach(() => {
      process.argv = ORIGINAL_ARGV
    })

    it('shows immediately with focus by default (show:true, no showInactive)', () => {
      createSplashWindow({ logoPath: '/tmp/logo.png' })

      const win = instances[instances.length - 1]
      expect(lastOptions()['show']).toBe(true)
      expect(win?.showInactive).not.toHaveBeenCalled()
      // Deterministic focus contract: the default splash takes focus.
      expect(win?.isFocused()).toBe(true)
    })

    it('reveals without focus (show:false + showInactive) when revealInactive is set', () => {
      createSplashWindow({ logoPath: '/tmp/logo.png', revealInactive: true })

      const win = instances[instances.length - 1]
      expect(lastOptions()['show']).toBe(false)
      expect(win?.showInactive).toHaveBeenCalledTimes(1)
      // The whole point: the splash is revealed WITHOUT focus.
      expect(win?.isFocused()).toBe(false)
    })

    it('reveals without focus when the --inactive-window flag is present', () => {
      process.argv = [...ORIGINAL_ARGV, '--inactive-window']
      createSplashWindow({ logoPath: '/tmp/logo.png' })

      const win = instances[instances.length - 1]
      expect(lastOptions()['show']).toBe(false)
      expect(win?.showInactive).toHaveBeenCalledTimes(1)
      expect(win?.isFocused()).toBe(false)
    })

    it('an explicit revealInactive:false wins over the --inactive-window flag', () => {
      process.argv = [...ORIGINAL_ARGV, '--inactive-window']
      createSplashWindow({ logoPath: '/tmp/logo.png', revealInactive: false })

      const win = instances[instances.length - 1]
      expect(lastOptions()['show']).toBe(true)
      expect(win?.showInactive).not.toHaveBeenCalled()
      expect(win?.isFocused()).toBe(true)
    })
  })
})
