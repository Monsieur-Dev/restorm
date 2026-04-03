import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn()
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

import { readFileSync, existsSync } from 'fs'
import yaml from 'js-yaml'
import { ThemeService } from './ThemeService'

// ---------------------------------------------------------------------------
// Helpers – build YAML / JSON fixture data that satisfy Zod schemas
// ---------------------------------------------------------------------------

const BASE_YAML_DATA = {
  variables: [
    { id: 'font-size', value: '14px' },
    { id: 'border-radius', value: '4px' }
  ]
}

const DARK_BASE_YAML_DATA = {
  colors: [
    { id: 'editor.background', value: '#1e1e1e' },
    { id: 'editor.foreground', value: '#d4d4d4' }
  ]
}

const LIGHT_BASE_YAML_DATA = {
  colors: [
    { id: 'editor.background', value: '#ffffff' },
    { id: 'editor.foreground', value: '#000000' }
  ]
}

const INDEX_JSON = {
  themes: [
    { id: 'dark-default', name: 'Dark Default', type: 'dark', file: 'dark/default.yaml' },
    { id: 'light-default', name: 'Light Default', type: 'light', file: 'light/default.yaml' }
  ]
}

const DARK_THEME_YAML = {
  name: 'Dark Default',
  colors: {
    'editor.background': '#252526',
    'sidebar.background': '#333333'
  }
}

const LIGHT_THEME_YAML = {
  name: 'Light Default',
  colors: {
    'editor.background': '#fafafa'
  }
}

/**
 * Configure mocks to simulate a full themes directory.
 * existsSync returns true for all expected paths.
 * readFileSync / yaml.load return appropriate data based on path.
 */
function setupStandardMocks(): void {
  vi.mocked(existsSync).mockReturnValue(true)

  vi.mocked(readFileSync).mockImplementation((pathArg: Parameters<typeof readFileSync>[0]) => {
    const p = String(pathArg)
    if (p.endsWith('index.json')) return JSON.stringify(INDEX_JSON)
    // All YAML files return placeholder – yaml.load mock drives the data
    return 'yaml-placeholder'
  })

  vi.mocked(yaml.load).mockImplementation((_content: string) => {
    // We rely on readFileSync being called first – use call order to
    // determine which file is being parsed.  Simpler: track via the
    // readFileSync call history.
    const readCalls = vi.mocked(readFileSync).mock.calls
    const lastCall = readCalls[readCalls.length - 1]
    const p = lastCall ? String(lastCall[0]) : ''

    if (p.endsWith('base.yaml') && !p.includes('_base.yaml')) return BASE_YAML_DATA
    if (p.includes('dark') && p.endsWith('_base.yaml')) return DARK_BASE_YAML_DATA
    if (p.includes('light') && p.endsWith('_base.yaml')) return LIGHT_BASE_YAML_DATA
    if (p.includes('hc_dark') && p.endsWith('_base.yaml')) return { colors: [] }
    if (p.includes('hc_light') && p.endsWith('_base.yaml')) return { colors: [] }
    if (p.includes('dark/default.yaml')) return DARK_THEME_YAML
    if (p.includes('light/default.yaml')) return LIGHT_THEME_YAML
    return {}
  })
}

