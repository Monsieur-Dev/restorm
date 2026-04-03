import { describe, it, expect } from 'vitest'
import {
  yamlBaseFileSchema,
  yamlTypeBaseFileSchema,
  yamlThemeFileSchema,
  themeIndexSchema,
  featuresYamlConfigSchema,
  storageFileSchema
} from './configSchemas'

describe('Theme schemas', () => {
  describe('yamlBaseFileSchema', () => {
    it('accepts valid base file with variables', () => {
      const data = { variables: [{ id: 'font-size', value: '14px' }] }
      expect(yamlBaseFileSchema.safeParse(data).success).toBe(true)
    })

    it('accepts empty base file', () => {
      expect(yamlBaseFileSchema.safeParse({}).success).toBe(true)
    })

    it('rejects variable without id', () => {
      const data = { variables: [{ value: '14px' }] }
      expect(yamlBaseFileSchema.safeParse(data).success).toBe(false)
    })
  })

  describe('yamlTypeBaseFileSchema', () => {
    it('accepts valid type base file with colors', () => {
      const data = { colors: [{ id: 'editor.background', value: '#1e1e1e' }] }
      expect(yamlTypeBaseFileSchema.safeParse(data).success).toBe(true)
    })

    it('rejects color with non-string value', () => {
      const data = { colors: [{ id: 'editor.background', value: 123 }] }
      expect(yamlTypeBaseFileSchema.safeParse(data).success).toBe(false)
    })
  })

  describe('yamlThemeFileSchema', () => {
    it('accepts valid theme file', () => {
      const data = { name: 'Dark+', colors: { 'editor.background': '#1e1e1e' } }
      expect(yamlThemeFileSchema.safeParse(data).success).toBe(true)
    })

    it('accepts theme file without colors', () => {
      const data = { name: 'Minimal' }
      expect(yamlThemeFileSchema.safeParse(data).success).toBe(true)
    })

    it('rejects theme file without name', () => {
      const data = { colors: { 'editor.background': '#1e1e1e' } }
      expect(yamlThemeFileSchema.safeParse(data).success).toBe(false)
    })
  })

  describe('themeIndexSchema', () => {
    it('accepts valid theme index', () => {
      const data = {
        themes: [
          { id: 'dark/abyss', name: 'Abyss', type: 'dark', file: 'dark/abyss.yaml' }
        ]
      }
      expect(themeIndexSchema.safeParse(data).success).toBe(true)
    })

    it('rejects entry with invalid type', () => {
      const data = {
        themes: [
          { id: 'dark/abyss', name: 'Abyss', type: 'invalid', file: 'dark/abyss.yaml' }
        ]
      }
      expect(themeIndexSchema.safeParse(data).success).toBe(false)
    })

    it('rejects entry missing required fields', () => {
      const data = { themes: [{ id: 'dark/abyss' }] }
      expect(themeIndexSchema.safeParse(data).success).toBe(false)
    })

    it('rejects non-object', () => {
      expect(themeIndexSchema.safeParse('not an object').success).toBe(false)
    })
  })
})

describe('Feature schemas', () => {
  describe('featuresYamlConfigSchema', () => {
    it('accepts valid config with basic strategy', () => {
      const data = {
        Features: [
          { Name: 'dark-mode', Strategies: [{ Type: 'Basic', Enabled: true }] }
        ]
      }
      expect(featuresYamlConfigSchema.safeParse(data).success).toBe(true)
    })

    it('accepts valid config with platform strategy', () => {
      const data = {
        Features: [
          { Name: 'offline', Strategies: [{ Type: 'Platform', AvailableOn: ['desktop'] }] }
        ]
      }
      expect(featuresYamlConfigSchema.safeParse(data).success).toBe(true)
    })

    it('accepts feature with multiple strategies', () => {
      const data = {
        Features: [{
          Name: 'feature-x',
          Strategies: [
            { Type: 'Basic', Enabled: true },
            { Type: 'Platform', AvailableOn: ['desktop', 'web'] }
          ]
        }]
      }
      expect(featuresYamlConfigSchema.safeParse(data).success).toBe(true)
    })

    it('rejects unknown strategy type', () => {
      const data = {
        Features: [
          { Name: 'test', Strategies: [{ Type: 'Unknown', Enabled: true }] }
        ]
      }
      expect(featuresYamlConfigSchema.safeParse(data).success).toBe(false)
    })

    it('rejects invalid platform value', () => {
      const data = {
        Features: [
          { Name: 'test', Strategies: [{ Type: 'Platform', AvailableOn: ['mobile'] }] }
        ]
      }
      expect(featuresYamlConfigSchema.safeParse(data).success).toBe(false)
    })

    it('rejects feature without Name', () => {
      const data = { Features: [{ Strategies: [] }] }
      expect(featuresYamlConfigSchema.safeParse(data).success).toBe(false)
    })

    it('rejects missing Features array', () => {
      expect(featuresYamlConfigSchema.safeParse({}).success).toBe(false)
    })
  })
})

describe('Storage schema', () => {
  it('accepts valid record', () => {
    expect(storageFileSchema.safeParse({ key: 'value', num: 42 }).success).toBe(true)
  })

  it('accepts empty record', () => {
    expect(storageFileSchema.safeParse({}).success).toBe(true)
  })

  it('rejects non-object', () => {
    expect(storageFileSchema.safeParse('not an object').success).toBe(false)
  })
})
