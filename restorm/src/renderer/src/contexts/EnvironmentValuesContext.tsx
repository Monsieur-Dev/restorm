import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
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

export function useEnvironmentValues(): EnvironmentValuesContextValue {
  const ctx = useContext(EnvironmentValuesContext)
  if (!ctx) {
    throw new Error('useEnvironmentValues must be used within an EnvironmentValuesProvider')
  }
  return ctx
}

