import { readFileSync, existsSync } from 'fs'
import { join, dirname, basename } from 'path'
import { loadYamlDocument } from '../../shared/yamlLoad'
import type { ThemeInfo, ThemeVariables, ThemeDefinition } from '../../types/theme'
import { logger } from './LoggerService'
import { FileSystemError, errorMeta } from '../../errors'
import { yamlBaseFileSchema, yamlTypeBaseFileSchema, yamlThemeFileSchema, themeIndexSchema } from '../schemas/configSchemas'

/**
 * ThemeService manages YAML-based themes
 * - Loads theme definitions from resources/themes
 * - Uses index.json for fast theme discovery (no YAML parsing at startup)
 * - Parses YAML theme files with inheritance on demand
 * - Converts colors to CSS variables
 * 
 * Theme loading cascade:
 * 1. base.yaml (common CSS variables)
 * 2. {type}/_base.yaml (type-specific defaults: dark, light, hc_dark, hc_light)
 * 3. {type}/{theme}.yaml (theme-specific overrides)
 */

type ThemeType = 'dark' | 'light' | 'hc_dark' | 'hc_light'

const THEME_TYPES: ThemeType[] = ['dark', 'light', 'hc_dark', 'hc_light']

export class ThemeService {
  private themesPath: string
  private themes = new Map<string, ThemeInfo>()
  private baseVariables: Record<string, string> = {}
  private typeBaseColors: Record<ThemeType, Record<string, string>> = {
    dark: {},
    light: {},
    hc_dark: {},
    hc_light: {}
  }
  /**
   * Cache for fully resolved themes (parsed YAML + merged variables).
   * Keyed by themeId to avoid re-reading and re-parsing the same YAML file.
   */
  private themeCache = new Map<string, { theme: ThemeDefinition; variables: ThemeVariables }>()

  constructor(resourcesPath: string) {
    const constructorStart = performance.now()
    void constructorStart

    this.themesPath = join(resourcesPath, 'themes')
    
    this.loadBaseFiles()
    this.discoverThemes()
    this.preloadAllThemes()
  }

  /**
   * Load base.yaml and all _base.yaml files
   */
  private loadBaseFiles(): void {
    // Load base.yaml (common variables)
    const basePath = join(this.themesPath, 'base.yaml')
    if (existsSync(basePath)) {
      try {
        const content = readFileSync(basePath, 'utf-8')
        const raw = loadYamlDocument(content)
        const parsed = yamlBaseFileSchema.safeParse(raw)
        if (!parsed.success) {
          logger.warn('Invalid base.yaml structure', { issues: parsed.error.issues.map(i => i.message).join('; ') })
        } else {
          const data = parsed.data
          if (data.variables) {
            for (const variable of data.variables) {
              // Convert to CSS variable format
              const cssVar = `--${variable.id}`
              this.baseVariables[cssVar] = variable.value
            }
          }
        }
      } catch (error) {
        const wrappedError = new FileSystemError('Failed to load base.yaml', 'FS_READ_FAILED', { cause: error })
        logger.error('Failed to load base.yaml', errorMeta(wrappedError))
      }
    }

    // Load type-specific _base.yaml files
    for (const themeType of THEME_TYPES) {
      const typeBasePath = join(this.themesPath, themeType, '_base.yaml')
      if (existsSync(typeBasePath)) {
        try {
          const content = readFileSync(typeBasePath, 'utf-8')
          const raw = loadYamlDocument(content)
          const parsed = yamlTypeBaseFileSchema.safeParse(raw)
          if (!parsed.success) {
            logger.warn(`Invalid ${themeType}/_base.yaml structure`, { issues: parsed.error.issues.map(i => i.message).join('; ') })
            continue
          }
          const data = parsed.data

          if (data.colors) {
            for (const color of data.colors) {
              // Convert to CSS variable format
              const cssVar = `--${color.id.replace(/\./g, '-')}`
              this.typeBaseColors[themeType][cssVar] = color.value
            }
          }
        } catch (error) {
          const wrappedError = new FileSystemError(`Failed to load ${themeType}/_base.yaml`, 'FS_READ_FAILED', { cause: error })
          logger.error(`Failed to load ${themeType}/_base.yaml`, errorMeta(wrappedError))
        }
      }
    }
  }

