import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ResolvedSetting, ResolvedSettingValue, SettingValue } from '../../types/settings'

// ---------------------------------------------------------------------------
// Shared fake state — hoisted so vi.mock factories can reference it.
// ---------------------------------------------------------------------------
const mockState = vi.hoisted(() => {
  const userValues = new Map<string, string | number | boolean>()
  const workspaceValues = new Map<string, string | number | boolean>()
  const themes = [
    { id: 'dark/Default Dark+', name: 'Default Dark+', type: 'dark' as const, path: '/themes/dark.yaml' },
    { id: 'light/Default Light+', name: 'Default Light+', type: 'light' as const, path: '/themes/light.yaml' }
  ]
  return {
    userValues,
    workspaceValues,
    themes,
    workspacePath: '/projects/demo' as string | null,
    settingsInitialised: true,
    themeServiceUnavailable: false,
    reset(): void {
      userValues.clear()
      workspaceValues.clear()
      this.workspacePath = '/projects/demo'
      this.settingsInitialised = true
      this.themeServiceUnavailable = false
    }
  }
})

vi.mock('electron', () => ({
  app: { on: vi.fn(), off: vi.fn() },
  BrowserWindow: {
    getAllWindows: (): unknown[] => [],
    getFocusedWindow: (): unknown => null
  },
  ipcMain: { on: vi.fn(), off: vi.fn() },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() }
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
  getStorageService: () => ({ get: vi.fn(), set: vi.fn() })
}))

vi.mock('./I18nService', () => ({
  i18nService: { t: (key: string): string => `t(${key})` }
}))

// The registry the routes read: a small YAML-equivalent tree covering every
// declared type, plus one app-registered setting and one user-only setting.
const FIXTURE: ResolvedSetting[] = [
  {
    id: 'theme', titleKey: 'settings.theme.title', descriptionKey: 'settings.theme.description',
    type: 'theme', default: 'dark/Default Dark+',
    groupPath: ['appearance'], storageKey: 'appearance:theme', currentValue: 'dark/Default Dark+', isModified: false
  },
  {
    id: 'language', titleKey: 'settings.language.title', descriptionKey: 'settings.language.description',
    type: 'enum', default: 'en', userOnly: true,
    params: { values: [{ value: 'en', labelKey: 'lang.en' }, { value: 'fr', labelKey: 'lang.fr' }] },
    groupPath: ['appearance'], storageKey: 'appearance:language', currentValue: 'en', isModified: false
  },
  {
    id: 'fontSize', titleKey: 'settings.fontSize.title', descriptionKey: 'settings.fontSize.description',
    type: 'number', default: 14, params: { min: 8, max: 72, integer: true },
    groupPath: ['appearance', 'editor'], storageKey: 'appearance.editor:fontSize', currentValue: 14, isModified: false
  },
  {
    id: 'syncSidebarWithTabs', titleKey: 'app.sync.title', descriptionKey: 'app.sync.description',
    type: 'toggle', default: true,
    groupPath: ['behavior'], storageKey: 'behavior:syncSidebarWithTabs', currentValue: true, isModified: false
  }
]

const fakeSettingsService = {
  getFiltered: (): ResolvedSetting[] => FIXTURE,
  getUserValue: (key: string): SettingValue | undefined => mockState.userValues.get(key),
  getWorkspaceValue: (key: string): SettingValue | undefined => mockState.workspaceValues.get(key),
  getResolvedValue: (key: string): ResolvedSettingValue => {
    const ws = mockState.workspaceValues.get(key)
    if (ws !== undefined) return { storageKey: key, effective: ws, source: 'workspace' }
    const user = mockState.userValues.get(key)
    if (user !== undefined) return { storageKey: key, effective: user, source: 'user' }
    return { storageKey: key, effective: FIXTURE.find((s) => s.storageKey === key)?.default ?? '', source: 'default' }
  },
  getWorkspacePath: (): string | null => mockState.workspacePath,
  set: vi.fn((key: string, value: SettingValue) => { mockState.userValues.set(key, value) }),
  setWorkspaceValue: vi.fn((key: string, value: SettingValue) => { mockState.workspaceValues.set(key, value) }),
  resetSetting: vi.fn((key: string) => { mockState.userValues.delete(key) }),
  resetWorkspaceValue: vi.fn((key: string) => { mockState.workspaceValues.delete(key) })
}

vi.mock('./SettingsService', () => ({
  isSettingsServiceInitialized: (): boolean => mockState.settingsInitialised,
  getSettingsService: () => fakeSettingsService
}))

import { McpService } from './McpService'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function textOf(result: unknown): string {
  const r = result as { content: { type: string; text?: string }[] }
  return r.content[0]?.text ?? ''
}

function parseText(result: unknown): Record<string, unknown> {
  return JSON.parse(textOf(result)) as Record<string, unknown>
}

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true
}

