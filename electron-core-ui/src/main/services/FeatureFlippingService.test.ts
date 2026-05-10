import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import yaml from 'js-yaml'

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
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

import { existsSync, readFileSync } from 'fs'
import { FeatureFlippingService, initFeatureService, getFeatureService, isFeatureServiceInitialized, resetFeatureService } from './FeatureFlippingService'
import { logger } from './LoggerService'
import type { FeaturesYamlConfig } from '../../types/feature'

/** Helper to create a YAML config string */
function makeYaml(config: FeaturesYamlConfig): string {
  return yaml.dump(config)
}

describe('FeatureFlippingService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------
  // Basic strategy enabled/disabled
  // ---------------------------------------------------------------
  describe('basic strategy', () => {
    it('returns true when Basic strategy is enabled', () => {
      const config: FeaturesYamlConfig = {
        Features: [
          { Name: 'dark-mode', Strategies: [{ Type: 'Basic', Enabled: true }] }
        ]
      }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(makeYaml(config))

      const service = new FeatureFlippingService('/fake/features.yml')

      expect(service.isEnabled('dark-mode')).toBe(true)
    })

    it('returns false when Basic strategy is disabled', () => {
      const config: FeaturesYamlConfig = {
        Features: [
          { Name: 'beta', Strategies: [{ Type: 'Basic', Enabled: false }] }
        ]
      }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(makeYaml(config))

      const service = new FeatureFlippingService('/fake/features.yml')

      expect(service.isEnabled('beta')).toBe(false)
    })
  })

  // ---------------------------------------------------------------
  // Platform strategy
  // ---------------------------------------------------------------
  describe('platform strategy', () => {
    it('returns true when current platform is in AvailableOn', () => {
      const config: FeaturesYamlConfig = {
        Features: [
          { Name: 'desktop-only', Strategies: [{ Type: 'Platform', AvailableOn: ['desktop'] }] }
        ]
      }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(makeYaml(config))

      const service = new FeatureFlippingService('/fake/features.yml', 'desktop')

      expect(service.isEnabled('desktop-only')).toBe(true)
    })

    it('returns false when current platform is not in AvailableOn', () => {
      const config: FeaturesYamlConfig = {
        Features: [
          { Name: 'web-only', Strategies: [{ Type: 'Platform', AvailableOn: ['web'] }] }
        ]
      }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(makeYaml(config))

      const service = new FeatureFlippingService('/fake/features.yml', 'desktop')

      expect(service.isEnabled('web-only')).toBe(false)
    })
  })

  // ---------------------------------------------------------------
  // Environment strategy
  // ---------------------------------------------------------------
  describe('environment strategy', () => {
    it('returns true when current environment matches AvailableIn', () => {
      const config: FeaturesYamlConfig = {
        Features: [
          { Name: 'dev-only', Strategies: [{ Type: 'Environment', AvailableIn: ['dev'] }] }
        ]
      }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(makeYaml(config))

      const service = new FeatureFlippingService('/fake/features.yml', 'desktop', 'dev')

      expect(service.isEnabled('dev-only')).toBe(true)
    })

    it('returns false when current environment is not in AvailableIn', () => {
      const config: FeaturesYamlConfig = {
        Features: [
          { Name: 'dev-only', Strategies: [{ Type: 'Environment', AvailableIn: ['dev'] }] }
        ]
      }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(makeYaml(config))

      const service = new FeatureFlippingService('/fake/features.yml', 'desktop', 'prod')

      expect(service.isEnabled('dev-only')).toBe(false)
    })

    it('defaults environment to "prod" when not specified', () => {
      const config: FeaturesYamlConfig = {
        Features: [
          { Name: 'dev-only', Strategies: [{ Type: 'Environment', AvailableIn: ['dev'] }] },
          { Name: 'prod-only', Strategies: [{ Type: 'Environment', AvailableIn: ['prod'] }] }
        ]
      }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(makeYaml(config))

      const service = new FeatureFlippingService('/fake/features.yml', 'desktop')

      expect(service.isEnabled('dev-only')).toBe(false)
      expect(service.isEnabled('prod-only')).toBe(true)
      expect(service.getEnvironment()).toBe('prod')
    })

    it('AND-combines with Platform: dev + desktop only', () => {
      const config: FeaturesYamlConfig = {
        Features: [
          {
            Name: 'dev-desktop-only',
            Strategies: [
              { Type: 'Environment', AvailableIn: ['dev'] },
              { Type: 'Platform', AvailableOn: ['desktop'] }
            ]
          }
        ]
      }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(makeYaml(config))

      const devDesktop = new FeatureFlippingService('/fake/features.yml', 'desktop', 'dev')
      expect(devDesktop.isEnabled('dev-desktop-only')).toBe(true)

      const prodDesktop = new FeatureFlippingService('/fake/features.yml', 'desktop', 'prod')
      expect(prodDesktop.isEnabled('dev-desktop-only')).toBe(false)

      const devWeb = new FeatureFlippingService('/fake/features.yml', 'web', 'dev')
      expect(devWeb.isEnabled('dev-desktop-only')).toBe(false)
    })
  })

  // ---------------------------------------------------------------
  // Multiple strategies (AND logic)
  // ---------------------------------------------------------------
  describe('multiple strategies (AND logic)', () => {
    it('returns true only when ALL strategies pass', () => {
      const config: FeaturesYamlConfig = {
        Features: [
          {
            Name: 'combo',
            Strategies: [
              { Type: 'Basic', Enabled: true },
              { Type: 'Platform', AvailableOn: ['desktop'] }
            ]
          }
        ]
      }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(makeYaml(config))

      const service = new FeatureFlippingService('/fake/features.yml', 'desktop')

      expect(service.isEnabled('combo')).toBe(true)
    })

    it('returns false when one strategy fails', () => {
      const config: FeaturesYamlConfig = {
        Features: [
          {
            Name: 'combo-fail',
            Strategies: [
              { Type: 'Basic', Enabled: true },
              { Type: 'Platform', AvailableOn: ['web'] }
            ]
          }
        ]
      }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(makeYaml(config))

      const service = new FeatureFlippingService('/fake/features.yml', 'desktop')

      expect(service.isEnabled('combo-fail')).toBe(false)
    })
  })

  // ---------------------------------------------------------------
  // Unknown feature returns false
  // ---------------------------------------------------------------
  describe('unknown feature', () => {
    it('returns false and logs warning for unknown feature', () => {
      const config: FeaturesYamlConfig = { Features: [] }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(makeYaml(config))

      const service = new FeatureFlippingService('/fake/features.yml')

      expect(service.isEnabled('nonexistent')).toBe(false)
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Feature not found'))
    })
  })

  // ---------------------------------------------------------------
  // Empty strategies returns false
  // ---------------------------------------------------------------
  describe('empty strategies', () => {
    it('returns false when feature has no strategies', () => {
      const config: FeaturesYamlConfig = {
        Features: [{ Name: 'empty', Strategies: [] }]
      }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(makeYaml(config))

      const service = new FeatureFlippingService('/fake/features.yml')

      expect(service.isEnabled('empty')).toBe(false)
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no strategies defined'))
    })
  })

  // ---------------------------------------------------------------
  // Missing config file
  // ---------------------------------------------------------------
  describe('missing config file', () => {
    it('loads no features and logs warning', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const service = new FeatureFlippingService('/fake/missing.yml')

      expect(service.listFeatures()).toEqual([])
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not found'))
    })
  })

  // ---------------------------------------------------------------
  // Utility methods
  // ---------------------------------------------------------------
  describe('utility methods', () => {
    it('getPlatform returns the configured platform', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const service = new FeatureFlippingService('/fake/f.yml', 'web')

      expect(service.getPlatform()).toBe('web')
    })

    it('listFeatures returns all feature names', () => {
      const config: FeaturesYamlConfig = {
        Features: [
          { Name: 'a', Strategies: [{ Type: 'Basic', Enabled: true }] },
          { Name: 'b', Strategies: [{ Type: 'Basic', Enabled: false }] }
        ]
      }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(makeYaml(config))

      const service = new FeatureFlippingService('/fake/features.yml')

      expect(service.listFeatures()).toEqual(['a', 'b'])
    })
  })

  // ---------------------------------------------------------------
  // loadAdditionalConfig — merge behavior
  // ---------------------------------------------------------------
  describe('loadAdditionalConfig', () => {
    it('merges new features into existing ones', () => {
      const defaultConfig: FeaturesYamlConfig = {
        Features: [
          { Name: 'feat-a', Strategies: [{ Type: 'Basic', Enabled: true }] }
        ]
      }
      const appConfig: FeaturesYamlConfig = {
        Features: [
          { Name: 'feat-b', Strategies: [{ Type: 'Basic', Enabled: false }] }
        ]
      }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync)
        .mockReturnValueOnce(makeYaml(defaultConfig))
        .mockReturnValueOnce(makeYaml(appConfig))

      const service = new FeatureFlippingService('/fake/default.yml')
      service.loadAdditionalConfig('/fake/app.yml')

      expect(service.listFeatures()).toEqual(['feat-a', 'feat-b'])
      expect(service.isEnabled('feat-a')).toBe(true)
      expect(service.isEnabled('feat-b')).toBe(false)
    })

    it('overrides existing feature by Name (last wins)', () => {
      const defaultConfig: FeaturesYamlConfig = {
        Features: [
          { Name: 'shared', Strategies: [{ Type: 'Basic', Enabled: false }] }
        ]
      }
      const appConfig: FeaturesYamlConfig = {
        Features: [
          { Name: 'shared', Strategies: [{ Type: 'Basic', Enabled: true }] }
        ]
      }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync)
        .mockReturnValueOnce(makeYaml(defaultConfig))
        .mockReturnValueOnce(makeYaml(appConfig))

      const service = new FeatureFlippingService('/fake/default.yml')

      // Before merge: disabled
      expect(service.isEnabled('shared')).toBe(false)

      service.loadAdditionalConfig('/fake/app.yml')

      // After merge: overridden to enabled
      expect(service.isEnabled('shared')).toBe(true)
    })

    it('handles missing additional config file gracefully', () => {
      const defaultConfig: FeaturesYamlConfig = {
        Features: [
          { Name: 'feat-a', Strategies: [{ Type: 'Basic', Enabled: true }] }
        ]
      }
      vi.mocked(existsSync)
        .mockReturnValueOnce(true)   // default config exists
        .mockReturnValueOnce(false)  // additional config missing
      vi.mocked(readFileSync).mockReturnValue(makeYaml(defaultConfig))

      const service = new FeatureFlippingService('/fake/default.yml')
      service.loadAdditionalConfig('/fake/missing.yml')

      // Original features still intact
      expect(service.listFeatures()).toEqual(['feat-a'])
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not found'))
    })

    it('handles invalid additional config gracefully', () => {
      const defaultConfig: FeaturesYamlConfig = {
        Features: [
          { Name: 'feat-a', Strategies: [{ Type: 'Basic', Enabled: true }] }
        ]
      }
      const invalidConfig = yaml.dump({ NotFeatures: 'wrong shape' })
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync)
        .mockReturnValueOnce(makeYaml(defaultConfig))
        .mockReturnValueOnce(invalidConfig)

      const service = new FeatureFlippingService('/fake/default.yml')
      service.loadAdditionalConfig('/fake/bad.yml')

      // Original features still intact
      expect(service.listFeatures()).toEqual(['feat-a'])
      expect(logger.warn).toHaveBeenCalledWith('Invalid features configuration', expect.any(Object))
    })
  })

  // ---------------------------------------------------------------
  // initFeatureService — backward-compatible overloads
  // ---------------------------------------------------------------
  describe('initFeatureService', () => {
    beforeEach(() => {
      resetFeatureService()
    })

    afterEach(() => {
      resetFeatureService()
    })

    it('legacy call: initFeatureService(path, platform) works', () => {
      const config: FeaturesYamlConfig = {
        Features: [
          { Name: 'feat', Strategies: [{ Type: 'Platform', AvailableOn: ['web'] }] }
        ]
      }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(makeYaml(config))

      const service = initFeatureService('/fake/features.yml', 'web')

      expect(service.getPlatform()).toBe('web')
      expect(service.isEnabled('feat')).toBe(true)
      expect(isFeatureServiceInitialized()).toBe(true)
      expect(getFeatureService()).toBe(service)
    })

    it('legacy call: initFeatureService(path) defaults platform to desktop', () => {
      const config: FeaturesYamlConfig = {
        Features: [
          { Name: 'feat', Strategies: [{ Type: 'Platform', AvailableOn: ['desktop'] }] }
        ]
      }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(makeYaml(config))

      const service = initFeatureService('/fake/features.yml')

      expect(service.getPlatform()).toBe('desktop')
      expect(service.isEnabled('feat')).toBe(true)
    })

    it('new call: initFeatureService(defaultPath, appPath) merges configs', () => {
      const defaultConfig: FeaturesYamlConfig = {
        Features: [
          { Name: 'default-feat', Strategies: [{ Type: 'Basic', Enabled: true }] },
          { Name: 'overridden', Strategies: [{ Type: 'Basic', Enabled: false }] }
        ]
      }
      const appConfig: FeaturesYamlConfig = {
        Features: [
          { Name: 'overridden', Strategies: [{ Type: 'Basic', Enabled: true }] },
          { Name: 'app-feat', Strategies: [{ Type: 'Basic', Enabled: true }] }
        ]
      }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync)
        .mockReturnValueOnce(makeYaml(defaultConfig))
        .mockReturnValueOnce(makeYaml(appConfig))

      const service = initFeatureService('/fake/default.yml', '/fake/app.yml')

      expect(service.getPlatform()).toBe('desktop')
      expect(service.isEnabled('default-feat')).toBe(true)
      expect(service.isEnabled('overridden')).toBe(true) // overridden to true
      expect(service.isEnabled('app-feat')).toBe(true)
    })

    it('new call: initFeatureService(defaultPath, appPath, platform) sets platform', () => {
      const config: FeaturesYamlConfig = {
        Features: [
          { Name: 'feat', Strategies: [{ Type: 'Platform', AvailableOn: ['web'] }] }
        ]
      }
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(makeYaml(config))

      const service = initFeatureService('/fake/default.yml', '/fake/app.yml', 'web')

      expect(service.getPlatform()).toBe('web')
      expect(service.isEnabled('feat')).toBe(true)
    })

    it('returns existing instance if already initialized', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const first = initFeatureService('/fake/a.yml')
      const second = initFeatureService('/fake/b.yml')

      expect(second).toBe(first)
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('already initialized'))
    })
  })
})
