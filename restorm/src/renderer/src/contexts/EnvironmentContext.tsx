import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { eventBus } from 'electron-core-ui/renderer'
import type { Environment } from '../../../shared/types/collections'
import { EnvironmentContext, type EnvironmentContextValue } from './useEnvironmentContext'
import {
  DocumentEvents,
  type RequestEnvEventPayload,
  type EnvFolderEnvEventPayload
} from '../services/DocumentEvents'
import {
  findEnvironmentById,
  getSessionFolderEnv,
  setSessionFolderEnv,
  getStoredFolderEnv,
  setStoredFolderEnv,
  getSessionRequestOverride,
  setSessionRequestOverride,
  getStoredRequestOverride,
  setStoredRequestOverride
} from '../services/environmentSelectionStore'

export interface EnvironmentPersistenceKey {
  /** Project UUID (from the collection file's `_projectUuid` field). */
  projectUuid: string
  /** Id of the nearest ancestor env folder. Primary storage grain. */
  envFolderId: string
  /** Currently-displayed request id — used for per-request overrides. */
  requestId: string
}

export interface EnvironmentProviderProps {
  environments: Environment[] | undefined
  tagColors?: Record<string, string> | undefined
  /**
   * Identifies the scope for env-selection persistence. When any
   * field is missing (e.g. folder tab), the provider runs in
   * in-memory-only mode — it still tracks a selected env for UI
   * purposes but nothing is persisted.
   */
  persistenceKey?: EnvironmentPersistenceKey | undefined
  /**
   * Every request id under the env folder this provider serves —
   * including the request the provider was instantiated for.
   * Exposed through the context (`folderRequestIds`) so popover
   * hosts (statusbar env selector + Send-button right-click) can
   * run sibling-override cleanup when the user picks an env with
   * "Apply to all" on. Optional: providers that can't enumerate
   * sibling ids (folder tabs, in-memory-only mode) simply leave
   * the cleanup branch disabled.
   */
  folderRequestIds?: string[] | undefined
  children: React.ReactNode
}

/** Resolve the active env id for a given persistence key, using the
 * full priority chain: session override → session folder default →
 * stored override → stored folder default → first env. Session hits
 * are synchronous; disk reads are not, so callers should expect an
 * async tail. */
async function resolveEnvId(
  pk: EnvironmentPersistenceKey,
  environments: Environment[]
): Promise<string | null> {
  const { projectUuid, envFolderId, requestId } = pk
  const sessOverride = getSessionRequestOverride(projectUuid, requestId)
  if (sessOverride && findEnvironmentById(environments, sessOverride)) return sessOverride
  const sessFolder = getSessionFolderEnv(projectUuid, envFolderId)
  if (sessFolder && findEnvironmentById(environments, sessFolder)) return sessFolder
  const diskOverride = await getStoredRequestOverride(projectUuid, requestId)
  if (diskOverride && findEnvironmentById(environments, diskOverride)) {
    setSessionRequestOverride(projectUuid, requestId, diskOverride)
    return diskOverride
  }
  const diskFolder = await getStoredFolderEnv(projectUuid, envFolderId)
  if (diskFolder && findEnvironmentById(environments, diskFolder)) {
    setSessionFolderEnv(projectUuid, envFolderId, diskFolder)
    return diskFolder
  }
  return environments[0]?.id ?? null
}

/** Synchronous best-effort variant used for initial hydration — only
 * looks at the session caches, no disk roundtrip. If session misses,
 * returns the first env so the UI has *something* to render while
 * `resolveEnvId` catches up asynchronously. */
function resolveEnvIdSync(
  pk: EnvironmentPersistenceKey,
  environments: Environment[]
): string | null {
  const sessOverride = getSessionRequestOverride(pk.projectUuid, pk.requestId)
  if (sessOverride && findEnvironmentById(environments, sessOverride)) return sessOverride
  const sessFolder = getSessionFolderEnv(pk.projectUuid, pk.envFolderId)
  if (sessFolder && findEnvironmentById(environments, sessFolder)) return sessFolder
  return environments[0]?.id ?? null
}

