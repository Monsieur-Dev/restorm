import React, { createContext, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { ThemeInfo, ThemeDefinition, ThemeVariables } from '../../../types/theme'
import { logger } from '../services/logger'

export interface ThemeContextValue {
  themes: ThemeInfo[]
  currentThemeId: string | null
  currentTheme: ThemeDefinition | null
  currentVariables: ThemeVariables | null
  isLoading: boolean
  error: string | null
  setTheme: (themeId: string) => Promise<void>
  refreshThemes: () => Promise<void>
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

type ThemeApi = {
  list: () => Promise<ThemeInfo[]>
  load: (themeId: string) => Promise<{ theme: ThemeDefinition; variables: ThemeVariables } | null>
  getCurrent: () => Promise<string | undefined>
  set: (themeId: string) => Promise<boolean>
  updateWCO: (colors: { backgroundColor: string; symbolColor: string }) => Promise<boolean>
  onThemeChanged: (callback: (themeId: string) => void) => () => void
}

type WindowWithThemeApi = typeof window & {
  api?: {
    theme?: ThemeApi
  }
}

function getThemeApi(): ThemeApi | null {
  if (typeof window === 'undefined') return null
  const anyWindow = window as WindowWithThemeApi
  return anyWindow.api?.theme ?? null
}

// Global initialization flag to prevent multiple inits across StrictMode
let globalInitStarted = false
let globalInitPromise: Promise<void> | null = null

interface ThemeProviderProps {
  children: React.ReactNode
}

/**
 * Provider component that centralizes theme state management
 * Only ONE instance should be used at the app root
 */
export function ThemeProvider({ children }: ThemeProviderProps): React.ReactElement {
  const [themes, setThemes] = useState<ThemeInfo[]>([])
  const [currentThemeId, setCurrentThemeId] = useState<string | null>(null)
  const [currentTheme, setCurrentTheme] = useState<ThemeDefinition | null>(null)
  const [currentVariables, setCurrentVariables] = useState<ThemeVariables | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const currentThemeIdRef = useRef<string | null>(null)
  const initDoneRef = useRef(false)
  
  useEffect(() => {
    currentThemeIdRef.current = currentThemeId
  }, [currentThemeId])

  const cssColorToHex = useCallback((color: string): string => {
    if (color.startsWith('#')) return color
    const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/)
    if (rgbMatch?.[1] && rgbMatch[2] && rgbMatch[3]) {
      const r = parseInt(rgbMatch[1], 10).toString(16).padStart(2, '0')
      const g = parseInt(rgbMatch[2], 10).toString(16).padStart(2, '0')
      const b = parseInt(rgbMatch[3], 10).toString(16).padStart(2, '0')
      return `#${r}${g}${b}`
    }
    return color
  }, [])

  const updateWCOColors = useCallback(async (): Promise<void> => {
    const themeApi = getThemeApi()
    if (!themeApi?.updateWCO) {
      return
    }
    const root = document.documentElement
    const computedStyle = getComputedStyle(root)
    const backgroundColor = computedStyle.getPropertyValue('--vscode-titleBar-activeBackground').trim() || '#181818'
    const symbolColor = computedStyle.getPropertyValue('--vscode-titleBar-activeForeground').trim() || '#cccccc'
    const bgHex = cssColorToHex(backgroundColor)
    const symbolHex = cssColorToHex(symbolColor)
    try {
      await themeApi.updateWCO({ backgroundColor: bgHex, symbolColor: symbolHex })
    } catch (err) {
      logger.error('Failed to update WCO colors', { error: String(err) })
    }
  }, [cssColorToHex])

  const setWindowBorderColorForTheme = useCallback((themeType: string | undefined): void => {
    const root = document.documentElement
    if (!themeType) {
      root.style.removeProperty('--window-border-color')
      return
    }
    if (themeType === 'dark' || themeType === 'hcDark') {
      root.style.setProperty('--window-border-color', '#666666')
    } else {
      root.style.setProperty('--window-border-color', '#000000')
    }
  }, [])

  const applyCSSVariables = useCallback((variables: ThemeVariables): void => {
    const root = document.documentElement
    const existingVars = Array.from(root.style).filter(prop => prop.startsWith('--vscode-'))
    existingVars.forEach(prop => { root.style.removeProperty(prop) })
    Object.entries(variables).forEach(([key, value]) => { root.style.setProperty(key, value) })
    setTimeout(() => {
      updateWCOColors().catch((err) => {
        logger.error('Failed to update WCO after CSS variables apply', { error: String(err) })
      })
    }, 50)
  }, [updateWCOColors])

  const refreshThemes = useCallback(async (): Promise<void> => {
    const themeApi = getThemeApi()
    if (!themeApi?.list) {
      setIsLoading(false)
      return
    }
    try {
      setIsLoading(true)
      setError(null)
      const themeList: ThemeInfo[] = await themeApi.list()
      setThemes(themeList)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load themes')
      logger.error('Failed to load themes', { error: String(err) })
    } finally {
      setIsLoading(false)
    }
  }, [])

  const setTheme = useCallback(async (themeId: string): Promise<void> => {
    const themeApi = getThemeApi()
    if (!themeApi?.load || !themeApi.set) {
      setError('Theme API is not available')
      setIsLoading(false)
      return
    }
    try {
      setIsLoading(true)
      setError(null)
      const themeData: { theme: ThemeDefinition; variables: ThemeVariables } | null =
        await themeApi.load(themeId)
      if (!themeData) throw new Error(`Theme not found: ${themeId}`)
      applyCSSVariables(themeData.variables)
      const themeInfo = themes.find(t => t.id === themeId)
      if (themeInfo) {
        document.documentElement.setAttribute('data-theme', themeInfo.type)
        setWindowBorderColorForTheme(themeInfo.type)
      } else {
        setWindowBorderColorForTheme(undefined)
      }
      await themeApi.set(themeId)
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
  }, [themes, applyCSSVariables, setWindowBorderColorForTheme])

  // Initialize theme once
  useEffect(() => {
    // Skip if already initialized in this component instance
    if (initDoneRef.current) return
    
    // Use global flag to prevent double init in StrictMode
    if (globalInitStarted && globalInitPromise) {
      // Wait for existing init to complete, then sync state
      globalInitPromise.then(() => {
        initDoneRef.current = true
      }).catch(() => {
        // Error already logged
      })
      return
    }
    
    globalInitStarted = true
    initDoneRef.current = true

    const themeApi = getThemeApi()
    if (!themeApi) {
      setIsLoading(false)
      return
    }

    const initTheme = async (): Promise<void> => {
      try {
        setIsLoading(true)
        const themeList: ThemeInfo[] = await themeApi.list()
        setThemes(themeList)

        let themeId: string | undefined = await themeApi.getCurrent()

        const isValidThemeId = (id: string | undefined, list: ThemeInfo[]): id is string => {
          return !!id && list.some(t => t.id === id)
        }

        // Migrate legacy theme IDs
        if (themeId && !isValidThemeId(themeId, themeList)) {
          const legacyThemeId = String(themeId)
          const parts = legacyThemeId.split('/')
          if (parts.length === 2) {
            const [dir, legacyIdRaw] = parts as [string, string]
            const legacyMap = {
              dark_plus: 'Default Dark+',
              light_plus: 'Default Light+',
              dark_modern: 'Default Dark Modern',
              light_modern: 'Default Light Modern',
              dark_vs: 'Visual Studio Dark',
              light_vs: 'Visual Studio Light',
              hc_light: 'Default High Contrast Light',
              hc_black: 'Default High Contrast'
            } as const
            type LegacyKey = keyof typeof legacyMap

            if (legacyIdRaw in legacyMap) {
              const mappedLabel = legacyMap[legacyIdRaw as LegacyKey]
              const candidateId = `${dir}/${mappedLabel}`
                if (isValidThemeId(candidateId, themeList)) {
                  themeId = candidateId
                  await themeApi.set(themeId)
                }
            }
          }
        }

        // Fall back to default theme if needed
        if (!isValidThemeId(themeId, themeList) && themeList.length > 0) {
          const defaultTheme = themeList.find(t => t.type === 'dark') ?? themeList[0]
          if (defaultTheme) {
            themeId = defaultTheme.id
            await themeApi.set(themeId)
          }
        }

        if (themeId) {
          const themeData: { theme: ThemeDefinition; variables: ThemeVariables } | null =
            await themeApi.load(themeId)
          
          if (themeData) {
            const root = document.documentElement
            const existingVars = Array.from(root.style).filter(prop => prop.startsWith('--vscode-'))
            existingVars.forEach(prop => { root.style.removeProperty(prop) })
            Object.entries(themeData.variables).forEach(([key, value]) => { root.style.setProperty(key, value) })
            
            const themeInfo = themeList.find(t => t.id === themeId)
            if (themeInfo) {
              document.documentElement.setAttribute('data-theme', themeInfo.type)
              setWindowBorderColorForTheme(themeInfo.type)
            }

            setCurrentThemeId(themeId)
            currentThemeIdRef.current = themeId
            setCurrentTheme(themeData.theme)
            setCurrentVariables(themeData.variables)
            
            setTimeout(() => {
              void updateWCOColors()
            }, 50)
          } else {
            logger.error('🎨 ThemeProvider: Failed to load theme data', { themeId })
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize theme')
        logger.error('🎨 ThemeProvider: Failed to initialize theme', { error: String(err) })
      } finally {
        setIsLoading(false)
      }
    }

    globalInitPromise = initTheme()
    globalInitPromise.catch((err) => {
      logger.error('🎨 ThemeProvider: Init promise rejected', { error: String(err) })
    })
    
    // Listen for theme changes from other windows
    const cleanup = getThemeApi()?.onThemeChanged?.((themeId: string) => {
      if (currentThemeIdRef.current === themeId) return
      
      void (async () => {
        try {
          setIsLoading(true)
          const themeData = await window.api.theme.load(themeId)
          if (themeData) {
            const root = document.documentElement
            const existingVars = Array.from(root.style).filter(prop => prop.startsWith('--vscode-'))
            existingVars.forEach(prop => { root.style.removeProperty(prop) })
            Object.entries(themeData.variables).forEach(([key, value]) => { root.style.setProperty(key, value) })
            
            const themeList = await window.api.theme.list()
            const themeInfo = themeList.find(t => t.id === themeId)
            if (themeInfo) {
              document.documentElement.setAttribute('data-theme', themeInfo.type)
              setWindowBorderColorForTheme(themeInfo.type)
            }

            setCurrentThemeId(themeId)
            currentThemeIdRef.current = themeId
            setCurrentTheme(themeData.theme)
            setCurrentVariables(themeData.variables)
            setThemes(themeList)
            
            setTimeout(() => void updateWCOColors(), 50)
          }
        } catch (err) {
          logger.error('🎨 ThemeProvider: Failed to apply theme from change event', { error: String(err) })
        } finally {
          setIsLoading(false)
        }
      })()
    })
    
    return () => { cleanup?.() }
  }, [setWindowBorderColorForTheme, updateWCOColors])

  const value = useMemo<ThemeContextValue>(() => ({
    themes,
    currentThemeId,
    currentTheme,
    currentVariables,
    isLoading,
    error,
    setTheme,
    refreshThemes
  }), [themes, currentThemeId, currentTheme, currentVariables, isLoading, error, setTheme, refreshThemes])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export default ThemeContext
