import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, basename, dirname } from 'path'
import yaml from 'js-yaml'
import type { ThemeInfo, ThemeVariables, ThemeDefinition } from '../../../types/theme'
import { logger } from './LoggerService'

/**
 * ThemeService manages YAML-based themes
 * - Loads theme definitions from resources/themes
 * - Parses YAML theme files with inheritance
 * - Converts colors to CSS variables
 * 
 * Theme loading cascade:
 * 1. base.yaml (common CSS variables)
 * 2. {type}/_base.yaml (type-specific defaults: dark, light, hc_dark, hc_light)
 * 3. {type}/{theme}.yaml (theme-specific overrides)
 */

interface YamlColorEntry {
  id: string
  value: string
  description?: string
}

interface YamlVariableEntry {
  id: string
  value: string
  description?: string
}

interface YamlBaseFile {
  variables?: YamlVariableEntry[]
}

interface YamlTypeBaseFile {
  colors?: YamlColorEntry[]
}

interface YamlThemeFile {
  name: string
  description?: string
  colors?: Record<string, string>
}

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

  constructor(resourcesPath: string) {
    this.themesPath = join(resourcesPath, 'themes')
    this.loadBaseFiles()
    this.discoverThemes()
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
        const data = yaml.load(content) as YamlBaseFile
        if (data.variables) {
          for (const variable of data.variables) {
            // Convert to CSS variable format
            const cssVar = `--${variable.id}`
            this.baseVariables[cssVar] = variable.value
          }
        }
        logger.debug(`Loaded base.yaml with ${Object.keys(this.baseVariables).length} variables`)
      } catch (error) {
        logger.error(`Failed to load base.yaml`, { error: String(error) })
      }
    }

    // Load type-specific _base.yaml files
    for (const themeType of THEME_TYPES) {
      const typeBasePath = join(this.themesPath, themeType, '_base.yaml')
      if (existsSync(typeBasePath)) {
        try {
          const content = readFileSync(typeBasePath, 'utf-8')
          const data = yaml.load(content) as YamlTypeBaseFile
          if (data.colors) {
            for (const color of data.colors) {
              // Convert to CSS variable format (vscode style)
              const cssVar = `--vscode-${color.id.replace(/\./g, '-')}`
              this.typeBaseColors[themeType][cssVar] = color.value
            }
          }
          logger.debug(`Loaded ${themeType}/_base.yaml with ${Object.keys(this.typeBaseColors[themeType]).length} colors`)
        } catch (error) {
          logger.error(`Failed to load ${themeType}/_base.yaml`, { error: String(error) })
        }
      }
    }
  }

  /**
   * Discover all available themes from YAML files
   */
  private discoverThemes(): void {
    if (!existsSync(this.themesPath)) {
      logger.warn(`Themes directory not found: ${this.themesPath}`)
      return
    }

    for (const themeType of THEME_TYPES) {
      const typePath = join(this.themesPath, themeType)
      if (!existsSync(typePath)) {
        continue
      }

      const files = readdirSync(typePath, { withFileTypes: true })
        .filter((dirent) => dirent.isFile() && dirent.name.endsWith('.yaml') && dirent.name !== '_base.yaml')
        .map((dirent) => dirent.name)

      for (const file of files) {
        const themePath = join(typePath, file)
        try {
          const content = readFileSync(themePath, 'utf-8')
          const data = yaml.load(content) as YamlThemeFile
          
          if (!data.name) {
            logger.warn(`Theme file ${file} missing 'name' property, skipping`)
            continue
          }

          const themeId = `${themeType}/${basename(file, '.yaml')}`
          
          this.themes.set(themeId, {
            id: themeId,
            name: data.name,
            type: this.mapThemeType(themeType),
            path: themePath
          })
        } catch (error) {
          logger.error(`Failed to parse theme ${file}`, { error: String(error) })
        }
      }
    }

    logger.info(`Discovered ${this.themes.size} YAML themes`)
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
        if (cssVar.startsWith('--vscode-')) {
          const key = cssVar.slice(9).replace(/-/g, '.')
          colors[key] = value
        }
      }

      // Load and apply theme-specific colors
      const content = readFileSync(themeInfo.path, 'utf-8')
      const data = yaml.load(content) as YamlThemeFile

      if (data.colors) {
        for (const [key, value] of Object.entries(data.colors)) {
          const cssVar = `--vscode-${key.replace(/\./g, '-')}`
          variables[cssVar] = value
          colors[key] = value
        }
      }

      const theme: ThemeDefinition = {
        name: data.name,
        type: themeInfo.type,
        colors
      }

      return { theme, variables }
    } catch (error) {
      logger.error(`Failed to load theme ${themeId}`, { error: String(error) })
      return null
    }
  }

  /**
   * Load a specific theme by ID (legacy compatibility)
   */
  public loadTheme(themeId: string): { name: string; type: 'dark' | 'light' | 'hcDark' | 'hcLight'; colors?: Record<string, string> } | null {
    const result = this.getThemeWithVariables(themeId)
    if (!result) {
      return null
    }
    
    // Convert CSS variables back to colors format for legacy compatibility
    const colors: Record<string, string> = {}
    for (const [cssVar, value] of Object.entries(result.variables)) {
      if (cssVar.startsWith('--vscode-')) {
        const key = cssVar.slice(9).replace(/-/g, '.')
        colors[key] = value
      }
    }

    return {
      name: result.theme.name,
      type: result.theme.type ?? 'dark',
      colors
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
        const cssVar = `--vscode-${key.replace(/\./g, '-')}`
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
    themeServiceInstance = new ThemeService(resourcesPath)
  }
  return themeServiceInstance
}
