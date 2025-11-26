import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import type { ThemeDefinition, ThemeInfo, ThemeVariables } from '../../../types/theme'
import { logger } from './LoggerService'

/**
 * ThemeService manages VSCode themes
 * - Loads theme definitions from resources
 * - Parses theme JSON files
 * - Converts colors to CSS variables
 */
interface PackageTheme {
  label: string
  id?: string
  uiTheme: string
  path: string
}

interface PackageJson {
  contributes?: {
    themes?: PackageTheme[]
  }
}

type PackageNLS = Record<string, string>

export class ThemeService {
  private themesPath: string
  private themes = new Map<string, ThemeInfo>()
  private loadedThemes = new Map<string, ThemeDefinition>()

  constructor(resourcesPath: string) {
    this.themesPath = join(resourcesPath, 'themes')
    this.discoverThemes()
  }

  /**
   * Resolve localized strings from package.nls.json
   */
  private resolveLocalizedString(value: string, nls: PackageNLS | null): string {
    if (!value.startsWith('%') || !nls) {
      return value
    }
    // Remove % from start and end (if present)
    const key = value.startsWith('%') && value.endsWith('%')
      ? value.slice(1, -1)
      : value.slice(1)
    
    const resolved = nls[key]
    if (resolved) {
      return resolved
    }
    
    return value
  }

  /**
   * Discover all available themes from the themes directory
   */
  private discoverThemes(): void {
    if (!existsSync(this.themesPath)) {
      logger.warn(`Themes directory not found: ${this.themesPath}`)
      return
    }

    const themeDirs = readdirSync(this.themesPath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)

    for (const themeDir of themeDirs) {
      const themePath = join(this.themesPath, themeDir)
      const packageJsonPath = join(themePath, 'package.json')

      if (existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson
          
          // Load localization file if it exists
          const nlsPath = join(themePath, 'package.nls.json')
          let nls: PackageNLS | null = null
          if (existsSync(nlsPath)) {
            nls = JSON.parse(readFileSync(nlsPath, 'utf-8')) as PackageNLS
          }
          
          if (packageJson.contributes?.themes) {
            for (const theme of packageJson.contributes.themes) {
              // Resolve localized label
              const resolvedLabel = this.resolveLocalizedString(theme.label, nls)
              const id = `${themeDir}/${theme.id ?? resolvedLabel}`
              const themeFilePath = join(this.themesPath, themeDir, theme.path)
              
              
              this.themes.set(id, {
                id,
                name: resolvedLabel,
                type: this.detectThemeType(theme),
                path: themeFilePath
              })
            }
          }
        } catch (error) {
          logger.error(`Failed to load theme from ${themeDir}`, { error: String(error) })
        }
      }
    }

