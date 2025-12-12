import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { logger } from 'electron-core-ui/renderer'
import type { VariableContext } from '../services/VariableResolutionService'

export interface EnvironmentValuesContextValue {
  valuesByEnvId: Record<string, VariableContext>
  setEnvironmentValues: (environmentId: string, values: VariableContext) => void
}

const EnvironmentValuesContext = createContext<EnvironmentValuesContextValue | undefined>(undefined)

export interface EnvironmentValuesProviderProps {
  children: React.ReactNode
}

export const EnvironmentValuesProvider: React.FC<EnvironmentValuesProviderProps> = ({ children }) => {
  const [valuesByEnvId, setValuesByEnvId] = useState<Record<string, VariableContext>>({})

  const setEnvironmentValues = useCallback((environmentId: string, values: VariableContext): void => {
    setValuesByEnvId((prev) => ({
      ...prev,
      // Always copy to avoid accidental external mutations
      [environmentId]: { ...values }
    }))
  }, [])

  const value = useMemo<EnvironmentValuesContextValue>(
    () => ({
      valuesByEnvId,
      setEnvironmentValues
    }),
    [valuesByEnvId, setEnvironmentValues]
  )

  return <EnvironmentValuesContext.Provider value={value}>{children}</EnvironmentValuesContext.Provider>
}

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