interface CatalogEntry {
  key: string
  title: string
  description: string
  allowed: { kind: string; values?: { value: string }[]; min?: number; max?: number; integer?: boolean }
  value: SettingValue | null
  effective: SettingValue
  effectiveSource: string
  editableScopes: string[]
}

function settingsOf(result: unknown): CatalogEntry[] {
  return parseText(result)['settings'] as CatalogEntry[]
}

beforeEach(() => {
  mockState.reset()
  fakeSettingsService.set.mockClear()
  fakeSettingsService.setWorkspaceValue.mockClear()
  fakeSettingsService.resetSetting.mockClear()
  fakeSettingsService.resetWorkspaceValue.mockClear()
})

// ---------------------------------------------------------------------------
// get_settings
// ---------------------------------------------------------------------------
describe('McpService — get_settings', () => {
  it('describes every registered setting with its domain and meaning', () => {
    const service = new McpService()
    const result = service.invokeTool('get_settings', {})
    const payload = parseText(result)

    expect(payload['scope']).toBe('user')
    expect(payload['count']).toBe(FIXTURE.length)
    expect(settingsOf(result).map((s) => s.key)).toEqual([
      'appearance:theme',
      'appearance:language',
      'appearance.editor:fontSize',
      'behavior:syncSidebarWithTabs'
    ])

    const fontSize = settingsOf(result).find((s) => s.key === 'appearance.editor:fontSize')
    expect(fontSize).toMatchObject({
      title: 't(settings.fontSize.title)',
      description: 't(settings.fontSize.description)',
      allowed: { kind: 'number', min: 8, max: 72, integer: true },
      value: null,
      effective: 14,
      effectiveSource: 'default'
    })
  })

  it('offers the installed themes as the domain of the theme setting', () => {
    const service = new McpService()
    const theme = settingsOf(service.invokeTool('get_settings', {})).find((s) => s.key === 'appearance:theme')
    expect(theme?.allowed).toEqual({
      kind: 'theme',
      values: [
        { value: 'dark/Default Dark+', label: 'Default Dark+', family: 'dark' },
        { value: 'light/Default Light+', label: 'Default Light+', family: 'light' }
      ]
    })
  })

  it('reads the workspace layer when asked for the workspace scope', () => {
    mockState.userValues.set('appearance.editor:fontSize', 16)
    mockState.workspaceValues.set('appearance.editor:fontSize', 20)
    const service = new McpService()

    const userEntry = settingsOf(service.invokeTool('get_settings', { scope: 'user' }))
      .find((s) => s.key === 'appearance.editor:fontSize')
    const workspaceEntry = settingsOf(service.invokeTool('get_settings', { scope: 'workspace' }))
      .find((s) => s.key === 'appearance.editor:fontSize')

    expect(userEntry?.value).toBe(16)
    expect(workspaceEntry?.value).toBe(20)
    // Both agree the workspace layer wins.
    expect(userEntry?.effective).toBe(20)
    expect(userEntry?.effectiveSource).toBe('workspace')
  })

  it('marks a user-only setting as unwritable at the workspace scope', () => {
    const service = new McpService()
    const language = settingsOf(service.invokeTool('get_settings', {})).find((s) => s.key === 'appearance:language')
    expect(language?.editableScopes).toEqual(['user'])
  })

  it('still lists a user-only setting at the workspace scope, flagged rather than hidden', () => {
    // The settings page's Workspace tab hides these; the API deliberately shows
    // them, so a caller sees the key exists and why it cannot be written here
    // instead of concluding it does not exist at this scope.
    const service = new McpService()
    const language = settingsOf(service.invokeTool('get_settings', { scope: 'workspace' }))
      .find((s) => s.key === 'appearance:language')
    expect(language).toBeDefined()
    expect(language?.editableScopes).toEqual(['user'])
  })

  it('filters with the query argument', () => {
    const service = new McpService()
    const result = service.invokeTool('get_settings', { query: 'fontsize' })
    expect(settingsOf(result).map((s) => s.key)).toEqual(['appearance.editor:fontSize'])
    expect(parseText(result)['count']).toBe(1)
  })

  it('refuses the workspace scope when no project is open', () => {
    mockState.workspacePath = null
    const service = new McpService()
    const result = service.invokeTool('get_settings', { scope: 'workspace' })
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('No workspace is open')
    // The user scope still works with no project open.
    expect(isError(service.invokeTool('get_settings', { scope: 'user' }))).toBe(false)
  })

  it('rejects an unknown scope and names the valid ones', () => {
    const service = new McpService()
    const result = service.invokeTool('get_settings', { scope: 'global' })
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('user, workspace')
  })

  it('reports when the host has no settings service', () => {
    mockState.settingsInitialised = false
    const service = new McpService()
    const result = service.invokeTool('get_settings', {})
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('SettingsService is not initialised')
  })
})

