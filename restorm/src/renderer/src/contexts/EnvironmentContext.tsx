import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { eventBus } from 'electron-core-ui/renderer'
import type { Environment } from '../../../shared/types/collections'
import { EnvironmentContext, type EnvironmentContextValue } from './useEnvironmentContext'
import { DocumentEvents, type RequestEnvEventPayload } from '../services/DocumentEvents'
import {
  findEnvironmentById,
  getStoredEnvForRequest,
  setStoredEnvForRequest,
  getSessionEnvSelection,
  setSessionEnvSelection
} from '../services/environmentSelectionStore'

export interface EnvironmentProviderProps {
  environments: Environment[] | undefined
  tagColors?: Record<string, string> | undefined
  /**
   * File + request identity used to restore / persist the user's environment
   * choice across sessions. When either is missing (e.g., folder tab), the
   * provider falls back to in-memory state with no persistence.
   */
  persistenceKey?: { filePath: string; requestId: string } | undefined
  children: React.ReactNode
}

export const EnvironmentProvider: React.FC<EnvironmentProviderProps> = ({ environments, tagColors, persistenceKey, children }) => {
  // Synchronous hydration: if the persistence key and env tree are both
  // known at mount, pick the cached value (if any) or fall back to the
  // first env. Otherwise start null and resolve in the effect below.
  const [selectedEnvId, setSelectedEnvIdRaw] = useState<string | null>(() => {
    if (!persistenceKey || !environments) return environments?.[0]?.id ?? null
    const cachedId = getSessionEnvSelection(persistenceKey.filePath, persistenceKey.requestId)
    if (cachedId && findEnvironmentById(environments, cachedId)) return cachedId
    return environments[0]?.id ?? null
  })

  // Track whether the async-storage restore has completed so we don't
  // persist the "first env" placeholder picked while the storage round-
  // trip is in flight.
  const restoreLoadedRef = useRef(false)

  const persistenceFilePath = persistenceKey?.filePath ?? ''
  const persistenceRequestId = persistenceKey?.requestId ?? ''

  // Consolidated restore/reset effect: whenever the persistence key or
  // the env tree changes, recompute the right selection in priority
  // order (session cache → on-disk storage → first env). Previously the
  // logic was split across two effects that raced with each other —
  // the "reset" effect kept overwriting the restore with the first-env
  // default before the async lookup had a chance to land.
  useEffect(() => {
    if (!environments || environments.length === 0) {
      const rafId = requestAnimationFrame(() => { setSelectedEnvIdRaw(null) })
      return (): void => { cancelAnimationFrame(rafId) }
    }

    // Always prefer the session cache — it's updated in-memory every time
    // the user flips the dropdown, so it's the most authoritative source.
    if (persistenceFilePath && persistenceRequestId) {
      const cachedId = getSessionEnvSelection(persistenceFilePath, persistenceRequestId)
      if (cachedId && findEnvironmentById(environments, cachedId)) {
        restoreLoadedRef.current = true
        if (selectedEnvId !== cachedId) {
          const rafId = requestAnimationFrame(() => { setSelectedEnvIdRaw(cachedId) })
          return (): void => { cancelAnimationFrame(rafId) }
        }
        return undefined
      }

      // Cache miss — fall back to disk. Keep the provisional state (null
      // or first-env) until the async lookup resolves.
      const cancelledRef = { current: false }
      void (async () => {
        const storedEnvId = await getStoredEnvForRequest(persistenceFilePath, persistenceRequestId)
        if (cancelledRef.current) return
        restoreLoadedRef.current = true
        if (storedEnvId && findEnvironmentById(environments, storedEnvId)) {
          setSessionEnvSelection(persistenceFilePath, persistenceRequestId, storedEnvId)
          setSelectedEnvIdRaw(storedEnvId)
        } else if (!selectedEnvId) {
          setSelectedEnvIdRaw(environments[0]?.id ?? null)
        }
      })()
      return (): void => { cancelledRef.current = true }
    }

    // No persistence key: just make sure the current selection is valid.
    restoreLoadedRef.current = true
    if (selectedEnvId && findEnvironmentById(environments, selectedEnvId)) return undefined
    const rafId = requestAnimationFrame(() => { setSelectedEnvIdRaw(environments[0]?.id ?? null) })
    return (): void => { cancelAnimationFrame(rafId) }
  }, [environments, persistenceFilePath, persistenceRequestId, selectedEnvId])

  // Wrap the setter to mirror the new selection into user config. Only
  // persists after the initial restore has run — otherwise the default
  // "first env" selection would clobber the persisted choice. Also
  // broadcasts the change so sibling providers for the same request
  // (e.g. the status-bar env selector mounted at App level) update
  // their own state in lockstep.
  const setSelectedEnvId = useCallback((id: string | null) => {
    setSelectedEnvIdRaw(id)
    if (!restoreLoadedRef.current || !persistenceKey || !environments || !id) return
    if (findEnvironmentById(environments, id)) {
      setSessionEnvSelection(persistenceKey.filePath, persistenceKey.requestId, id)
      void setStoredEnvForRequest(persistenceKey.filePath, persistenceKey.requestId, id)
      eventBus.emitLocalSync(DocumentEvents.REQUEST_ENV_CHANGED, {
        requestId: persistenceKey.requestId,
        envId: id
      } as RequestEnvEventPayload)
    }
  }, [environments, persistenceKey])

  // Keep sibling providers in sync: when another provider for the same
  // request reports a changed env (or an imperative setter emits
  // REQUEST_ENV_SET), mirror the change locally. We intentionally call
  // `setSelectedEnvIdRaw` (not `setSelectedEnvId`) to avoid an
  // emit/persist loop — the emitter already did that work.
  useEffect(() => {
    if (!persistenceKey) return
    const requestId = persistenceKey.requestId
    const applyExternal = (payload: RequestEnvEventPayload): void => {
      if (payload.requestId !== requestId) return
      if (!environments) return
      if (payload.envId && !findEnvironmentById(environments, payload.envId)) return
      setSelectedEnvIdRaw((current) => (current === payload.envId ? current : payload.envId))
    }
    const changedSub = eventBus.subscribe<RequestEnvEventPayload>(
      DocumentEvents.REQUEST_ENV_CHANGED,
      applyExternal
    )
    const setSub = eventBus.subscribe<RequestEnvEventPayload>(
      DocumentEvents.REQUEST_ENV_SET,
      (payload) => {
        // Imperative setter: apply + persist + rebroadcast as a
        // `CHANGED` event so other providers follow.
        if (payload.requestId !== requestId) return
        if (!environments) return
        if (payload.envId && !findEnvironmentById(environments, payload.envId)) return
        setSelectedEnvIdRaw(payload.envId)
        if (payload.envId) {
          setSessionEnvSelection(persistenceKey.filePath, requestId, payload.envId)
          void setStoredEnvForRequest(persistenceKey.filePath, requestId, payload.envId)
        }
        eventBus.emitLocalSync(DocumentEvents.REQUEST_ENV_CHANGED, {
          requestId,
          envId: payload.envId
        } as RequestEnvEventPayload)
      }
    )
    return () => {
      changedSub.unsubscribe()
      setSub.unsubscribe()
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
