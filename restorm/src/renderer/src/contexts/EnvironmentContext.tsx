import React, { useEffect, useMemo, useState } from 'react'
import type { Environment } from '../../../shared/types/collections'
import { EnvironmentContext, type EnvironmentContextValue } from './useEnvironmentContext'

/** Find an environment by ID in a list (including sub-environments) */
function findEnvironmentById(environments: Environment[], id: string): Environment | null {
  for (const env of environments) {
    if (env.id === id) return env
    if (env.subEnvironments) {
      const found = findEnvironmentById(env.subEnvironments, id)
      if (found) return found
    }
  }
  return null
}

export interface EnvironmentProviderProps {
  environments: Environment[] | undefined
  tagColors?: Record<string, string> | undefined
  children: React.ReactNode
}

export const EnvironmentProvider: React.FC<EnvironmentProviderProps> = ({ environments, tagColors, children }) => {
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(() => environments?.[0]?.id ?? null)

  // Reset selection when environments list changes
  useEffect(() => {
    let rafId: number | undefined
    
    if (!environments || environments.length === 0) {
      rafId = requestAnimationFrame(() => {
        setSelectedEnvId(null)
      })
      return (): void => { if (rafId !== undefined) cancelAnimationFrame(rafId) }
    }
    // Keep current selection if still present (including sub-environments), otherwise default to first env
    if (!selectedEnvId) {
      rafId = requestAnimationFrame(() => {
        setSelectedEnvId(environments[0]?.id ?? null)
      })
      return (): void => { if (rafId !== undefined) cancelAnimationFrame(rafId) }
    }

    const found = findEnvironmentById(environments, selectedEnvId)
    if (!found) {
      rafId = requestAnimationFrame(() => {
        setSelectedEnvId(environments[0]?.id ?? null)
      })
      return (): void => { if (rafId !== undefined) cancelAnimationFrame(rafId) }
    }
    return undefined
  }, [environments, selectedEnvId])

  // Derive envColor from the selected environment's color property
  const envColor = useMemo<string | undefined>(() => {
    if (!selectedEnvId || !environments) return undefined
    const env = findEnvironmentById(environments, selectedEnvId)
    return env?.color
  }, [environments, selectedEnvId])

  const value = useMemo<EnvironmentContextValue>(
    () => ({
      environments,
      selectedEnvId,
      setSelectedEnvId,
      tagColors,
      envColor
    }),
    [environments, selectedEnvId, tagColors, envColor]
  )

  return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>
}
