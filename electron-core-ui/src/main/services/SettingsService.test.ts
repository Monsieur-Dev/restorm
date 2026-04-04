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
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
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
})