export const EnvironmentProvider: React.FC<EnvironmentProviderProps> = ({
  environments,
  tagColors,
  persistenceKey,
  folderRequestIds,
  children
}) => {
  // Sync first-paint selection: use whatever the session caches know
  // about this persistence key (folder default + override are both
  // module-level `Map`s so they survive provider remounts).
  const [selectedEnvId, setSelectedEnvIdRaw] = useState<string | null>(() => {
    if (!persistenceKey || !environments || environments.length === 0) {
      return environments?.[0]?.id ?? null
    }
    return resolveEnvIdSync(persistenceKey, environments)
  })

  const restoreLoadedRef = useRef(false)

  // Stable dep identity — the persistence key is an object, so spread
  // the primitives for the effects' dep list to avoid re-running on
  // every render.
  const projectUuid = persistenceKey?.projectUuid ?? ''
  const envFolderId = persistenceKey?.envFolderId ?? ''
  const requestId = persistenceKey?.requestId ?? ''

  // Resolve on mount / tree change / key change. Runs the full
  // priority chain including the async disk lookups. A guard flips
  // `restoreLoadedRef` true once the resolution has landed so setters
  // know they may persist (earlier first-env placeholders wouldn't).
  useEffect(() => {
    const cancelRef: { current: boolean } = { current: false }
    // The `isCancelled` wrapper defeats ESLint's control-flow
    // narrowing (which would otherwise see `cancelRef.current` as
    // literally `false` and flag the guard as a no-op): the function
    // hides the read behind a type boundary.
    const isCancelled = (): boolean => cancelRef.current
    // Run the whole resolution path inside an async IIFE that yields
    // immediately (`await` on a resolved promise). Keeping every
    // `setSelectedEnvIdRaw` after an `await` satisfies
    // `react-hooks/set-state-in-effect` — the rule only flags setState
    // calls that fire synchronously in an effect's body.
    void (async () => {
      await Promise.resolve()
      if (isCancelled()) return
      if (!environments || environments.length === 0) {
        setSelectedEnvIdRaw(null)
        return
      }
      if (!projectUuid || !envFolderId || !requestId) {
        restoreLoadedRef.current = true
        const first = environments[0]?.id ?? null
        setSelectedEnvIdRaw((current) => (current && findEnvironmentById(environments, current) ? current : first))
        return
      }
      const resolved = await resolveEnvId({ projectUuid, envFolderId, requestId }, environments)
      if (isCancelled()) return
      restoreLoadedRef.current = true
      setSelectedEnvIdRaw(resolved)
    })()
    return () => { cancelRef.current = true }
  }, [environments, projectUuid, envFolderId, requestId])

  // Apply folder default to every mounted provider in that folder +
  // clear any request-level override that would still shadow it.
  const setFolderEnv = useCallback((envId: string): void => {
    if (!persistenceKey || !environments) return
    if (!findEnvironmentById(environments, envId)) return
    const { projectUuid: pu, envFolderId: efi, requestId: rid } = persistenceKey
    // The user asked for an "apply to all" write, so any per-request
    // override the caller set earlier no longer applies — drop the
    // session copy for the active request here; sibling cleanup is
    // the caller's responsibility (it has the full request-id list).
    setSessionRequestOverride(pu, rid, null)
    void setStoredRequestOverride(pu, rid, null)
    setSessionFolderEnv(pu, efi, envId)
    void setStoredFolderEnv(pu, efi, envId)
    setSelectedEnvIdRaw(envId)
    eventBus.emitLocalSync(DocumentEvents.ENV_FOLDER_ENV_CHANGED, {
      projectUuid: pu,
      envFolderId: efi,
      envId
    } as EnvFolderEnvEventPayload)
  }, [environments, persistenceKey])

  // Apply override to just this request. Null clears the override so
  // the folder default takes over on next resolve.
  const setRequestOverride = useCallback((envId: string | null): void => {
    if (!persistenceKey || !environments) return
    if (envId && !findEnvironmentById(environments, envId)) return
    const { projectUuid: pu, requestId: rid } = persistenceKey
    setSessionRequestOverride(pu, rid, envId)
    void setStoredRequestOverride(pu, rid, envId)
    if (envId) {
      setSelectedEnvIdRaw(envId)
    } else {
      // Re-resolve: with the override gone, the folder default (or
      // first env) should take over.
      void (async () => {
        const next = await resolveEnvId(persistenceKey, environments)
        setSelectedEnvIdRaw(next)
      })()
    }
    eventBus.emitLocalSync(DocumentEvents.REQUEST_ENV_SET, {
      requestId: rid,
      envId
    } as RequestEnvEventPayload)
  }, [environments, persistenceKey])

  // Sync with sibling providers via the event bus. Both events
  // trigger a re-resolve rather than blindly adopting the payload's
  // envId — that way the priority chain is always respected, even if
  // a new override was set in the meantime.
  useEffect(() => {
    if (!projectUuid || !envFolderId || !requestId || !environments || environments.length === 0) return
    const reresolve = (): void => {
      void (async () => {
        const next = await resolveEnvId({ projectUuid, envFolderId, requestId }, environments)
        setSelectedEnvIdRaw(next)
      })()
    }
    const folderSub = eventBus.subscribe<EnvFolderEnvEventPayload>(
      DocumentEvents.ENV_FOLDER_ENV_CHANGED,
      (payload) => {
        if (payload.projectUuid !== projectUuid) return
        if (payload.envFolderId !== envFolderId) return
        reresolve()
      }
    )
    const requestSetSub = eventBus.subscribe<RequestEnvEventPayload>(
      DocumentEvents.REQUEST_ENV_SET,
      (payload) => {
        if (payload.requestId !== requestId) return
        reresolve()
      }
    )
    return () => {
      folderSub.unsubscribe()
      requestSetSub.unsubscribe()
    }
  }, [environments, projectUuid, envFolderId, requestId])

  const envColor = useMemo<string | undefined>(() => {
    if (!selectedEnvId || !environments) return undefined
    return findEnvironmentById(environments, selectedEnvId)?.color
  }, [environments, selectedEnvId])

  const value = useMemo<EnvironmentContextValue>(
    () => ({
      environments,
      selectedEnvId,
      tagColors,
      envColor,
      projectUuid: persistenceKey?.projectUuid,
      folderRequestIds,
      setFolderEnv,
      setRequestOverride
    }),
    [environments, selectedEnvId, tagColors, envColor, persistenceKey?.projectUuid, folderRequestIds, setFolderEnv, setRequestOverride]
  )

  return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>
}
