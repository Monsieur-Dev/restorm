import { useContext, createContext } from 'react'
import { logger } from 'electron-core-ui/renderer'

export type VariableContext = Record<string, string>

export interface EnvironmentValuesContextValue {
  /** Update environment values without triggering re-renders */
  setEnvironmentValues: (environmentId: string, values: VariableContext) => void
  /** Get current environment values for a specific environment */
  getEnvironmentValues: (environmentId: string) => VariableContext
  /** Get all environment values (for reading in event handlers/effects) */
  getAllEnvironmentValues: () => Record<string, VariableContext>
}

export const EnvironmentValuesContext = createContext<EnvironmentValuesContextValue | undefined>(undefined)

// Default context value for when provider is not available (e.g., during hot reload)
const defaultContextValue: EnvironmentValuesContextValue = {
  setEnvironmentValues: () => {
    logger.warn('[EnvironmentValuesContext] setEnvironmentValues called outside provider')
  },
  getEnvironmentValues: () => {
    logger.warn('[EnvironmentValuesContext] getEnvironmentValues called outside provider')
    return {}
  },
  getAllEnvironmentValues: () => {
    logger.warn('[EnvironmentValuesContext] getAllEnvironmentValues called outside provider')
    return {}
  }
}

export function useEnvironmentValues(): EnvironmentValuesContextValue {
  const ctx = useContext(EnvironmentValuesContext)
  if (!ctx) {
    // Return default value instead of throwing during hot reload
    logger.warn('[EnvironmentValuesContext] useEnvironmentValues called outside provider')
    return defaultContextValue
  }
  return ctx
}