// ---------------------------------------------------------------------------
// set_setting
// ---------------------------------------------------------------------------
describe('McpService — set_setting', () => {
  it('writes through the settings service at the user scope', () => {
    const service = new McpService()
    const result = service.invokeTool('set_setting', { key: 'appearance.editor:fontSize', value: 20 })

    expect(fakeSettingsService.set).toHaveBeenCalledWith('appearance.editor:fontSize', 20)
    expect(parseText(result)).toMatchObject({
      scope: 'user',
      key: 'appearance.editor:fontSize',
      previous: null,
      value: 20,
      effective: 20,
      effectiveSource: 'user'
    })
  })

  it('writes to the overlay at the workspace scope', () => {
    const service = new McpService()
    const result = service.invokeTool('set_setting', {
      key: 'behavior:syncSidebarWithTabs', value: false, scope: 'workspace'
    })

    expect(fakeSettingsService.setWorkspaceValue).toHaveBeenCalledWith('behavior:syncSidebarWithTabs', false)
    expect(fakeSettingsService.set).not.toHaveBeenCalled()
    expect(parseText(result)).toMatchObject({ scope: 'workspace', value: false, effectiveSource: 'workspace' })
  })

  it('changes the theme through the ordinary settings path', () => {
    const service = new McpService()
    const result = service.invokeTool('set_setting', { key: 'appearance:theme', value: 'light/Default Light+' })

    // The write lands on the settings key the settings page uses, which is what
    // broadcasts the change and repaints the app — no separate theme route.
    expect(fakeSettingsService.set).toHaveBeenCalledWith('appearance:theme', 'light/Default Light+')
    expect(parseText(result)['effective']).toBe('light/Default Light+')
  })

  it('changes the UI language through the ordinary settings path', () => {
    const service = new McpService()
    const result = service.invokeTool('set_setting', { key: 'appearance:language', value: 'fr' })

    expect(fakeSettingsService.set).toHaveBeenCalledWith('appearance:language', 'fr')
    expect(parseText(result)['effective']).toBe('fr')
  })

  it('refuses an unknown theme id and lists the installed ones', () => {
    const service = new McpService()
    const result = service.invokeTool('set_setting', { key: 'appearance:theme', value: 'dark/Nope' })

    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('dark/Default Dark+, light/Default Light+')
    expect(fakeSettingsService.set).not.toHaveBeenCalled()
  })

  it('refuses an unknown enum member and lists the accepted ones', () => {
    const service = new McpService()
    const result = service.invokeTool('set_setting', { key: 'appearance:language', value: 'kl' })

    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('Allowed values: en, fr')
    expect(fakeSettingsService.set).not.toHaveBeenCalled()
  })

  it('refuses a value outside the declared range', () => {
    const service = new McpService()
    const tooBig = service.invokeTool('set_setting', { key: 'appearance.editor:fontSize', value: 400 })
    expect(isError(tooBig)).toBe(true)
    expect(textOf(tooBig)).toContain('above the maximum 72')

    const notAnInteger = service.invokeTool('set_setting', { key: 'appearance.editor:fontSize', value: 14.5 })
    expect(isError(notAnInteger)).toBe(true)
    expect(textOf(notAnInteger)).toContain('expects an integer')

    const wrongType = service.invokeTool('set_setting', { key: 'behavior:syncSidebarWithTabs', value: 'yes' })
    expect(isError(wrongType)).toBe(true)
    expect(textOf(wrongType)).toContain('expects a boolean, received string')

    expect(fakeSettingsService.set).not.toHaveBeenCalled()
  })

  it('refuses a workspace write to a user-only setting', () => {
    const service = new McpService()
    const result = service.invokeTool('set_setting', { key: 'appearance:language', value: 'fr', scope: 'workspace' })

    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('user-only')
    expect(fakeSettingsService.setWorkspaceValue).not.toHaveBeenCalled()
  })

  it('refuses a workspace write when no project is open', () => {
    mockState.workspacePath = null
    const service = new McpService()
    const result = service.invokeTool('set_setting', {
      key: 'appearance.editor:fontSize', value: 20, scope: 'workspace'
    })

    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('No workspace is open')
    expect(fakeSettingsService.setWorkspaceValue).not.toHaveBeenCalled()
  })

  it('refuses an unknown key and points at the listing route', () => {
    const service = new McpService()
    const result = service.invokeTool('set_setting', { key: 'nope:nope', value: 1 })

    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('Unknown setting "nope:nope"')
    expect(fakeSettingsService.set).not.toHaveBeenCalled()
  })

  it('requires a key', () => {
    const service = new McpService()
    expect(textOf(service.invokeTool('set_setting', { value: 1 }))).toContain('key is required')
  })
})

