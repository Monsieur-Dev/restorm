import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Hoisted mocks (accessible inside vi.mock factories) ---

const { mockStorageGet, mockStorageSet, MockBrowserWindow } = vi.hoisted(() => {
  const mockGetBounds = vi.fn(() => ({ x: 100, y: 100, width: 1200, height: 800 }))
  const mockWebContents = {
    send: vi.fn(), on: vi.fn(), once: vi.fn(), setIgnoreMenuShortcuts: vi.fn(),
    session: { setPermissionCheckHandler: vi.fn() },
    openDevTools: vi.fn(), id: 1
  }

  class MockBrowserWindow {
    _constructorOptions: Record<string, unknown>
    getBounds = mockGetBounds
    isFullScreen = vi.fn(() => false)
    isDestroyed = vi.fn(() => false)
    isMaximized = vi.fn(() => false)
    setFullScreen = vi.fn()
    on = vi.fn()
    loadURL = vi.fn(() => Promise.resolve())
    loadFile = vi.fn(() => Promise.resolve())
    webContents = mockWebContents
    constructor(opts: Record<string, unknown>) {
      this._constructorOptions = opts
    }
  }

  return {
    mockStorageGet: vi.fn(),
    mockStorageSet: vi.fn(),
    MockBrowserWindow
  }
})