describe('ThemeService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------
  // listThemes()
  // ---------------------------------------------------------------
  describe('listThemes()', () => {
    it('returns all themes from index.json', () => {
      setupStandardMocks()
      const service = new ThemeService('/fake/resources')
      const themes = service.listThemes()

      expect(themes).toHaveLength(2)
      expect(themes.map(t => t.id)).toEqual(['dark-default', 'light-default'])
      expect(themes[0]).toMatchObject({
        id: 'dark-default',
        name: 'Dark Default',
        type: 'dark'
      })
      expect(themes[1]).toMatchObject({
        id: 'light-default',
        name: 'Light Default',
        type: 'light'
      })
    })

    it('returns empty list when index.json does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false)
      const service = new ThemeService('/fake/resources')

      expect(service.listThemes()).toEqual([])
    })
  })

  // ---------------------------------------------------------------
  // getThemeWithVariables()
  // ---------------------------------------------------------------
  describe('getThemeWithVariables()', () => {
    it('returns theme and CSS variables for a valid ID', () => {
      setupStandardMocks()
      const service = new ThemeService('/fake/resources')
      const result = service.getThemeWithVariables('dark-default')

      expect(result).not.toBeNull()
      if (result === null) return // narrowing guard
      expect(result.theme.name).toBe('Dark Default')
      expect(result.theme.type).toBe('dark')
      // Theme-specific colors should be present
      expect(result.variables['--editor-background']).toBe('#252526')
      expect(result.variables['--sidebar-background']).toBe('#333333')
    })

    it('returns null for an unknown theme ID', () => {
      setupStandardMocks()
      const service = new ThemeService('/fake/resources')
      const result = service.getThemeWithVariables('nonexistent-theme')

      expect(result).toBeNull()
    })
  })

  // ---------------------------------------------------------------
  // Theme inheritance: base → type base → theme-specific
  // ---------------------------------------------------------------
  describe('theme inheritance', () => {
    it('merges base variables, type base colors, and theme-specific colors', () => {
      setupStandardMocks()
      const service = new ThemeService('/fake/resources')
      const result = service.getThemeWithVariables('dark-default')

      expect(result).not.toBeNull()
      if (result === null) return // narrowing guard

      // Base variables (from base.yaml)
      expect(result.variables['--font-size']).toBe('14px')
      expect(result.variables['--border-radius']).toBe('4px')

      // Type base colors (from dark/_base.yaml) – overridden by theme
      // editor.background was #1e1e1e in _base but #252526 in theme
      expect(result.variables['--editor-background']).toBe('#252526')
      // editor.foreground is only in type base, not overridden
      expect(result.variables['--editor-foreground']).toBe('#d4d4d4')

      // Theme-specific color
      expect(result.variables['--sidebar-background']).toBe('#333333')
    })
  })

  // ---------------------------------------------------------------
  // Caching
  // ---------------------------------------------------------------
  describe('caching', () => {
    it('returns cached result on second call (no extra readFileSync)', () => {
      setupStandardMocks()
      const service = new ThemeService('/fake/resources')

      // The constructor already calls getThemeWithVariables for preloading,
      // so the theme is cached. Record calls after construction.
      const callsBefore = vi.mocked(readFileSync).mock.calls.length

      const result1 = service.getThemeWithVariables('dark-default')
      const result2 = service.getThemeWithVariables('dark-default')

      // No additional reads should happen because both calls hit cache
      expect(vi.mocked(readFileSync).mock.calls.length).toBe(callsBefore)
      expect(result1).toBe(result2) // same reference
    })
  })

  // ---------------------------------------------------------------
  // Invalid YAML graceful handling
  // ---------------------------------------------------------------
  describe('invalid YAML handling', () => {
    it('handles yaml.load throwing an error gracefully', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockImplementation((pathArg: Parameters<typeof readFileSync>[0]) => {
        const p = String(pathArg)
        if (p.endsWith('index.json')) return JSON.stringify(INDEX_JSON)
        return 'invalid-yaml'
      })
      vi.mocked(yaml.load).mockImplementation(() => {
        throw new Error('YAML parse error')
      })

      // Should not throw – errors are caught internally
      const service = new ThemeService('/fake/resources')
      expect(service.listThemes()).toHaveLength(2)

      // Theme loading returns null because YAML parsing fails
      const result = service.getThemeWithVariables('dark-default')
      expect(result).toBeNull()
    })

    it('handles theme file that fails Zod validation', () => {
      setupStandardMocks()

      // Override yaml.load to return data that is missing required "name" field
      vi.mocked(yaml.load).mockImplementation(() => {
        const readCalls = vi.mocked(readFileSync).mock.calls
        const lastCall = readCalls[readCalls.length - 1]
        const p = lastCall ? String(lastCall[0]) : ''

        if (p.endsWith('base.yaml') && !p.includes('_base.yaml')) return BASE_YAML_DATA
        if (p.endsWith('_base.yaml')) return { colors: [] }
        // Theme file: missing required "name" field
        return { colors: { 'editor.background': '#000' } }
      })

      const service = new ThemeService('/fake/resources')
      const result = service.getThemeWithVariables('dark-default')
      expect(result).toBeNull()
    })
  })
})
