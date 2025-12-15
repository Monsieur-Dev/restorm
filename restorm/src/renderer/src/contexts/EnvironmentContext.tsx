import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { Environment } from '../types/collections'
import { findEnvironmentChain } from '../services/VariableResolutionService'

export interface EnvironmentContextValue {
  environments?: Environment[] | undefined
  selectedEnvId: string | null
  setSelectedEnvId: (id: string | null) => void
}

const EnvironmentContext = createContext<EnvironmentContextValue | undefined>(undefined)

export interface EnvironmentProviderProps {
  environments: Environment[] | undefined
  children: React.ReactNode
}

export const EnvironmentProvider: React.FC<EnvironmentProviderProps> = ({ environments, children }) => {
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(() => environments?.[0]?.id ?? null)

  // Reset selection when environments list changes
  useEffect(() => {
    if (!environments || environments.length === 0) {
      setSelectedEnvId(null)
      return
    }
    // Keep current selection if still present (including sub-environments), otherwise default to first env
    if (!selectedEnvId) {
      setSelectedEnvId(environments[0]?.id ?? null)
      return
    }

    const chain = findEnvironmentChain(environments, selectedEnvId)
    if (!chain) {
      setSelectedEnvId(environments[0]?.id ?? null)
    }
  }, [environments, selectedEnvId])

  const value = useMemo<EnvironmentContextValue>(
    () => ({
      environments,
      selectedEnvId,
      setSelectedEnvId
    }),
    [environments, selectedEnvId]
  )

  return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>
}

export function useEnvironmentContext(): EnvironmentContextValue {
  const ctx = useContext(EnvironmentContext)
  if (!ctx) {
    throw new Error('useEnvironmentContext must be used within an EnvironmentProvider')
  }
  return ctx
}