// ---------------------------------------------------------------------------
// patch_settings
// ---------------------------------------------------------------------------
describe('McpService — patch_settings', () => {
  it('applies several settings in one call', () => {
    const service = new McpService()
    const result = service.invokeTool('patch_settings', {
      values: { 'appearance.editor:fontSize': 18, 'behavior:syncSidebarWithTabs': false, 'appearance:language': 'fr' }
    })

    expect(parseText(result)['applied']).toBe(3)
    expect(fakeSettingsService.set).toHaveBeenCalledWith('appearance.editor:fontSize', 18)
    expect(fakeSettingsService.set).toHaveBeenCalledWith('behavior:syncSidebarWithTabs', false)
    expect(fakeSettingsService.set).toHaveBeenCalledWith('appearance:language', 'fr')
  })

  it('writes nothing when any value in the batch is refused', () => {
    const service = new McpService()
    const result = service.invokeTool('patch_settings', {
      values: { 'appearance.editor:fontSize': 18, 'appearance:language': 'kl' }
    })

    expect(isError(result)).toBe(true)
    const payload = parseText(result)
    expect(payload['applied']).toBe(0)
    const rejected = payload['rejected'] as { key: string; error: string }[]
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.key).toBe('appearance:language')
    expect(rejected[0]?.error).toContain('Allowed values: en, fr')
    // Not even the valid half was written.
    expect(fakeSettingsService.set).not.toHaveBeenCalled()
  })

  it('reports every rejection at once rather than the first', () => {
    const service = new McpService()
    const result = service.invokeTool('patch_settings', {
      values: { 'appearance.editor:fontSize': 400, 'ghost:setting': 1 }
    })

    expect((parseText(result)['rejected'] as { key: string }[]).map((r) => r.key))
      .toEqual(['appearance.editor:fontSize', 'ghost:setting'])
  })

  it('applies a batch at the workspace scope', () => {
    const service = new McpService()
    service.invokeTool('patch_settings', {
      values: { 'appearance.editor:fontSize': 18 }, scope: 'workspace'
    })

    expect(fakeSettingsService.setWorkspaceValue).toHaveBeenCalledWith('appearance.editor:fontSize', 18)
    expect(fakeSettingsService.set).not.toHaveBeenCalled()
  })

  it('rejects a malformed or empty values argument', () => {
    const service = new McpService()
    expect(textOf(service.invokeTool('patch_settings', { values: 'nope' })))
      .toContain('values must be an object')
    expect(textOf(service.invokeTool('patch_settings', { values: [] })))
      .toContain('values must be an object')
    expect(textOf(service.invokeTool('patch_settings', { values: {} })))
      .toContain('at least one setting')
  })
})

// ---------------------------------------------------------------------------
// reset_setting
// ---------------------------------------------------------------------------
describe('McpService — reset_setting', () => {
  it('drops the user value and falls back to the default', () => {
    mockState.userValues.set('appearance.editor:fontSize', 30)
    const service = new McpService()
    const result = service.invokeTool('reset_setting', { key: 'appearance.editor:fontSize' })

    expect(fakeSettingsService.resetSetting).toHaveBeenCalledWith('appearance.editor:fontSize')
    expect(parseText(result)).toMatchObject({
      key: 'appearance.editor:fontSize',
      previous: 30,
      value: null,
      effective: 14,
      effectiveSource: 'default'
    })
  })

  it('drops the workspace override and falls back to the user value', () => {
    mockState.userValues.set('appearance.editor:fontSize', 16)
    mockState.workspaceValues.set('appearance.editor:fontSize', 30)
    const service = new McpService()
    const result = service.invokeTool('reset_setting', { key: 'appearance.editor:fontSize', scope: 'workspace' })

    expect(fakeSettingsService.resetWorkspaceValue).toHaveBeenCalledWith('appearance.editor:fontSize')
    expect(parseText(result)).toMatchObject({ previous: 30, value: null, effective: 16, effectiveSource: 'user' })
  })

  it('refuses an unknown key', () => {
    const service = new McpService()
    const result = service.invokeTool('reset_setting', { key: 'nope:nope' })
    expect(isError(result)).toBe(true)
    expect(fakeSettingsService.resetSetting).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// The generic routes replace the single-purpose theme mutator.
// ---------------------------------------------------------------------------
describe('McpService — theme mutation route', () => {
  it('no longer registers a dedicated theme switcher', () => {
    const service = new McpService()
    expect(() => service.invokeTool('switch_theme', { themeId: 'dark/Default Dark+' })).toThrow(/not registered/)
  })

  it('still exposes the read-only theme discovery routes', () => {
    const service = new McpService()
    expect(isError(service.invokeTool('list_themes', {}))).toBe(false)
    expect(isError(service.invokeTool('get_current_theme', {}))).toBe(false)
  })
})
