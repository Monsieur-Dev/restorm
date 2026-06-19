import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Shared fake state — hoisted so vi.mock factories can reference it.
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => {
  const sent: { channel: string; themeId: string }[] = []
  const storage = new Map<string, unknown>()
  const themes = [
    { id: 'dark/Default Dark+', name: 'Default Dark+', type: 'dark' as const, path: '/themes/dark/Default Dark+.yaml' },
    { id: 'light/Default Light+', name: 'Default Light+', type: 'light' as const, path: '/themes/light/Default Light+.yaml' },
    { id: 'dark/Monokai', name: 'Monokai', type: 'dark' as const, path: '/themes/dark/Monokai.yaml' }
  ]
  return {
    sent,
    storage,
    themes,
    fakeWindow: {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, themeId: string) => { sent.push({ channel, themeId }) }
      }
    },
    reset(): void {
      sent.length = 0
      storage.clear()
    },
    /** Controls whether ThemeService throws on getThemeService() */
    themeServiceUnavailable: false
  }
})

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('electron', () => ({
  app: { on: vi.fn(), off: vi.fn() },
  BrowserWindow: {
    getAllWindows: () => [mockState.fakeWindow],
    getFocusedWindow: () => mockState.fakeWindow
  },
  ipcMain: { on: vi.fn(), off: vi.fn() },
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
    showMessageBox: vi.fn()
  }
}))

vi.mock('./LoggerService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

vi.mock('./ThemeService', () => ({
  getThemeService: () => {
    if (mockState.themeServiceUnavailable) throw new Error('ThemeService not initialised')
    return { listThemes: () => mockState.themes }
  }
}))

vi.mock('./StorageService', () => ({
  getStorageService: () => ({
    get: (key: string) => mockState.storage.get(key),
    set: (key: string, value: unknown) => { mockState.storage.set(key, value) }
  })
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
import { McpService } from './McpService'

function textOf(result: unknown): string {
  const r = result as { content: { type: string; text?: string }[] }
  return r.content[0]?.text ?? ''
}

function parseText(result: unknown): unknown {
  return JSON.parse(textOf(result))
}

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true
}

// ---------------------------------------------------------------------------
// Tests: list_themes
// ---------------------------------------------------------------------------
describe('McpService — list_themes', () => {
  beforeEach(() => { mockState.reset(); mockState.themeServiceUnavailable = false })

  it('returns all themes with id, name, and family', () => {
    const service = new McpService()
    const result = parseText(service.invokeTool('list_themes', {}))
    expect(result).toEqual({
      themes: [
        { id: 'dark/Default Dark+', name: 'Default Dark+', family: 'dark' },
        { id: 'light/Default Light+', name: 'Default Light+', family: 'light' },
        { id: 'dark/Monokai', name: 'Monokai', family: 'dark' }
      ]
    })
    expect(isError(service.invokeTool('list_themes', {}))).toBe(false)
  })

  it('returns an error when ThemeService is not initialised', () => {
    mockState.themeServiceUnavailable = true
    const service = new McpService()
    const result = service.invokeTool('list_themes', {})
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('ThemeService is not initialised')
  })
})

// ---------------------------------------------------------------------------
// Tests: get_current_theme
// ---------------------------------------------------------------------------
describe('McpService — get_current_theme', () => {
  beforeEach(() => { mockState.reset(); mockState.themeServiceUnavailable = false })

  it('returns the currently persisted theme', () => {
    mockState.storage.set('currentTheme', 'light/Default Light+')
    const service = new McpService()
    const result = parseText(service.invokeTool('get_current_theme', {}))
    expect(result).toEqual({ id: 'light/Default Light+', name: 'Default Light+', family: 'light' })
  })

  it('falls back to the first dark theme when nothing is persisted', () => {
    const service = new McpService()
    const result = parseText(service.invokeTool('get_current_theme', {}))
    expect((result as { family: string }).family).toBe('dark')
  })

  it('falls back to the first dark theme when the stored id is unrecognised', () => {
    mockState.storage.set('currentTheme', 'unknown/theme')
    const service = new McpService()
    const result = parseText(service.invokeTool('get_current_theme', {}))
    // Should still give a valid theme back (not error)
    expect((result as { id: string }).id).toBeTruthy()
    expect(isError(service.invokeTool('get_current_theme', {}))).toBe(false)
  })

  it('returns an error when ThemeService is not initialised', () => {
    mockState.themeServiceUnavailable = true
    const service = new McpService()
    const result = service.invokeTool('get_current_theme', {})
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('ThemeService is not initialised')
  })
})

// ---------------------------------------------------------------------------
// Tests: switch_theme
// ---------------------------------------------------------------------------
describe('McpService — switch_theme', () => {
  beforeEach(() => { mockState.reset(); mockState.themeServiceUnavailable = false })

  it('switches to a valid theme and broadcasts theme:changed', () => {
    mockState.storage.set('currentTheme', 'dark/Default Dark+')
    const service = new McpService()
    const result = parseText(service.invokeTool('switch_theme', { themeId: 'light/Default Light+' }))
    expect(result).toMatchObject({ id: 'light/Default Light+', name: 'Default Light+', family: 'light', changed: true })
    expect(mockState.storage.get('currentTheme')).toBe('light/Default Light+')
    expect(mockState.sent).toEqual([{ channel: 'theme:changed', themeId: 'light/Default Light+' }])
  })

  it('returns changed:false and does not broadcast when already the active theme', () => {
    mockState.storage.set('currentTheme', 'dark/Monokai')
    const service = new McpService()
    const result = parseText(service.invokeTool('switch_theme', { themeId: 'dark/Monokai' }))
    expect((result as { changed: boolean }).changed).toBe(false)
    expect(mockState.sent).toHaveLength(0)
  })

  it('returns an error for an unknown themeId', () => {
    const service = new McpService()
    const result = service.invokeTool('switch_theme', { themeId: 'unknown/theme' })
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('Unknown theme id "unknown/theme"')
    expect(textOf(result)).toContain('dark/Default Dark+')
    expect(mockState.sent).toHaveLength(0)
  })

  it('returns an error when themeId is empty', () => {
    const service = new McpService()
    const result = service.invokeTool('switch_theme', { themeId: '' })
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('themeId is required')
    expect(mockState.sent).toHaveLength(0)
  })

  it('returns an error when themeId is missing', () => {
    const service = new McpService()
    const result = service.invokeTool('switch_theme', {})
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('themeId is required')
  })

  it('returns an error when ThemeService is not initialised', () => {
    mockState.themeServiceUnavailable = true
    const service = new McpService()
    const result = service.invokeTool('switch_theme', { themeId: 'dark/Default Dark+' })
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('ThemeService is not initialised')
  })

  it('persists the new theme before broadcasting', () => {
    const service = new McpService()
    service.invokeTool('switch_theme', { themeId: 'dark/Monokai' })
    expect(mockState.storage.get('currentTheme')).toBe('dark/Monokai')
  })
})