  /**
   * Discover all available themes from index.json
   * This avoids parsing all YAML files at startup for better performance
   */
  private discoverThemes(): void {
    const indexPath = join(this.themesPath, 'index.json')
    
    if (!existsSync(indexPath)) {
      logger.error(`Theme index not found: ${indexPath}`)
      return
    }

    try {
      const content = readFileSync(indexPath, 'utf-8')
      const raw = JSON.parse(content) as unknown
      const parsed = themeIndexSchema.safeParse(raw)
      if (!parsed.success) {
        logger.warn('Invalid theme index.json structure', { issues: parsed.error.issues.map(i => i.message).join('; ') })
        return
      }
      const index = parsed.data

      for (const entry of index.themes) {
        const themePath = join(this.themesPath, entry.file)
        
        this.themes.set(entry.id, {
          id: entry.id,
          name: entry.name,
          type: this.mapThemeType(entry.type),
          path: themePath
        })
      }
    } catch (error) {
      const wrappedError = new FileSystemError('Failed to load theme index', 'FS_PARSE_FAILED', { cause: error })
      logger.error('Failed to load theme index', errorMeta(wrappedError))
    }
  }

  /**
   * Map internal theme type to ThemeInfo type
   */
  private mapThemeType(type: ThemeType): 'dark' | 'light' | 'hcDark' | 'hcLight' {
    switch (type) {
      case 'dark': return 'dark'
      case 'light': return 'light'
      case 'hc_dark': return 'hcDark'
      case 'hc_light': return 'hcLight'
    }
  }

  /**
   * Get the internal theme type from a theme path
   */
  private getThemeType(themePath: string): ThemeType {
    const dir = basename(dirname(themePath))
    if (THEME_TYPES.includes(dir as ThemeType)) {
      return dir as ThemeType
    }
    return 'dark' // Default
  }

  /**
   * Preload and fully resolve all themes at startup.
   * This ensures every theme YAML is parsed once and
   * the final derived themes are stored in the cache map.
   */
  private preloadAllThemes(): void {
    const start = performance.now()
    for (const themeId of this.themes.keys()) {
      const result = this.getThemeWithVariables(themeId)
      if (!result) {
        logger.error(`ThemeService: failed to preload theme "${themeId}"`)
      }
    }
    const duration = performance.now() - start
    logger.info(`ThemeService: preloaded ${String(this.themeCache.size)} themes in ${duration.toFixed(2)}ms`)
  }

  /**
   * Drop the resolved-theme cache and re-read every YAML from disk. The cache
   * is otherwise populated once at startup and never invalidated, so editing a
   * theme YAML in dev was invisible until a full restart. Call this to pick up
   * on-disk theme changes (a dev reload hook, or after shipping a new theme).
   */
  public reloadThemes(): void {
    this.themeCache.clear()
    this.themes.clear()
    this.baseVariables = {}
    this.typeBaseColors = { dark: {}, light: {}, hc_dark: {}, hc_light: {} }
    this.loadBaseFiles()
    this.discoverThemes()
    this.preloadAllThemes()
  }

  /**
   * Get all available themes
   */
  public listThemes(): ThemeInfo[] {
    return Array.from(this.themes.values())
  }

