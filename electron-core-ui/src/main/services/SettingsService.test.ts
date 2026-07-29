import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import yaml from 'js-yaml'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock electron
const mockGetAllWindows = vi.fn((): unknown[] => [])
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => mockGetAllWindows()
  }
}))

// Mock fs
const mockFsUnlink = vi.fn<(path: string) => Promise<void>>()
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  promises: {
    unlink: (path: string): Promise<void> => mockFsUnlink(path)
  }
}))

// Mock the atomic-write helper used for the workspace overlay flush
const mockAtomicWriteFile = vi.fn<(path: string, contents: string) => Promise<void>>()
vi.mock('./PersistenceService', () => ({
  atomicWriteFile: (path: string, contents: string): Promise<void> => mockAtomicWriteFile(path, contents)
}))

// Mock js-yaml
vi.mock('js-yaml', () => ({
  default: {
    load: vi.fn()
  }
}))

// Mock logger
vi.mock('./LoggerService', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

// Mock StorageService
const mockStorageGet = vi.fn()
const mockStorageSet = vi.fn()
const mockStorageDelete = vi.fn()
vi.mock('./StorageService', () => ({
  getStorageService: () => ({
    get: mockStorageGet,
    set: mockStorageSet,
    delete: mockStorageDelete
  })
}))

// Mock I18nService
vi.mock('./I18nService', () => ({
  i18nService: {
    t: (key: string) => key
  }
}))

// Mock FeatureFlippingService
const mockIsEnabled = vi.fn()
const mockIsFeatureServiceInitialized = vi.fn(() => true)
vi.mock('./FeatureFlippingService', () => ({
  isFeatureServiceInitialized: () => mockIsFeatureServiceInitialized(),
  getFeatureService: () => ({
    isEnabled: mockIsEnabled
  })
}))

import { existsSync, readFileSync } from 'fs'
import { SettingsService } from './SettingsService'
import { logger } from './LoggerService'
import type { SettingsYamlConfig, SettingsGroup, SettingDefinition } from '../../types/settings'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid YAML config */
function makeConfig(overrides: Partial<SettingsYamlConfig> = {}): SettingsYamlConfig {
  return {
    groups: overrides.groups ?? [
      {
        id: 'general',
        titleKey: 'settings.general',
        items: [
          {
            setting: {
              id: 'fontSize',
              titleKey: 'settings.fontSize',
              descriptionKey: 'settings.fontSizeDesc',
              type: 'number',
              default: 14
            }
          },
          {
            setting: {
              id: 'wordWrap',
              titleKey: 'settings.wordWrap',
              type: 'toggle',
              default: true
            }
          }
        ]
      }
    ],
    ...(overrides.overrideDefaultGroups !== undefined ? { overrideDefaultGroups: overrides.overrideDefaultGroups } : {})
  }
}

/** Set up mocks so the constructor can load a config from a given path */
function setupConfigMock(config: SettingsYamlConfig, path = '/fake/settings.yaml'): void {
  vi.mocked(existsSync).mockImplementation((p: Parameters<typeof existsSync>[0]) => String(p) === path)
  vi.mocked(readFileSync).mockReturnValue('yaml-placeholder')
  vi.mocked(yaml.load).mockReturnValue(config)
}

/** Create a service with the default config loaded */
function createService(config?: SettingsYamlConfig): SettingsService {
  const cfg = config ?? makeConfig()
  setupConfigMock(cfg)
  return new SettingsService('/fake/settings.yaml')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStorageGet.mockReturnValue(undefined)
    mockIsFeatureServiceInitialized.mockReturnValue(true)
    mockIsEnabled.mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------
  // YAML loading and Zod validation
  // ---------------------------------------------------------------
  describe('YAML loading and validation', () => {
    it('loads groups from a valid YAML config', () => {
      const service = createService()
      const groups = service.getGroups()

      expect(groups).toHaveLength(1)
      expect(groups[0]?.id).toBe('general')
      expect(groups[0]?.items).toHaveLength(2)
    })

    it('handles missing config file gracefully', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const service = new SettingsService('/fake/missing.yaml')

      expect(service.getGroups()).toEqual([])
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Default config not found'),
        expect.any(Object)
      )
    })

    it('handles invalid YAML data gracefully', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('yaml-placeholder')
      // Return data that fails Zod validation (missing required 'groups')
      vi.mocked(yaml.load).mockReturnValue({ invalid: true })

      const service = new SettingsService('/fake/settings.yaml')

      expect(service.getGroups()).toEqual([])
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid settings config'),
        expect.any(Object)
      )
    })

    it('handles YAML parse error gracefully', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('yaml-placeholder')
      vi.mocked(yaml.load).mockImplementation(() => {
        throw new Error('YAML syntax error')
      })

      const service = new SettingsService('/fake/settings.yaml')

      expect(service.getGroups()).toEqual([])
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load config'),
        expect.any(Object)
      )
    })

    it('logs initialization info with group count', () => {
      createService()

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Initialized'),
        expect.objectContaining({ groups: 1 })
      )
    })
  })

  // ---------------------------------------------------------------
  // Get / Set with StorageService
  // ---------------------------------------------------------------
  describe('get/set', () => {
    it('returns persisted value when stored', () => {
      const service = createService()
      mockStorageGet.mockReturnValue(20)

      const value = service.get('general:fontSize')

      expect(mockStorageGet).toHaveBeenCalledWith('settings:general:fontSize')
      expect(value).toBe(20)
    })

    it('returns default value when nothing is stored', () => {
      const service = createService()
      mockStorageGet.mockReturnValue(undefined)

      const value = service.get('general:fontSize')

      expect(value).toBe(14)
    })

    it('returns empty string when setting is not found and nothing stored', () => {
      const service = createService()
      mockStorageGet.mockReturnValue(undefined)

      const value = service.get('nonexistent:key')

      expect(value).toBe('')
    })

    it('set persists value via StorageService', () => {
      const service = createService()

      service.set('general:fontSize', 18)

      expect(mockStorageSet).toHaveBeenCalledWith('settings:general:fontSize', 18)
    })

    it('set broadcasts change to all non-destroyed windows', () => {
      const mockSend = vi.fn()
      const mockWindows = [
        { isDestroyed: () => false, webContents: { send: mockSend } },
        { isDestroyed: () => true, webContents: { send: vi.fn() } },
        { isDestroyed: () => false, webContents: { send: mockSend } }
      ]
      mockGetAllWindows.mockReturnValue(mockWindows)

      const service = createService()
      service.set('general:fontSize', 18)

      expect(mockSend).toHaveBeenCalledTimes(2)
      expect(mockSend).toHaveBeenCalledWith('settings:changed', 'general:fontSize', 18)
    })
  })

  // ---------------------------------------------------------------
  // resetSetting
  // ---------------------------------------------------------------
  describe('resetSetting', () => {
    it('deletes persisted value and broadcasts default', () => {
      const mockSend = vi.fn()
      mockGetAllWindows.mockReturnValue([
        { isDestroyed: () => false, webContents: { send: mockSend } }
      ])

      const service = createService()
      service.resetSetting('general:fontSize')

      expect(mockStorageDelete).toHaveBeenCalledWith('settings:general:fontSize')
      expect(mockSend).toHaveBeenCalledWith('settings:changed', 'general:fontSize', 14)
    })

    it('broadcasts empty string when setting is not found', () => {
      const mockSend = vi.fn()
      mockGetAllWindows.mockReturnValue([
        { isDestroyed: () => false, webContents: { send: mockSend } }
      ])

      const service = createService()
      service.resetSetting('nonexistent:key')

      expect(mockStorageDelete).toHaveBeenCalledWith('settings:nonexistent:key')
      expect(mockSend).toHaveBeenCalledWith('settings:changed', 'nonexistent:key', '')
    })
  })

  // ---------------------------------------------------------------
  // Search index building and querying
  // ---------------------------------------------------------------
  describe('search', () => {
    it('returns all settings when query is empty', () => {
      const service = createService()
      const results = service.search('')

      expect(results).toHaveLength(2)
    })

    it('returns all settings when query is whitespace', () => {
      const service = createService()
      const results = service.search('   ')

      expect(results).toHaveLength(2)
    })

    it('finds settings matching title key', () => {
      const service = createService()
      // i18nService.t is mocked to return the key itself
      const results = service.search('fontSize')

      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results.some(r => r.storageKey === 'general:fontSize')).toBe(true)
    })

    it('rebuilds index on reindexSearch call', () => {
      const service = createService()

      // After reindex, search should still work
      service.reindexSearch()
      const results = service.search('wordWrap')

      expect(results.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ---------------------------------------------------------------
  // addGroup / addSetting / removeSetting mutations
  // ---------------------------------------------------------------
  describe('runtime mutations', () => {
    it('addGroup at root level', () => {
      const service = createService()
      const newGroup: SettingsGroup = {
        id: 'advanced',
        titleKey: 'settings.advanced',
        items: []
      }

      service.addGroup(null, newGroup)

      expect(service.getGroups()).toHaveLength(2)
      expect(service.getGroups()[1]?.id).toBe('advanced')
    })

    it('addGroup under a parent group', () => {
      const service = createService()
      const childGroup: SettingsGroup = {
        id: 'editor',
        titleKey: 'settings.editor',
        items: []
      }

      service.addGroup('general', childGroup)

      const generalGroup = service.getGroups()[0]
      expect(generalGroup?.items).toHaveLength(3) // 2 settings + 1 nested group
    })

    it('addGroup under non-existent parent does nothing', () => {
      const service = createService()
      const group: SettingsGroup = { id: 'orphan', titleKey: 'settings.orphan', items: [] }

      service.addGroup('nonexistent', group)

      // Only original group
      expect(service.getGroups()).toHaveLength(1)
    })

    it('addSetting to an existing group', () => {
      const service = createService()
      const newSetting: SettingDefinition = {
        id: 'tabSize',
        titleKey: 'settings.tabSize',
        type: 'number',
        default: 4
      }

      service.addSetting('general', newSetting)

      const all = service.getAll()
      expect(all).toHaveLength(3)
      expect(all.some(s => s.id === 'tabSize')).toBe(true)
    })

    it('addSetting to non-existent group does nothing', () => {
      const service = createService()
      const newSetting: SettingDefinition = {
        id: 'orphan',
        titleKey: 'settings.orphan',
        type: 'text',
        default: ''
      }

      service.addSetting('nonexistent', newSetting)

      expect(service.getAll()).toHaveLength(2)
    })

    it('removeSetting removes by storage key', () => {
      const service = createService()

      service.removeSetting('general:fontSize')

      const all = service.getAll()
      expect(all).toHaveLength(1)
      expect(all[0]?.id).toBe('wordWrap')
    })

    it('removeSetting with non-existent key does nothing', () => {
      const service = createService()

      service.removeSetting('nonexistent:key')

      expect(service.getAll()).toHaveLength(2)
    })

    it('removeGroup removes a root-level group', () => {
      const service = createService()
      service.addGroup(null, { id: 'extra', titleKey: 'settings.extra', items: [] })
      expect(service.getGroups()).toHaveLength(2)

      service.removeGroup('extra')

      expect(service.getGroups()).toHaveLength(1)
      expect(service.getGroups()[0]?.id).toBe('general')
    })

    it('removeGroup removes a nested group', () => {
      const service = createService()
      service.addGroup('general', { id: 'nested', titleKey: 'settings.nested', items: [] })

      service.removeGroup('nested')

      const generalGroup = service.getGroups()[0]
      // Should be back to 2 items (the original settings)
      expect(generalGroup?.items).toHaveLength(2)
    })

    it('updateSetting calls reindexSearch for existing setting', () => {
      const service = createService()

      // Should not throw for a valid setting
      service.updateSetting('general:fontSize', { descriptionKey: 'updated.desc' })

      // Verify reindexSearch was called (search still works)
      const results = service.search('fontSize')
      expect(results.length).toBeGreaterThanOrEqual(1)
    })

    it('updateSetting does nothing for non-existent setting', () => {
      const service = createService()

      // Should not throw
      service.updateSetting('nonexistent:key', { default: 99 })

      expect(service.getAll()).toHaveLength(2)
    })
  })

  // ---------------------------------------------------------------
  // Storage key generation from group paths
  // ---------------------------------------------------------------
  describe('storage key generation', () => {
    it('generates keys as groupPath.join("."):settingId', () => {
      const service = createService()
      const all = service.getAll()

      const fontSizeSetting = all.find(s => s.id === 'fontSize')
      expect(fontSizeSetting?.storageKey).toBe('general:fontSize')
      expect(fontSizeSetting?.groupPath).toEqual(['general'])
    })

    it('generates nested keys for nested groups', () => {
      const config = makeConfig({
        groups: [
          {
            id: 'appearance',
            titleKey: 'settings.appearance',
            items: [
              {
                group: {
                  id: 'editor',
                  titleKey: 'settings.editor',
                  items: [
                    {
                      setting: {
                        id: 'fontSize',
                        titleKey: 'settings.fontSize',
                        type: 'number',
                        default: 14
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      })

      const service = createService(config)
      const all = service.getAll()

      expect(all).toHaveLength(1)
      expect(all[0]?.storageKey).toBe('appearance.editor:fontSize')
      expect(all[0]?.groupPath).toEqual(['appearance', 'editor'])
    })
  })

  // ---------------------------------------------------------------
  // getAll with resolved values
  // ---------------------------------------------------------------
  describe('getAll', () => {
    it('returns flattened list with current values from storage', () => {
      mockStorageGet.mockImplementation((key: string) => {
        if (key === 'settings:general:fontSize') return 20
        return undefined
      })

      const service = createService()
      const all = service.getAll()

      const fontSizeSetting = all.find(s => s.storageKey === 'general:fontSize')
      expect(fontSizeSetting?.currentValue).toBe(20)
      expect(fontSizeSetting?.isModified).toBe(true)

      const wordWrapSetting = all.find(s => s.storageKey === 'general:wordWrap')
      expect(wordWrapSetting?.currentValue).toBe(true)
      expect(wordWrapSetting?.isModified).toBe(false)
    })
  })

  // ---------------------------------------------------------------
  // Merge logic (override flags)
  // ---------------------------------------------------------------
  describe('merge logic', () => {
    it('appends groups from app config to default groups', () => {
      // Setup default config
      const defaultConfig = makeConfig()
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('yaml-placeholder')

      let callCount = 0
      vi.mocked(yaml.load).mockImplementation(() => {
        callCount++
        if (callCount === 1) return defaultConfig
        // App config adds another group
        return makeConfig({
          groups: [
            {
              id: 'appSpecific',
              titleKey: 'settings.appSpecific',
              items: []
            }
          ]
        })
      })

      const service = new SettingsService('/fake/default.yaml', '/fake/app.yaml')

      expect(service.getGroups()).toHaveLength(2)
      expect(service.getGroups()[0]?.id).toBe('general')
      expect(service.getGroups()[1]?.id).toBe('appSpecific')
    })

    it('overrideDefaultGroups replaces all groups', () => {
      const defaultConfig = makeConfig()
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('yaml-placeholder')

      let callCount = 0
      vi.mocked(yaml.load).mockImplementation(() => {
        callCount++
        if (callCount === 1) return defaultConfig
        return {
          overrideDefaultGroups: true,
          groups: [
            {
              id: 'replacement',
              titleKey: 'settings.replacement',
              items: []
            }
          ]
        }
      })

      const service = new SettingsService('/fake/default.yaml', '/fake/app.yaml')

      expect(service.getGroups()).toHaveLength(1)
      expect(service.getGroups()[0]?.id).toBe('replacement')
    })

    it('loadConfig with missing file logs warning', () => {
      const service = createService()
      vi.mocked(existsSync).mockReturnValue(false)

      service.loadConfig('/fake/nonexistent.yaml')

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Config file not found'),
        expect.any(Object)
      )
    })
  })

  // ---------------------------------------------------------------
  // Singleton helpers
  // ---------------------------------------------------------------
  describe('singleton functions', () => {
    // These are tested indirectly — the module exports work. We test the
    // class directly here to avoid shared-state issues between tests.
    it('getGroups returns the group hierarchy', () => {
      const service = createService()
      const groups = service.getGroups()
      expect(groups[0]?.id).toBe('general')
    })
  })

  // ---------------------------------------------------------------
  // In-process onSettingChanged subscription
  // ---------------------------------------------------------------
  describe('onSettingChanged', () => {
    it('fires on set() with the new value', () => {
      const service = createService()
      const listener = vi.fn()
      service.onSettingChanged('general:fontSize', listener)

      service.set('general:fontSize', 18)
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(18)
    })

    it('fires on resetSetting() with the default value', () => {
      const service = createService()
      const listener = vi.fn()
      service.onSettingChanged('general:fontSize', listener)

      service.resetSetting('general:fontSize')
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(14)
    })

    it('only fires for the subscribed key', () => {
      const service = createService()
      const fontListener = vi.fn()
      const themeListener = vi.fn()
      service.onSettingChanged('general:fontSize', fontListener)
      service.onSettingChanged('appearance:theme', themeListener)

      service.set('general:fontSize', 20)
      expect(fontListener).toHaveBeenCalledTimes(1)
      expect(themeListener).not.toHaveBeenCalled()
    })

    it('returns an unsubscribe fn that stops further notifications', () => {
      const service = createService()
      const listener = vi.fn()
      const unsub = service.onSettingChanged('general:fontSize', listener)

      service.set('general:fontSize', 16)
      expect(listener).toHaveBeenCalledTimes(1)

      unsub()
      service.set('general:fontSize', 18)
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('supports multiple listeners on the same key', () => {
      const service = createService()
      const a = vi.fn()
      const b = vi.fn()
      service.onSettingChanged('general:fontSize', a)
      service.onSettingChanged('general:fontSize', b)

      service.set('general:fontSize', 22)
      expect(a).toHaveBeenCalledTimes(1)
      expect(b).toHaveBeenCalledTimes(1)
    })

    it('survives a listener that synchronously unsubscribes itself', () => {
      // The notify path snapshots the bucket, so a self-unsubscribe
      // mid-iteration must not skip subsequent listeners.
      const service = createService()
      const a = vi.fn(() => {
        unsubA()
      })
      const b = vi.fn()
      const unsubA = service.onSettingChanged('general:fontSize', a)
      service.onSettingChanged('general:fontSize', b)

      expect(() => {
        service.set('general:fontSize', 24)
      }).not.toThrow()
      expect(a).toHaveBeenCalledTimes(1)
      expect(b).toHaveBeenCalledTimes(1)
    })

    it('catches listener exceptions and logs without breaking other listeners', () => {
      const service = createService()
      const throwing = vi.fn(() => {
        throw new Error('listener boom')
      })
      const ok = vi.fn()
      service.onSettingChanged('general:fontSize', throwing)
      service.onSettingChanged('general:fontSize', ok)

      service.set('general:fontSize', 30)
      expect(throwing).toHaveBeenCalledTimes(1)
      expect(ok).toHaveBeenCalledTimes(1)
      expect(logger.warn).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------
  // Feature-gating
  // ---------------------------------------------------------------
  // ---------------------------------------------------------------
  // Workspace overlay
  // ---------------------------------------------------------------
  describe('workspace overlay', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      mockAtomicWriteFile.mockResolvedValue(undefined)
      mockFsUnlink.mockResolvedValue(undefined)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    function makeWorkspaceConfig(): SettingsYamlConfig {
      return {
        groups: [{
          id: 'general',
          titleKey: 'g',
          items: [
            { setting: { id: 'fontSize', titleKey: 't', type: 'number', default: 14 } },
            { setting: { id: 'language', titleKey: 't', type: 'enum', default: 'en', userOnly: true } as SettingDefinition }
          ]
        }]
      }
    }

    function createWithWorkspaceFile(fileContents: string | null): SettingsService {
      const cfg = makeWorkspaceConfig()
      const settingsPath = '/fake/settings.yaml'
      const workspaceFile = '/proj/.restorm/settings.json'
      vi.mocked(existsSync).mockImplementation((p: Parameters<typeof existsSync>[0]) => {
        const s = String(p)
        if (s === settingsPath) return true
        if (s === workspaceFile) return fileContents !== null
        return false
      })
      vi.mocked(readFileSync).mockImplementation((p: Parameters<typeof readFileSync>[0]) => {
        const s = String(p)
        if (s === settingsPath) return 'yaml-placeholder'
        if (s === workspaceFile) return fileContents ?? ''
        return ''
      })
      vi.mocked(yaml.load).mockReturnValue(cfg)
      return new SettingsService(settingsPath)
    }

    it('returns null workspace path before any project is opened', () => {
      const s = createService()
      expect(s.getWorkspacePath()).toBeNull()
      expect(s.getWorkspaceValues()).toEqual({})
    })

    it('loads keys from .restorm/settings.json on setWorkspacePath', () => {
      const s = createWithWorkspaceFile(JSON.stringify({ 'general:fontSize': 16 }))
      s.setWorkspacePath('/proj')
      expect(s.getWorkspacePath()).toBe('/proj')
      expect(s.getWorkspaceValue('general:fontSize')).toBe(16)
    })

    it('drops userOnly keys from a workspace file with a warning', () => {
      const s = createWithWorkspaceFile(JSON.stringify({
        'general:fontSize': 16,
        'general:language': 'fr'
      }))
      s.setWorkspacePath('/proj')
      expect(s.getWorkspaceValue('general:fontSize')).toBe(16)
      expect(s.getWorkspaceValue('general:language')).toBeUndefined()
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('userOnly'),
        expect.objectContaining({ key: 'general:language' })
      )
    })

    it('effective value priority: workspace > user > default', () => {
      const s = createWithWorkspaceFile(JSON.stringify({ 'general:fontSize': 18 }))
      s.setWorkspacePath('/proj')
      mockStorageGet.mockImplementation((k: string) => k === 'settings:general:fontSize' ? 16 : undefined)
      expect(s.get('general:fontSize')).toBe(18)
      expect(s.getResolvedValue('general:fontSize')).toEqual({
        storageKey: 'general:fontSize',
        effective: 18,
        source: 'workspace',
        overriddenBy: 'workspace'
      })
    })

    it('falls back to user when no workspace value, then to default', () => {
      const s = createWithWorkspaceFile(null)
      s.setWorkspacePath('/proj')
      mockStorageGet.mockImplementation((k: string) => k === 'settings:general:fontSize' ? 16 : undefined)
      expect(s.getResolvedValue('general:fontSize')).toEqual({
        storageKey: 'general:fontSize',
        effective: 16,
        source: 'user'
      })
      mockStorageGet.mockReturnValue(undefined)
      expect(s.getResolvedValue('general:fontSize')).toEqual({
        storageKey: 'general:fontSize',
        effective: 14,
        source: 'default'
      })
    })

    it('userOnly settings always read from user / default, never workspace', () => {
      const s = createWithWorkspaceFile(JSON.stringify({ 'general:language': 'fr' }))
      s.setWorkspacePath('/proj')
      // The load step already filtered userOnly keys, but `get` is also defensive.
      expect(s.get('general:language')).toBe('en')
    })

    it('setWorkspaceValue writes a sparse file after the debounce window', async () => {
      const s = createWithWorkspaceFile(null)
      s.setWorkspacePath('/proj')
      s.setWorkspaceValue('general:fontSize', 18)
      expect(mockAtomicWriteFile).not.toHaveBeenCalled()
      vi.advanceTimersByTime(199)
      expect(mockAtomicWriteFile).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      await vi.waitFor(() => {
        expect(mockAtomicWriteFile).toHaveBeenCalledTimes(1)
      })
      const firstCall = mockAtomicWriteFile.mock.calls[0]
      if (!firstCall) throw new Error('expected at least one atomic write')
      expect(JSON.parse(firstCall[1])).toEqual({ 'general:fontSize': 18 })
    })

    it('rapid setWorkspaceValue calls collapse into one write', async () => {
      const s = createWithWorkspaceFile(null)
      s.setWorkspacePath('/proj')
      s.setWorkspaceValue('general:fontSize', 16)
      s.setWorkspaceValue('general:fontSize', 18)
      s.setWorkspaceValue('general:fontSize', 20)
      vi.advanceTimersByTime(200)
      await vi.waitFor(() => {
        expect(mockAtomicWriteFile).toHaveBeenCalledTimes(1)
      })
      const firstCall = mockAtomicWriteFile.mock.calls[0]
      if (!firstCall) throw new Error('expected at least one atomic write')
      expect(JSON.parse(firstCall[1])).toEqual({ 'general:fontSize': 20 })
    })

    it('setWorkspaceValue rejects userOnly keys', () => {
      const s = createWithWorkspaceFile(null)
      s.setWorkspacePath('/proj')
      s.setWorkspaceValue('general:language', 'fr')
      expect(s.getWorkspaceValue('general:language')).toBeUndefined()
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Cannot set userOnly setting'),
        expect.objectContaining({ storageKey: 'general:language' })
      )
    })

    it('resetWorkspaceValue removes the key and re-broadcasts the effective value', async () => {
      const s = createWithWorkspaceFile(JSON.stringify({ 'general:fontSize': 18 }))
      s.setWorkspacePath('/proj')
      s.resetWorkspaceValue('general:fontSize')
      expect(s.getWorkspaceValue('general:fontSize')).toBeUndefined()
      vi.advanceTimersByTime(200)
      await vi.waitFor(() => {
        expect(mockFsUnlink).toHaveBeenCalled()
      })
    })

    it('flush deletes the workspace file when the overlay becomes empty', async () => {
      const s = createWithWorkspaceFile(JSON.stringify({ 'general:fontSize': 18 }))
      s.setWorkspacePath('/proj')
      s.resetWorkspaceValue('general:fontSize')
      vi.advanceTimersByTime(200)
      await vi.waitFor(() => {
        expect(mockFsUnlink).toHaveBeenCalledWith('/proj/.restorm/settings.json')
      })
      expect(mockAtomicWriteFile).not.toHaveBeenCalled()
    })

    it('unsetWorkspacePath drops the overlay and re-emits effective values', () => {
      const s = createWithWorkspaceFile(JSON.stringify({ 'general:fontSize': 18 }))
      s.setWorkspacePath('/proj')
      mockStorageGet.mockImplementation((k: string) => k === 'settings:general:fontSize' ? 16 : undefined)
      s.unsetWorkspacePath()
      expect(s.getWorkspacePath()).toBeNull()
      expect(s.getWorkspaceValues()).toEqual({})
      expect(s.get('general:fontSize')).toBe(16)
    })

    it('unsetWorkspacePath flushes a pending debounced write', async () => {
      const s = createWithWorkspaceFile(null)
      s.setWorkspacePath('/proj')
      s.setWorkspaceValue('general:fontSize', 22)
      // Timer hasn't fired yet — closing the project must not lose the
      // value. Without the flush, the write would be silently dropped.
      expect(mockAtomicWriteFile).not.toHaveBeenCalled()
      s.unsetWorkspacePath()
      await vi.waitFor(() => {
        expect(mockAtomicWriteFile).toHaveBeenCalledTimes(1)
      })
      const firstCall = mockAtomicWriteFile.mock.calls[0]
      if (!firstCall) throw new Error('expected at least one atomic write')
      expect(firstCall[0]).toBe('/proj/.restorm/settings.json')
      expect(JSON.parse(firstCall[1])).toEqual({ 'general:fontSize': 22 })
    })

    it('re-setting the same workspace path is idempotent (no duplicate load)', () => {
      const s = createWithWorkspaceFile(JSON.stringify({ 'general:fontSize': 18 }))
      s.setWorkspacePath('/proj')
      vi.mocked(readFileSync).mockClear()
      s.setWorkspacePath('/proj')
      // Second call should not have re-read the workspace file.
      const calls = vi.mocked(readFileSync).mock.calls.map((c) => String(c[0]))
      expect(calls).not.toContain('/proj/.restorm/settings.json')
    })

    it('switching workspace path replaces the overlay', () => {
      const cfg = makeWorkspaceConfig()
      vi.mocked(existsSync).mockImplementation((p: Parameters<typeof existsSync>[0]) => {
        const s = String(p)
        return s === '/fake/settings.yaml' || s === '/p1/.restorm/settings.json' || s === '/p2/.restorm/settings.json'
      })
      vi.mocked(readFileSync).mockImplementation((p: Parameters<typeof readFileSync>[0]) => {
        const s = String(p)
        if (s === '/fake/settings.yaml') return 'yaml'
        if (s === '/p1/.restorm/settings.json') return JSON.stringify({ 'general:fontSize': 11 })
        if (s === '/p2/.restorm/settings.json') return JSON.stringify({ 'general:fontSize': 22 })
        return ''
      })
      vi.mocked(yaml.load).mockReturnValue(cfg)
      const s = new SettingsService('/fake/settings.yaml')
      s.setWorkspacePath('/p1')
      expect(s.getWorkspaceValue('general:fontSize')).toBe(11)
      s.setWorkspacePath('/p2')
      expect(s.getWorkspaceValue('general:fontSize')).toBe(22)
    })
  })

  describe('feature-gating', () => {
    function makeFeatureGatedConfig(): SettingsYamlConfig {
      return {
        groups: [
          {
            id: 'appearance',
            titleKey: 'settings.appearance',
            items: [
              {
                setting: {
                  id: 'theme',
                  titleKey: 'settings.theme',
                  type: 'enum',
                  default: 'light'
                }
              },
              {
                setting: {
                  id: 'effects',
                  titleKey: 'settings.effects',
                  type: 'toggle',
                  default: true,
                  feature: 'advancedEffects',
                  featureDisabledDefault: false
                }
              }
            ]
          }
        ]
      }
    }

    function makeNestedFeatureGatedConfig(): SettingsYamlConfig {
      return {
        groups: [
          {
            id: 'root',
            titleKey: 'settings.root',
            items: [
              {
                group: {
                  id: 'experimental',
                  titleKey: 'settings.experimental',
                  items: [
                    {
                      setting: {
                        id: 'beta',
                        titleKey: 'settings.beta',
                        type: 'toggle',
                        default: true,
                        feature: 'betaFeature',
                        featureDisabledDefault: false
                      }
                    }
                  ]
                }
              },
              {
                setting: {
                  id: 'stable',
                  titleKey: 'settings.stable',
                  type: 'text',
                  default: 'ok'
                }
              }
            ]
          }
        ]
      }
    }

    describe('get()', () => {
      it('returns featureDisabledDefault when feature is disabled', () => {
        mockIsEnabled.mockReturnValue(false)
        const service = createService(makeFeatureGatedConfig())
        mockStorageGet.mockReturnValue(true) // stored value should be ignored

        expect(service.get('appearance:effects')).toBe(false)
      })

      it('returns stored value when feature is enabled', () => {
        mockIsEnabled.mockReturnValue(true)
        const service = createService(makeFeatureGatedConfig())
        mockStorageGet.mockReturnValue('dark')

        expect(service.get('appearance:effects')).toBe('dark')
      })

      it('returns default when feature is disabled and no featureDisabledDefault', () => {
        mockIsEnabled.mockReturnValue(false)
        const config: SettingsYamlConfig = {
          groups: [
            {
              id: 'g',
              titleKey: 'g',
              items: [
                {
                  setting: {
                    id: 's',
                    titleKey: 's',
                    type: 'toggle',
                    default: true,
                    feature: 'someFeature'
                  }
                }
              ]
            }
          ]
        }
        const service = createService(config)

        expect(service.get('g:s')).toBe(true) // falls back to setting.default
      })

      it('returns featureDisabledDefault when feature service is not initialized', () => {
        mockIsFeatureServiceInitialized.mockReturnValue(false)
        const service = createService(makeFeatureGatedConfig())
        mockStorageGet.mockReturnValue(true) // stored value ignored

        expect(service.get('appearance:effects')).toBe(false)
      })

      it('returns stored value for settings without feature field regardless of feature service state', () => {
        mockIsEnabled.mockReturnValue(false) // other features disabled
        const service = createService(makeFeatureGatedConfig())
        mockStorageGet.mockReturnValue('dark')

        // Non-feature-gated setting still returns stored value
        expect(service.get('appearance:theme')).toBe('dark')
      })
    })

    describe('flattenSettings / getAll()', () => {
      it('returns featureDisabledDefault and isModified=false when feature disabled', () => {
        mockIsEnabled.mockReturnValue(false)
        mockStorageGet.mockReturnValue(true) // stored value should be ignored

        const service = createService(makeFeatureGatedConfig())
        const all = service.getAll()

        const effects = all.find(s => s.storageKey === 'appearance:effects')
        expect(effects?.currentValue).toBe(false)
        expect(effects?.isModified).toBe(false)
      })

      it('returns stored value and isModified=true when feature enabled and value differs from default', () => {
        mockIsEnabled.mockReturnValue(true)
        mockStorageGet.mockImplementation((key: string) => {
          if (key === 'settings:appearance:effects') return false
          return undefined
        })

        const service = createService(makeFeatureGatedConfig())
        const all = service.getAll()

        const effects = all.find(s => s.storageKey === 'appearance:effects')
        expect(effects?.currentValue).toBe(false)
        expect(effects?.isModified).toBe(true)
      })

      it('includes all settings regardless of feature state', () => {
        mockIsEnabled.mockReturnValue(false)

        const service = createService(makeFeatureGatedConfig())
        const all = service.getAll()

        expect(all).toHaveLength(2)
        expect(all.some(s => s.id === 'effects')).toBe(true)
        expect(all.some(s => s.id === 'theme')).toBe(true)
      })
    })

    describe('getFilteredGroups()', () => {
      it('removes feature-gated settings when feature is disabled', () => {
        mockIsEnabled.mockReturnValue(false)

        const service = createService(makeFeatureGatedConfig())
        const filtered = service.getFilteredGroups()

        expect(filtered).toHaveLength(1)
        expect(filtered[0]?.items).toHaveLength(1)
        expect((filtered[0]?.items[0] as { setting: SettingDefinition }).setting.id).toBe('theme')
      })

      it('includes feature-gated settings when feature is enabled', () => {
        mockIsEnabled.mockReturnValue(true)

        const service = createService(makeFeatureGatedConfig())
        const filtered = service.getFilteredGroups()

        expect(filtered).toHaveLength(1)
        expect(filtered[0]?.items).toHaveLength(2)
      })

      it('removes groups that become empty after filtering', () => {
        mockIsEnabled.mockReturnValue(false)

        const service = createService(makeNestedFeatureGatedConfig())
        const filtered = service.getFilteredGroups()

        // The 'experimental' nested group should be gone (only had the gated setting)
        expect(filtered).toHaveLength(1)
        const rootGroup = filtered[0]
        expect(rootGroup).toBeDefined()
        expect(rootGroup?.items).toHaveLength(1)
        expect((rootGroup?.items[0] as { setting: SettingDefinition }).setting.id).toBe('stable')
      })

      it('preserves nested groups when their feature-gated settings are enabled', () => {
        mockIsEnabled.mockReturnValue(true)

        const service = createService(makeNestedFeatureGatedConfig())
        const filtered = service.getFilteredGroups()

        expect(filtered).toHaveLength(1)
        const rootGroup = filtered[0]
        expect(rootGroup).toBeDefined()
        expect(rootGroup?.items).toHaveLength(2)
      })

      it('does not mutate the original groups', () => {
        mockIsEnabled.mockReturnValue(false)

        const service = createService(makeFeatureGatedConfig())
        service.getFilteredGroups()

        // Original groups should still have both items
        const rawGroups = service.getGroups()
        expect(rawGroups[0]?.items).toHaveLength(2)
      })

      it('returns empty array when all groups become empty', () => {
        mockIsEnabled.mockReturnValue(false)
        const config: SettingsYamlConfig = {
          groups: [
            {
              id: 'onlyGated',
              titleKey: 'settings.onlyGated',
              items: [
                {
                  setting: {
                    id: 'gated',
                    titleKey: 'settings.gated',
                    type: 'toggle',
                    default: true,
                    feature: 'someFeature',
                    featureDisabledDefault: false
                  }
                }
              ]
            }
          ]
        }

        const service = createService(config)
        const filtered = service.getFilteredGroups()

        expect(filtered).toEqual([])
      })
    })

    describe('getFiltered()', () => {
      it('drops feature-gated settings that getAll() still returns', () => {
        mockIsEnabled.mockReturnValue(false)

        const service = createService(makeFeatureGatedConfig())

        expect(service.getAll().map(s => s.id)).toEqual(['theme', 'effects'])
        expect(service.getFiltered().map(s => s.id)).toEqual(['theme'])
      })

      it('keeps them when the feature is enabled', () => {
        mockIsEnabled.mockReturnValue(true)

        const service = createService(makeFeatureGatedConfig())

        expect(service.getFiltered().map(s => s.id)).toEqual(['theme', 'effects'])
      })

      it('resolves storage keys through the nested group path', () => {
        mockIsEnabled.mockReturnValue(true)

        const service = createService(makeNestedFeatureGatedConfig())

        expect(service.getFiltered().map(s => s.storageKey)).toEqual([
          'root.experimental:beta',
          'root:stable'
        ])
      })

      it('omits a nested group whose only settings are gated off', () => {
        mockIsEnabled.mockReturnValue(false)

        const service = createService(makeNestedFeatureGatedConfig())

        expect(service.getFiltered().map(s => s.storageKey)).toEqual(['root:stable'])
      })
    })
  })
})
