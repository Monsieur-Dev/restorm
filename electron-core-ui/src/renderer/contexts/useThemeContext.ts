import { useContext } from 'react'
import ThemeContext, { type ThemeContextValue } from './ThemeContext'

/**
 * Hook to access theme context
 * Must be used within a ThemeProvider
 */
export function useThemeContext(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useThemeContext must be used within a ThemeProvider')
  }
  return context
}

export default useThemeContext