  /**
   * Load a specific theme by ID and return CSS variables
   * Applies inheritance: base.yaml -> type/_base.yaml -> theme.yaml
   */
  public getThemeWithVariables(themeId: string): {
    theme: ThemeDefinition
    variables: ThemeVariables
  } | null {
    const methodStart = performance.now()
    void methodStart

    // Fast path: return cached theme if already resolved
    const cached = this.themeCache.get(themeId)
    if (cached) {
      return cached
    }
    
    const themeInfo = this.themes.get(themeId)
    if (!themeInfo) {
      logger.error(`Theme not found: "${themeId}"`)
      logger.error(`Available themes: ${Array.from(this.themes.keys()).join(', ')}`)
      return null
    }

    try {
      // Start with base variables
      const variables: ThemeVariables = { ...this.baseVariables }

      // Add type-specific base colors
      const themeType = this.getThemeType(themeInfo.path)
      Object.assign(variables, this.typeBaseColors[themeType])

      // Build colors object from base + type defaults
      const colors: Record<string, string> = {}
      
      // Add type base colors (convert CSS vars back to color keys)
      for (const [cssVar, value] of Object.entries(this.typeBaseColors[themeType])) {
        // Skip base variables (non-color variables from base.yaml)
        if (Object.keys(this.baseVariables).includes(cssVar)) {
          continue
        }
        if (cssVar.startsWith('--')) {
          const key = cssVar.slice(2).replace(/-/g, '.')
          colors[key] = value
        }
      }

      // Load and apply theme-specific colors
      const content = readFileSync(themeInfo.path, 'utf-8')
      const raw = loadYamlDocument(content)
      const parsed = yamlThemeFileSchema.safeParse(raw)
      if (!parsed.success) {
        logger.warn(`Invalid theme file for "${themeId}"`, { issues: parsed.error.issues.map(i => i.message).join('; ') })
        return null
      }
      const data = parsed.data

      if (data.colors) {
        for (const [key, value] of Object.entries(data.colors)) {
          const cssVar = `--${key.replace(/\./g, '-')}`
          variables[cssVar] = value
          colors[key] = value
        }
      }

      const theme: ThemeDefinition = {
        name: data.name,
        type: themeInfo.type,
        colors
      }

      // Cache resolved theme for future calls to avoid re-reading the YAML file
      this.themeCache.set(themeId, { theme, variables })
      return { theme, variables }
    } catch (error) {
      const wrappedError = new FileSystemError(`Failed to load theme ${themeId}`, 'FS_PARSE_FAILED', { cause: error })
      logger.error(`Failed to load theme ${themeId}`, errorMeta(wrappedError))
      return null
    }
  }

  /**
   * Convert theme colors to CSS variables (legacy compatibility)
   */
  public convertToCSSVariables(theme: { colors?: Record<string, string>; type?: 'dark' | 'light' | 'hcDark' | 'hcLight' }): ThemeVariables {
    const themeType = theme.type ?? 'dark'
    const internalType: ThemeType = themeType === 'hcDark' ? 'hc_dark' : themeType === 'hcLight' ? 'hc_light' : themeType
    
    // Start with base variables and type defaults
    const variables: ThemeVariables = { 
      ...this.baseVariables,
      ...this.typeBaseColors[internalType]
    }

    // Apply theme-specific colors
    if (theme.colors) {
      for (const [key, value] of Object.entries(theme.colors)) {
        const cssVar = `--${key.replace(/\./g, '-')}`
        variables[cssVar] = value
      }
    }

    return variables
  }
}

// Singleton instance
let themeServiceInstance: ThemeService | null = null

/**
 * Get the singleton instance of ThemeService
 */
export function getThemeService(resourcesPath?: string): ThemeService {
  if (!themeServiceInstance) {
    if (!resourcesPath) {
      throw new Error('ThemeService not initialized. Provide resourcesPath on first call.')
    }
    const start = performance.now()
    logger.info(`ThemeService: Creating singleton instance...`)
    themeServiceInstance = new ThemeService(resourcesPath)
    logger.info(`ThemeService: Singleton instance created in ${(performance.now() - start).toFixed(2)}ms`)
  }
  return themeServiceInstance
}
