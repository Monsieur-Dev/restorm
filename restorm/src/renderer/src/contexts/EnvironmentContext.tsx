import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Environment } from '../../../shared/types/collections'
import { EnvironmentContext, type EnvironmentContextValue } from './useEnvironmentContext'
import {
  findEnvIdByNamePath,
  findNamePathByEnvId,
  getStoredEnvForRequest,
  setStoredEnvForRequest,
  getSessionEnvSelection,
  setSessionEnvSelection,
  hasSessionEnvSelection
} from '../services/environmentSelectionStore'

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
  /**
   * File + request identity used to restore / persist the user's environment
   * choice across sessions. When either is missing (e.g., folder tab), the
   * provider falls back to in-memory state with no persistence.
   */
  persistenceKey?: { filePath: string; requestPath: string } | undefined
  children: React.ReactNode
}

export const EnvironmentProvider: React.FC<EnvironmentProviderProps> = ({ environments, tagColors, persistenceKey, children }) => {
  const [selectedEnvId, setSelectedEnvIdRaw] = useState<string | null>(() => {
    // Synchronously hydrate from the session cache on mount. This is the
    // remount-safe path: async storage restore only covers first-ever load.
    if (persistenceKey && environments) {
      const cachedName = getSessionEnvSelection(persistenceKey.filePath, persistenceKey.requestPath)
      if (cachedName) {
        const matchedId = findEnvIdByNamePath(environments, cachedName)
        if (matchedId) return matchedId
      }
    }
    return environments?.[0]?.id ?? null
  })
  // Track whether the initial restore from user config has run, so we don't
  // overwrite the stored value with the default first-env selection that was
  // picked before the async lookup had a chance to resolve.
  const restoreLoadedRef = useRef(false)

  // Keep the live `environments` array in a ref so the restore effect can
  // resolve the stored name path without listing `environments` in its deps
  // (the reactive proxy rewraps it often — we only want to restore once per
  // persistence-key pair).
  const environmentsRef = useRef(environments)
  useEffect(() => {
    environmentsRef.current = environments
  }, [environments])

  const persistenceFilePath = persistenceKey?.filePath ?? ''
  const persistenceRequestPath = persistenceKey?.requestPath ?? ''

  // Restore the environment selection from user config (if we have a
  // persistence key). Runs once per persistence-key pair.
  useEffect(() => {
    if (!persistenceFilePath || !persistenceRequestPath) {
      restoreLoadedRef.current = true
      return
    }
    if (hasSessionEnvSelection(persistenceFilePath, persistenceRequestPath)) {
      // Already restored in this session — skip the async round-trip.
      restoreLoadedRef.current = true
      return
    }
    const cancelledRef = { current: false }
    void (async () => {
      const storedNamePath = await getStoredEnvForRequest(persistenceFilePath, persistenceRequestPath)
      if (cancelledRef.current) return
      if (storedNamePath) {
        setSessionEnvSelection(persistenceFilePath, persistenceRequestPath, storedNamePath)
        const matchedId = findEnvIdByNamePath(environmentsRef.current, storedNamePath)
        if (matchedId) setSelectedEnvIdRaw(matchedId)
      }
      restoreLoadedRef.current = true
    })()
    return () => { cancelledRef.current = true }
  }, [persistenceFilePath, persistenceRequestPath])

  // Reset selection when environments list changes
  useEffect(() => {
    let rafId: number | undefined

    if (!environments || environments.length === 0) {
      rafId = requestAnimationFrame(() => {
        setSelectedEnvIdRaw(null)
      })
      return (): void => { if (rafId !== undefined) cancelAnimationFrame(rafId) }
    }
    // Keep current selection if still present (including sub-environments), otherwise default to first env
    if (!selectedEnvId) {
      rafId = requestAnimationFrame(() => {
        setSelectedEnvIdRaw(environments[0]?.id ?? null)
      })
      return (): void => { if (rafId !== undefined) cancelAnimationFrame(rafId) }
    }

    const found = findEnvironmentById(environments, selectedEnvId)
    if (!found) {
      rafId = requestAnimationFrame(() => {
        setSelectedEnvIdRaw(environments[0]?.id ?? null)
      })
      return (): void => { if (rafId !== undefined) cancelAnimationFrame(rafId) }
    }
    return undefined
  }, [environments, selectedEnvId])

  // Wrap the setter to mirror the new selection into user config. Only
  // persists after the initial restore has run — otherwise the default
  // "first env" selection would clobber the persisted choice.
  const setSelectedEnvId = useCallback((id: string | null) => {
    setSelectedEnvIdRaw(id)
    if (!restoreLoadedRef.current || !persistenceKey || !environments || !id) return
    const namePath = findNamePathByEnvId(environments, id)
    if (namePath !== null) {
      setSessionEnvSelection(persistenceKey.filePath, persistenceKey.requestPath, namePath)
      void setStoredEnvForRequest(persistenceKey.filePath, persistenceKey.requestPath, namePath)
    }
  }, [environments, persistenceKey])

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
    [environments, selectedEnvId, setSelectedEnvId, tagColors, envColor]
  )

  return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>
}
