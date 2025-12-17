import React, { useCallback, useMemo, useState } from 'react'
import type { VariableContext } from '../services/VariableResolutionService'
import { EnvironmentValuesContext, type EnvironmentValuesContextValue } from './useEnvironmentValues'

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
