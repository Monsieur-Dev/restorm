import React, { useCallback, useMemo, useRef } from 'react'
import { EnvironmentValuesContext, type EnvironmentValuesContextValue, type VariableContext } from './useEnvironmentValues'

export interface EnvironmentValuesProviderProps {
  children: React.ReactNode
}

export const EnvironmentValuesProvider: React.FC<EnvironmentValuesProviderProps> = ({ children }) => {
  // Use a ref instead of state to avoid re-renders when environment values change
  // This is critical for performance: updating variables should not re-render the entire tree
  const valuesByEnvIdRef = useRef<Record<string, VariableContext>>({})

  const setEnvironmentValues = useCallback((environmentId: string, values: VariableContext): void => {
    // Mutate the ref directly - no re-render triggered
    valuesByEnvIdRef.current = {
      ...valuesByEnvIdRef.current,
      [environmentId]: { ...values }
    }
  }, [])

  const getEnvironmentValues = useCallback((environmentId: string): VariableContext => {
    return valuesByEnvIdRef.current[environmentId] ?? {}
  }, [])

  const getAllEnvironmentValues = useCallback((): Record<string, VariableContext> => {
    return valuesByEnvIdRef.current
  }, [])

  const value = useMemo<EnvironmentValuesContextValue>(
    () => ({
      setEnvironmentValues,
      getEnvironmentValues,
      getAllEnvironmentValues
    }),
    [setEnvironmentValues, getEnvironmentValues, getAllEnvironmentValues]
  )

  return <EnvironmentValuesContext.Provider value={value}>{children}</EnvironmentValuesContext.Provider>
}
