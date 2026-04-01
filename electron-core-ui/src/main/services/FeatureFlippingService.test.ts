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
import { FeatureFlippingService } from './FeatureFlippingService'
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
})
