/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { useState, useEffect, useCallback } from 'react'
import type { ThemeInfo, ThemeDefinition, ThemeVariables } from '../../../types/theme'
import { logger } from '../services/logger'

interface UseThemeReturn {
  themes: ThemeInfo[]
  currentThemeId: string | null
  currentTheme: ThemeDefinition | null
  currentVariables: ThemeVariables | null
  isLoading: boolean
  error: string | null
  setTheme: (themeId: string) => Promise<void>
  refreshThemes: () => Promise<void>
}

/**
 * Hook to manage VSCode themes
 */
export function useTheme(): UseThemeReturn {
  const [themes, setThemes] = useState<ThemeInfo[]>([])
  const [currentThemeId, setCurrentThemeId] = useState<string | null>(null)
  const [currentTheme, setCurrentTheme] = useState<ThemeDefinition | null>(null)
  const [currentVariables, setCurrentVariables] = useState<ThemeVariables | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /**
   * Load list of available themes
   */
  const refreshThemes = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true)
      setError(null)
      const themeList: ThemeInfo[] = await window.api.theme.list()
      setThemes(themeList)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load themes')
      logger.error('Failed to load themes', { error: String(err) })
    } finally {
      setIsLoading(false)
    }
  }, [])

  /**
   * Apply CSS variables to the document
   */
  const applyCSSVariables = useCallback((variables: ThemeVariables) => {
    const root = document.documentElement
    
    // Clear existing VSCode variables
    const existingVars = Array.from(root.style)
      .filter(prop => prop.startsWith('--vscode-'))
    
    existingVars.forEach(prop => {
      root.style.removeProperty(prop)
    })

    // Apply new variables
    Object.entries(variables).forEach(([key, value]) => {
      root.style.setProperty(key, value)
    })
  }, [])

  /**
   * Set and apply a theme
   */
  const setTheme = useCallback(async (themeId: string): Promise<void> => {
    try {
      setIsLoading(true)
      setError(null)

      // Load theme data
      const themeData: { theme: ThemeDefinition; variables: ThemeVariables } | null = 
        await window.api.theme.load(themeId)
      
      if (!themeData) {
        throw new Error(`Theme not found: ${themeId}`)
      }

      // Apply CSS variables
      applyCSSVariables(themeData.variables)

      // Update data-theme attribute for compatibility
      const themeInfo = themes.find(t => t.id === themeId)
      if (themeInfo) {
        document.documentElement.setAttribute('data-theme', themeInfo.type)
      }

      // Save current theme
      await window.api.theme.set(themeId)

      // Update state
      setCurrentThemeId(themeId)
      setCurrentTheme(themeData.theme)
      setCurrentVariables(themeData.variables)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set theme')
      logger.error('Failed to set theme', { error: String(err) })
    } finally {
      setIsLoading(false)
    }
  }, [themes, applyCSSVariables])

  /**
   * Load initial theme on mount
   */
  useEffect(() => {
    const initTheme = async (): Promise<void> => {
      try {
        setIsLoading(true)

        // Load themes list
        const themeList: ThemeInfo[] = await window.api.theme.list()
        setThemes(themeList)

        // Get current theme or use first dark theme as default
        let themeId: string | undefined = await window.api.theme.getCurrent()
        
        if (!themeId && themeList.length > 0) {
          // Default to first dark theme
          const defaultTheme = themeList.find(t => t.type === 'dark') ?? themeList[0]
          if (defaultTheme) {
            themeId = defaultTheme.id
          }
        }

        if (themeId) {
          const themeData: { theme: ThemeDefinition; variables: ThemeVariables } | null = 
            await window.api.theme.load(themeId)
          
          if (themeData) {
            applyCSSVariables(themeData.variables)
            
            const themeInfo = themeList.find(t => t.id === themeId)
            if (themeInfo) {
              document.documentElement.setAttribute('data-theme', themeInfo.type)
            }

            setCurrentThemeId(themeId)
            setCurrentTheme(themeData.theme)
            setCurrentVariables(themeData.variables)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize theme')
        logger.error('Failed to initialize theme', { error: String(err) })
      } finally {
        setIsLoading(false)
      }
    }

    initTheme().catch((err) => {
      logger.error('Failed to initialize theme in useEffect', { error: String(err) })
    })
  }, [applyCSSVariables])

  return {
    themes,
    currentThemeId,
    currentTheme,
    currentVariables,
    isLoading,
    error,
    setTheme,
    refreshThemes
  }
}

