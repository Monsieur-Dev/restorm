import { useContext, createContext } from 'react'
import type { Environment } from '../types/collections'

export interface EnvironmentContextValue {
  environments?: Environment[] | undefined
  selectedEnvId: string | null
  setSelectedEnvId: (id: string | null) => void
}

export const EnvironmentContext = createContext<EnvironmentContextValue | undefined>(undefined)

export function useEnvironmentContext(): EnvironmentContextValue {
  const ctx = useContext(EnvironmentContext)
  if (!ctx) {
    throw new Error('useEnvironmentContext must be used within an EnvironmentProvider')
  }
  return ctx
}