    logger.info(`✅ Discovered ${this.themes.size} VSCode themes`)
  }

  /**
   * Detect theme type from theme metadata
   */
  private detectThemeType(theme: PackageTheme): 'dark' | 'light' | 'hc' | 'hcLight' {
    const uiTheme = theme.uiTheme
    
    if (uiTheme.includes('hc-light')) return 'hcLight'
    if (uiTheme.includes('hc-black') || uiTheme.includes('hc-dark')) return 'hc'
    if (uiTheme.includes('vs-dark')) return 'dark'
    if (uiTheme.includes('vs')) return 'light'
    
    // Fallback: guess from label
    const label = theme.label.toLowerCase()
    if (label.includes('light')) return 'light'
    return 'dark'
  }

  /**
   * Load a theme definition from disk
   */
  private loadThemeFile(themePath: string): ThemeDefinition | null {
    try {
      const content = readFileSync(themePath, 'utf-8')
      // Remove comments from JSON (VSCode themes often have comments)
      // Handle both line comments and inline comments
      const cleanContent = content
        .split('\n')
        .map(line => {
          // Remove line comments
          if (line.trim().startsWith('//')) {
            return ''
          }
          // Remove inline comments (but preserve // in strings)
          const commentIndex = line.indexOf('//')
          if (commentIndex > 0) {
            // Simple check: if there's an odd number of quotes before //, it's in a string
            const beforeComment = line.substring(0, commentIndex)
            const quoteCount = (beforeComment.match(/"/g) ?? []).length
            if (quoteCount % 2 === 0) {
              // Even number of quotes = comment is outside string
              line = line.substring(0, commentIndex)
            }
          }
          return line
        })
        .filter(line => line.trim().length > 0)
        .join('\n')
        // Remove trailing commas before closing braces/brackets
        .replace(/,(\s*[}\]])/g, '$1')
      
      const theme = JSON.parse(cleanContent) as ThemeDefinition

      // Handle includes (e.g., dark_plus.json includes dark_vs.json)
      if (theme.include) {
        const basePath = join(dirname(themePath), theme.include)
        const baseTheme = this.loadThemeFile(basePath)
        
        if (baseTheme) {
          // Merge base theme with current theme
          return {
            ...baseTheme,
            ...theme,
            colors: { ...baseTheme.colors, ...theme.colors },
            tokenColors: [
              ...(baseTheme.tokenColors ?? []),
              ...(theme.tokenColors ?? [])
            ],
            semanticTokenColors: {
              ...baseTheme.semanticTokenColors,
              ...theme.semanticTokenColors
            }
          }
        }
      }

      return theme
    } catch (error) {
      logger.error(`Failed to load theme file ${themePath}`, { error: String(error) })
      return null
    }
  }

  /**
   * Get all available themes
   */
  public listThemes(): ThemeInfo[] {
    return Array.from(this.themes.values())
  }

  /**
   * Load a specific theme by ID
   */
  public loadTheme(themeId: string): ThemeDefinition | null {
    // Check cache
    const cached = this.loadedThemes.get(themeId)
    if (cached) {
      return cached
    }

    const themeInfo = this.themes.get(themeId)
    if (!themeInfo) {
      logger.error(`❌ Theme not found: "${themeId}"`)
      logger.error(`   Available themes: ${Array.from(this.themes.keys()).join(', ')}`)
      return null
    }

    const theme = this.loadThemeFile(themeInfo.path)
    if (theme) {
      this.loadedThemes.set(themeId, theme)
    } else {
      logger.error(`Failed to load theme file for ${themeId}`)
    }

    return theme
  }

  /**
   * Get default colors based on theme type
   */
  private getDefaultColors(type: 'dark' | 'light' | 'hc' | 'hcLight'): Record<string, string> {
    const isDark = type === 'dark' || type === 'hc'
    const isHC = type === 'hc' || type === 'hcLight'

    return {
      // Editor colors
      'editor.background': isDark ? '#1e1e1e' : '#ffffff',
      'editor.foreground': isDark ? '#d4d4d4' : '#000000',
      
      // Input colors
      'input.background': isDark ? '#3c3c3c' : '#ffffff',
      'input.foreground': isDark ? '#cccccc' : '#000000',
      'input.border': isHC ? '#6fc3df' : (isDark ? '#3c3c3c' : '#cecece'),
      
      // Dropdown colors
      'dropdown.background': isDark ? '#3c3c3c' : '#ffffff',
      'dropdown.foreground': isDark ? '#cccccc' : '#333333',
      'dropdown.border': isHC ? '#6fc3df' : (isDark ? '#3c3c3c' : '#cecece'),
      'dropdown.listBackground': isDark ? '#252526' : '#ffffff',
      
      // QuickInput colors (used by VSCode for dropdown lists)
      'quickInput.background': isDark ? '#252526' : '#f3f3f3',
      'quickInput.foreground': isDark ? '#cccccc' : '#333333',
      
      // List colors
      'list.activeSelectionBackground': isDark ? '#04395e' : '#0060c0',
      'list.activeSelectionForeground': '#ffffff',
      'list.hoverBackground': isDark ? '#2a2d2e' : '#e8e8e8',
      'list.focusBackground': isDark ? '#062f4a' : '#d6ebff',
      'list.hoverForeground': isDark ? '#cccccc' : '#333333',
      'list.focusForeground': isDark ? '#cccccc' : '#333333',
      'list.foreground': isDark ? '#cccccc' : '#333333',
      
      // Button colors
      'button.background': isDark ? '#0e639c' : '#007acc',
      'button.foreground': '#ffffff',
      'button.hoverBackground': isDark ? '#1177bb' : '#0062a3',
      
      // Checkbox colors
      'checkbox.background': isDark ? '#3c3c3c' : '#ffffff',
      'checkbox.foreground': isDark ? '#f0f0f0' : '#000000',
      'checkbox.border': isHC ? '#6fc3df' : (isDark ? '#3c3c3c' : '#cecece'),
      
      // Focus border
      'focusBorder': isHC ? '#f38518' : (isDark ? '#007fd4' : '#0090f1'),
      
      // Scrollbar
      'scrollbarSlider.background': isDark ? '#79797966' : '#64646466',
      'scrollbarSlider.hoverBackground': isDark ? '#646464b3' : '#646464b3',
      'scrollbarSlider.activeBackground': isDark ? '#bfbfbf66' : '#00000099',
      
      // Tab colors (VSCode-like: simple underline style)
      'tab.activeForeground': isDark ? '#ffffff' : '#333333',
      'tab.activeBorder': isDark ? '#0078d4' : '#0078d4',
      'tab.inactiveForeground': isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(51, 51, 51, 0.7)',
      'tab.border': isDark ? 'rgba(128, 128, 128, 0.35)' : 'rgba(97, 97, 97, 0.2)',
      
      // Custom: force proper text color for active tab (black on light, white on dark)
      'tab-active-text-color': isDark ? '#ffffff' : '#000000'
    }
  }

  /**
   * Convert theme colors to CSS variables
   */
  public convertToCSSVariables(theme: ThemeDefinition): ThemeVariables {
    const variables: ThemeVariables = {}

    // Start with default colors for the theme type
    const defaults = this.getDefaultColors(theme.type ?? 'dark')
    
    // First apply defaults
    for (const [key, value] of Object.entries(defaults)) {
      const cssVar = `--vscode-${key.replace(/\./g, '-')}`
      variables[cssVar] = value
    }

    // Then override with theme-specific colors
    if (theme.colors) {
      for (const [key, value] of Object.entries(theme.colors)) {
        // Convert VSCode color key format to CSS variable format
        // e.g., "editor.background" -> "--vscode-editor-background"
        const cssVar = `--vscode-${key.replace(/\./g, '-')}`
        variables[cssVar] = value
      }
    }

    return variables
  }

  /**
   * Get theme by ID with CSS variables
   */
  public getThemeWithVariables(themeId: string): {
    theme: ThemeDefinition
    variables: ThemeVariables
  } | null {
    const theme = this.loadTheme(themeId)
    if (!theme) {
      return null
    }

    const variables = this.convertToCSSVariables(theme)
    return { theme, variables }
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

