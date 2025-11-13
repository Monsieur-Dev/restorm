import { useState, useEffect, useCallback, useRef } from 'react'
import type { ThemeInfo, ThemeDefinition, ThemeVariables } from '../../../types/theme'
import { logger } from '../services/logger'

export interface UseThemeReturn {
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
  
  // Use ref to store current theme ID for use in event listener
  const currentThemeIdRef = useRef<string | null>(null)
  useEffect(() => {
    currentThemeIdRef.current = currentThemeId
  }, [currentThemeId])

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
   * Convert CSS color to hex format
   * Handles rgb/rgba formats and returns hex
   */
  const cssColorToHex = useCallback((color: string): string => {
    // If already hex, return as is
    if (color.startsWith('#')) {
      return color
    }
    
    // If rgb/rgba, convert to hex
    const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/)
    if (rgbMatch?.[1] && rgbMatch[2] && rgbMatch[3]) {
      const r = parseInt(rgbMatch[1], 10).toString(16).padStart(2, '0')
      const g = parseInt(rgbMatch[2], 10).toString(16).padStart(2, '0')
      const b = parseInt(rgbMatch[3], 10).toString(16).padStart(2, '0')
      return `#${r}${g}${b}`
    }
    
    // Fallback to default
    return color
  }, [])

  /**
   * Update WCO colors based on current theme
   */
  const updateWCOColors = useCallback(async (): Promise<void> => {
    const root = document.documentElement
    const computedStyle = getComputedStyle(root)
    
    // Get titleBar colors from CSS variables
    const backgroundColor = computedStyle.getPropertyValue('--vscode-titleBar-activeBackground').trim() || '#181818'
    const symbolColor = computedStyle.getPropertyValue('--vscode-titleBar-activeForeground').trim() || '#cccccc'
    
    // Convert to hex if needed
    const bgHex = cssColorToHex(backgroundColor)
    const symbolHex = cssColorToHex(symbolColor)
    
    try {
      await window.api.theme.updateWCO({
        backgroundColor: bgHex,
        symbolColor: symbolHex
      })
    } catch (err) {
      logger.error('Failed to update WCO colors', { error: String(err) })
    }
  }, [cssColorToHex])

  /**
   * Apply CSS variables to the document
   */
  const applyCSSVariables = useCallback((variables: ThemeVariables): void => {
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
    
    // Update WCO colors after a short delay to ensure CSS is applied
    setTimeout(() => {
      updateWCOColors().catch((err) => {
        logger.error('Failed to update WCO after CSS variables apply', { error: String(err) })
      })
    }, 50)
  }, [updateWCOColors])

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

      // Update state and ref
      setCurrentThemeId(themeId)
      currentThemeIdRef.current = themeId
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
        logger.info('🎨 useTheme: Loading initial theme...')

        // Load themes list
        const themeList: ThemeInfo[] = await window.api.theme.list()
        logger.info('🎨 useTheme: Themes list loaded', { count: themeList.length })
        setThemes(themeList)

        // Get current theme or use first dark theme as default
        let themeId: string | undefined = await window.api.theme.getCurrent()
        logger.info('🎨 useTheme: Current theme from storage', { themeId })
        
        if (!themeId && themeList.length > 0) {
          // Default to first dark theme
          const defaultTheme = themeList.find(t => t.type === 'dark') ?? themeList[0]
          if (defaultTheme) {
            themeId = defaultTheme.id
            logger.info('🎨 useTheme: Using default theme', { themeId })
          }
        }

        if (themeId) {
          logger.info('🎨 useTheme: Loading theme data', { themeId })
          const themeData: { theme: ThemeDefinition; variables: ThemeVariables } | null = 
            await window.api.theme.load(themeId)
          
          if (themeData) {
            logger.info('🎨 useTheme: Applying theme', { themeId })
            // Apply CSS variables directly (don't use applyCSSVariables callback to avoid dependency issues)
            const root = document.documentElement
            
            // Clear existing VSCode variables
            const existingVars = Array.from(root.style)
              .filter(prop => prop.startsWith('--vscode-'))
            
            existingVars.forEach(prop => {
              root.style.removeProperty(prop)
            })

            // Apply new variables
            Object.entries(themeData.variables).forEach(([key, value]) => {
              root.style.setProperty(key, value)
            })
            
            const themeInfo = themeList.find(t => t.id === themeId)
            if (themeInfo) {
              document.documentElement.setAttribute('data-theme', themeInfo.type)
            }

            setCurrentThemeId(themeId)
            currentThemeIdRef.current = themeId
            setCurrentTheme(themeData.theme)
            setCurrentVariables(themeData.variables)
            logger.info('🎨 useTheme: Theme applied successfully', { themeId })
            
            // Update WCO colors after a short delay to ensure CSS is applied
            // Use updateWCOColors from the closure
            setTimeout(async () => {
              try {
                const rootEl = document.documentElement
                const computedStyle = getComputedStyle(rootEl)
                
                // Get titleBar colors from CSS variables
                const backgroundColor = computedStyle.getPropertyValue('--vscode-titleBar-activeBackground').trim() || '#181818'
                const symbolColor = computedStyle.getPropertyValue('--vscode-titleBar-activeForeground').trim() || '#cccccc'
                
                // Convert to hex if needed
                // Helper function to convert CSS color to hex
                const cssColorToHexLocal = (color: string): string => {
                  // If already hex, return as is
                  if (color.startsWith('#')) {
                    return color
                  }
                  
                  // If rgb/rgba, convert to hex
                  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/)
                  if (rgbMatch?.[1] && rgbMatch[2] && rgbMatch[3]) {
                    const r = parseInt(rgbMatch[1], 10).toString(16).padStart(2, '0')
                    const g = parseInt(rgbMatch[2], 10).toString(16).padStart(2, '0')
                    const b = parseInt(rgbMatch[3], 10).toString(16).padStart(2, '0')
                    return `#${r}${g}${b}`
                  }
                  
                  // Fallback to default
                  return color
                }
                const bgHex = cssColorToHexLocal(backgroundColor)
                const symbolHex = cssColorToHexLocal(symbolColor)
                
                await window.api.theme.updateWCO({
                  backgroundColor: bgHex,
                  symbolColor: symbolHex
                })
              } catch (err) {
                logger.error('🎨 useTheme: Failed to update WCO after theme apply', { error: String(err) })
              }
            }, 50)
          } else {
            logger.error('🎨 useTheme: Failed to load theme data', { themeId })
          }
        } else {
          logger.warn('🎨 useTheme: No theme ID available')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize theme')
        logger.error('🎨 useTheme: Failed to initialize theme', { error: String(err) })
      } finally {
        setIsLoading(false)
      }
    }

    initTheme().catch((err) => {
      logger.error('🎨 useTheme: Failed to initialize theme in useEffect', { error: String(err) })
    })
    
    // Listen for theme changes from other windows
    const cleanup = window.api.theme.onThemeChanged((themeId: string) => {
      logger.info('🎨 useTheme: Theme changed event received from another window', { themeId, currentThemeId: currentThemeIdRef.current })
      
      // Skip if this is already the current theme (avoid unnecessary re-application)
      if (currentThemeIdRef.current === themeId) {
        logger.info('🎨 useTheme: Theme is already current, skipping re-application', { themeId })
        return
      }
      
      // Load and apply the new theme
      const applyTheme = async (): Promise<void> => {
        try {
          setIsLoading(true)
          
          // Load theme data
          const themeData: { theme: ThemeDefinition; variables: ThemeVariables } | null = 
            await window.api.theme.load(themeId)
          
          if (themeData) {
            logger.info('🎨 useTheme: Applying theme from change event', { themeId })
            
            // Apply CSS variables directly
            const root = document.documentElement
            
            // Clear existing VSCode variables
            const existingVars = Array.from(root.style)
              .filter(prop => prop.startsWith('--vscode-'))
            
            existingVars.forEach(prop => {
              root.style.removeProperty(prop)
            })

            // Apply new variables
            Object.entries(themeData.variables).forEach(([key, value]) => {
              root.style.setProperty(key, value)
            })
            
            // Update data-theme attribute
            const themeList = await window.api.theme.list()
            const themeInfo = themeList.find(t => t.id === themeId)
            if (themeInfo) {
              document.documentElement.setAttribute('data-theme', themeInfo.type)
            }

            // Update state and ref
            setCurrentThemeId(themeId)
            currentThemeIdRef.current = themeId
            setCurrentTheme(themeData.theme)
            setCurrentVariables(themeData.variables)
            setThemes(themeList)
            
            logger.info('🎨 useTheme: Theme applied successfully from change event', { themeId })
            
            // Update WCO colors after a short delay
            setTimeout(async () => {
              try {
                const rootEl = document.documentElement
                const computedStyle = getComputedStyle(rootEl)
                
                const backgroundColor = computedStyle.getPropertyValue('--vscode-titleBar-activeBackground').trim() || '#181818'
                const symbolColor = computedStyle.getPropertyValue('--vscode-titleBar-activeForeground').trim() || '#cccccc'
                
                const cssColorToHexLocal = (color: string): string => {
                  if (color.startsWith('#')) {
                    return color
                  }
                  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/)
                  if (rgbMatch?.[1] && rgbMatch[2] && rgbMatch[3]) {
                    const r = parseInt(rgbMatch[1], 10).toString(16).padStart(2, '0')
                    const g = parseInt(rgbMatch[2], 10).toString(16).padStart(2, '0')
                    const b = parseInt(rgbMatch[3], 10).toString(16).padStart(2, '0')
                    return `#${r}${g}${b}`
                  }
                  return color
                }
                
                const bgHex = cssColorToHexLocal(backgroundColor)
                const symbolHex = cssColorToHexLocal(symbolColor)
                
                await window.api.theme.updateWCO({
                  backgroundColor: bgHex,
                  symbolColor: symbolHex
                })
              } catch (err) {
                logger.error('🎨 useTheme: Failed to update WCO after theme change event', { error: String(err) })
              }
            }, 50)
          } else {
            logger.error('🎨 useTheme: Failed to load theme data from change event', { themeId })
          }
        } catch (err) {
          logger.error('🎨 useTheme: Failed to apply theme from change event', { error: String(err) })
        } finally {
          setIsLoading(false)
        }
      }
      
      void applyTheme()
    })
    
    // Cleanup listener on unmount
    return () => {
      cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

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

export default useTheme

