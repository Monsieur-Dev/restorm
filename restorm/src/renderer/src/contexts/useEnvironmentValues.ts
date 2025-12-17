import { useContext, createContext } from 'react'
import { logger } from 'electron-core-ui/renderer'
import type { VariableContext } from '../services/VariableResolutionService'

export interface EnvironmentValuesContextValue {
  valuesByEnvId: Record<string, VariableContext>
  setEnvironmentValues: (environmentId: string, values: VariableContext) => void
}

export const EnvironmentValuesContext = createContext<EnvironmentValuesContextValue | undefined>(undefined)

// Default context value for when provider is not available (e.g., during hot reload)
const defaultContextValue: EnvironmentValuesContextValue = {
  valuesByEnvId: {},
  setEnvironmentValues: () => {
    logger.warn('[EnvironmentValuesContext] setEnvironmentValues called outside provider')
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
