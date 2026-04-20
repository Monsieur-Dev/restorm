import { useContext, createContext } from 'react'
import type { Environment } from '../../../shared/types/collections'

export interface EnvironmentContextValue {
  environments?: Environment[] | undefined
  selectedEnvId: string | null
  tagColors?: Record<string, string> | undefined
  envColor?: string | undefined
  /** Write the env-folder default. Callers should also clear any
   * per-request overrides for sibling requests they know about. */
  setFolderEnv: (envId: string) => void
  /** Write a per-request override. Pass `null` to clear. */
  setRequestOverride: (envId: string | null) => void
}

export const EnvironmentContext = createContext<EnvironmentContextValue | undefined>(undefined)

export function useEnvironmentContext(): EnvironmentContextValue {
  const ctx = useContext(EnvironmentContext)
  if (!ctx) {
    throw new Error('useEnvironmentContext must be used within an EnvironmentProvider')
  }
  return ctx
}