vi.mock('../services', () => ({
  getStorageService: () => ({
    get: mockStorageGet,
    set: mockStorageSet
  }),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('electron', () => ({
  BrowserWindow: Object.assign(MockBrowserWindow, { fromWebContents: vi.fn() }),
  screen: {
    getPrimaryDisplay: () => ({
      workAreaSize: { width: 1920, height: 1080 }
    })
  },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn(), on: vi.fn() },
  nativeImage: { createFromPath: vi.fn(() => ({})) },
  Menu: { setApplicationMenu: vi.fn() },
  app: { isPackaged: false }
}))

vi.mock('path', () => ({
  join: (...args: string[]) => args.join('/')
}))

import { BaseWindow } from './BaseWindow'
import type { WindowConfiguration, WindowState } from './WindowManager'

// Concrete subclass for testing (BaseWindow is abstract)
class TestWindow extends BaseWindow {
  // empty — only need to instantiate
}

const defaultConfig: WindowConfiguration = {
  name: 'test-window',
  defaultWidth: 1200,
  defaultHeight: 800,
  url: undefined,
  file: 'index.html'
}

/** Helper: get the options passed to the BrowserWindow constructor */
function getWindowOptions(win: TestWindow): Record<string, unknown> {
  const bw = win.getWindow() as unknown as InstanceType<typeof MockBrowserWindow>
  return bw._constructorOptions
}

/** Helper: find and invoke the 'close' handler on the BrowserWindow mock */
function triggerClose(win: TestWindow): void {
  const bw = win.getWindow() as unknown as InstanceType<typeof MockBrowserWindow>
  const closeCall = (bw.on.mock.calls as [string, () => void][]).find(
    (call) => call[0] === 'close'
  )
  expect(closeCall).toBeDefined()
  closeCall?.[1]()
}

describe('BaseWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset static flags so each test can register IPC handlers
    // @ts-expect-error — accessing private static fields for test reset
    BaseWindow.iconHandlerRegistered = false
    // @ts-expect-error — accessing private static fields for test reset
    BaseWindow.windowActionHandlerRegistered = false
    // @ts-expect-error — accessing private static fields for test reset
    BaseWindow.windowTitleHandlerRegistered = false
    // @ts-expect-error — accessing private static fields for test reset
    BaseWindow.platformHandlerRegistered = false
    // @ts-expect-error — accessing private static fields for test reset
    BaseWindow.interceptedShortcutsHandlerRegistered = false
    // @ts-expect-error — accessing private static fields for test reset
    BaseWindow.isDevModeHandlerRegistered = false
  })

  describe('window centering on clear-settings (no saved state)', () => {
    it('should create a centered window with x > 0 and y > 0', () => {
      // Simulate clear-settings: storage returns no saved windows
      mockStorageGet.mockReturnValue(undefined)

      const win = new TestWindow(defaultConfig)
      const opts = getWindowOptions(win)

      // Screen is 1920x1080, window is 1200x800
      // Expected: x = floor((1920 - 1200) / 2) = 360, y = floor((1080 - 800) / 2) = 140
      expect(opts['x']).toBe(360)
      expect(opts['y']).toBe(140)
      expect(opts['width']).toBe(1200)
      expect(opts['height']).toBe(800)

      // All values must be > 0
      expect(opts['x']).toBeGreaterThan(0)
      expect(opts['y']).toBeGreaterThan(0)
      expect(opts['width']).toBeGreaterThan(0)
      expect(opts['height']).toBeGreaterThan(0)
    })

    it('should save window state with all values > 0 on close', () => {
      mockStorageGet.mockReturnValue(undefined)

      const win = new TestWindow(defaultConfig)
      triggerClose(win)

      // Verify storageService.set was called with window state where all values > 0
      expect(mockStorageSet).toHaveBeenCalled()
      const callArgs = mockStorageSet.mock.calls[0] as [string, Record<string, WindowState>]
      expect(callArgs[0]).toBe('windows')
      const saved = callArgs[1]['test-window']
      if (!saved) throw new Error('Expected saved window state to exist')
      expect(saved.x).toBeGreaterThanOrEqual(0)
      expect(saved.y).toBeGreaterThanOrEqual(0)
      expect(saved.width).toBeGreaterThan(0)
      expect(saved.height).toBeGreaterThan(0)
    })
  })

  describe('window state restoration', () => {
    it('should restore saved window position', () => {
      mockStorageGet.mockReturnValue({
        'test-window': { width: 1000, height: 600, x: 200, y: 150, fullscreen: false }
      })

      const win = new TestWindow(defaultConfig)
      const opts = getWindowOptions(win)

      expect(opts['x']).toBe(200)
      expect(opts['y']).toBe(150)
      expect(opts['width']).toBe(1000)
      expect(opts['height']).toBe(600)
    })

    it('should fall back to centered default for off-screen position', () => {
      // Window position completely off-screen (x beyond screen width)
      mockStorageGet.mockReturnValue({
        'test-window': { width: 1200, height: 800, x: 2000, y: 50, fullscreen: false }
      })

      const win = new TestWindow(defaultConfig)
      const opts = getWindowOptions(win)

      // x should be reset to centered (360) since 2000 >= 1920
      expect(opts['x']).toBe(360)
      // y is valid (50 is within screen)
      expect(opts['y']).toBe(50)
    })

    it('should round-trip position and size through save/restore (near top-right corner)', () => {
      // Screen 1920x1080, window 600x600, placed 10px from right edge, 10px from top
      const savedX = 1920 - 600 - 10 // 1310
      const savedY = 10
      const savedWidth = 600
      const savedHeight = 600

      mockStorageGet.mockReturnValue({
        'test-window': { width: savedWidth, height: savedHeight, x: savedX, y: savedY, fullscreen: false }
      })

      const win = new TestWindow(defaultConfig)

      // 1. Verify the window was created at the saved position
      const opts = getWindowOptions(win)
      expect(opts['x']).toBe(savedX)
      expect(opts['y']).toBe(savedY)
      expect(opts['width']).toBe(savedWidth)
      expect(opts['height']).toBe(savedHeight)

      // 2. Make getBounds return the same values (simulate Electron reporting correctly)
      const bw = win.getWindow() as unknown as InstanceType<typeof MockBrowserWindow>
      bw.getBounds.mockReturnValue({ x: savedX, y: savedY, width: savedWidth, height: savedHeight })

      // 3. Trigger close → saveWindowState
      triggerClose(win)

      // 4. Verify the saved state matches exactly
      expect(mockStorageSet).toHaveBeenCalled()
      const callArgs = mockStorageSet.mock.calls[0] as [string, Record<string, WindowState>]
      const persisted = callArgs[1]['test-window']
      if (!persisted) throw new Error('Expected saved window state to exist')

      expect(persisted.x).toBe(savedX)
      expect(persisted.y).toBe(savedY)
      expect(persisted.width).toBe(savedWidth)
      expect(persisted.height).toBe(savedHeight)
    })
  })
})
