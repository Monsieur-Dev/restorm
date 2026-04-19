import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  FileServiceState,
  FileMetadata,
  SerializationFormat,
  UnsavedChangesDialogLabels
} from '../../types/file'

interface WindowFileApi {
  file: {
    newFile: () => Promise<boolean>
    open: (path?: string) => Promise<{ success: boolean; content?: unknown }>
    save: (content: unknown) => Promise<boolean>
    saveAs: (content: unknown, filename?: string, format?: SerializationFormat) => Promise<boolean>
    close: () => Promise<boolean>
    getState: () => Promise<FileServiceState | null>
    getFileName: () => Promise<string | null>
    getFilePath: () => Promise<string | null>
    isDirty: () => Promise<boolean>
    finishLoading: () => Promise<void>
    showUnsavedChangesDialog: (labels?: UnsavedChangesDialogLabels) => Promise<'save' | 'discard' | 'cancel'>
    getRecentFiles: () => Promise<FileMetadata[]>
    getFavorites: () => Promise<FileMetadata[]>
    toggleFavorite: (path: string) => Promise<boolean>
    removeFromRecent: (path: string) => Promise<void>
    getContentChecksum: () => Promise<string | null>
    setContentChecksum: (checksum: string) => Promise<void>
    hasContentChanged: (currentChecksum: string) => Promise<boolean>
    onStateChanged: (callback: (state: FileServiceState) => void) => () => void
    onDirtyChanged: (callback: (isDirty: boolean) => void) => () => void
    onFileOpened: (callback: (state: FileServiceState) => void) => () => void
    onFileClosed: (callback: () => void) => () => void
    // Save unit v2 API
    hydrateSaveUnit: (params: {
      runtimeId: string
      kind: 'file' | 'folder'
      reference: unknown
      parentId?: string
    }) => Promise<void>
    upsertSaveUnit: (params: {
      runtimeId: string
      kind: 'file' | 'folder'
      draft: unknown
      reason?: SaveUnitDirtyReason
      parentId?: string
    }) => Promise<void>
    markSaveUnitDeleted: (runtimeId: string) => Promise<void>
    commitSaveUnit: (runtimeId: string) => Promise<void>
    revertSaveUnit: (runtimeId: string) => Promise<void>
    getSaveUnitsSnapshot: () => Promise<{
      isDirty: boolean
      dirtyCount: number
      dirtyUnits: { runtimeId: string; reason?: SaveUnitDirtyReason }[]
    }>
    onUnitDirtyChanged: (
      callback: (payload: { runtimeId: string; isDirty: boolean; reason?: SaveUnitDirtyReason }) => void
    ) => () => void
    onDraftsRestored: (
      callback: (payload: { count: number }) => void
    ) => () => void
    saveUnit: (entry: {
      runtimeId: string
      content: unknown
      absolutePath: string
      format: 'json' | 'json5' | 'yaml'
    }) => Promise<boolean>
    saveUnitsBatch: (
      entries: { runtimeId: string; content: unknown; absolutePath: string; format: 'json' | 'json5' | 'yaml' }[]
    ) => Promise<{ runtimeId: string; success: boolean }[]>
  }
}

export type SaveUnitDirtyReason = 'modify' | 'create' | 'delete' | 'rename' | 'move' | 'reorder'

const getApi = (): WindowFileApi['file'] | null => {
  try {
    const w = window as unknown as { api?: WindowFileApi }
    if (!w.api) return null
    return w.api.file
  } catch {
    return null
  }
}

/**
 * Hook to use the file service
 * Provides file operations and state management
 */
export const useFileService = (): {
  // State
  state: FileServiceState | null
  isLoading: boolean
  fileName: string | null
  filePath: string | null
  isDirty: boolean
  recentFiles: FileMetadata[]
  favorites: FileMetadata[]
  // Actions
  newFile: () => Promise<boolean>
  open: (path?: string) => Promise<{ success: boolean; content?: unknown }>
  save: (content: unknown) => Promise<boolean>
  saveAs: (content: unknown, filename?: string, format?: SerializationFormat) => Promise<boolean>
  close: () => Promise<boolean>
  showUnsavedChangesDialog: (labels?: UnsavedChangesDialogLabels) => Promise<'save' | 'discard' | 'cancel'>
  toggleFavorite: (path: string) => Promise<boolean>
  removeFromRecent: (path: string) => Promise<void>
  refresh: () => Promise<void>
} => {
  const [state, setState] = useState<FileServiceState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [recentFiles, setRecentFiles] = useState<FileMetadata[]>([])
  const [favorites, setFavorites] = useState<FileMetadata[]>([])

  // Refresh state from the service
  const refresh = useCallback(async (): Promise<void> => {
    const api = getApi()
    if (!api) {
      setIsLoading(false)
      return
    }

    try {
      const [newState, recent, favs] = await Promise.all([
        api.getState(),
        api.getRecentFiles(),
        api.getFavorites()
      ])
      setState(newState)
      setRecentFiles(recent)
      setFavorites(favs)
    } catch {
      // Ignore errors
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    void refresh()
  }, [refresh])

  // Subscribe to state changes
  useEffect(() => {
    const api = getApi()
    if (!api) return

    const unsubscribe = api.onStateChanged((newState) => {
      setState(newState)
      setRecentFiles(newState.recentFiles)
      setFavorites(newState.favorites)
    })

    return unsubscribe
  }, [])

  // Actions
  const newFile = useCallback(async (): Promise<boolean> => {
    const api = getApi()
    if (!api) return false
    const result = await api.newFile()
    await refresh()
    return result
  }, [refresh])

  const open = useCallback(async (path?: string): Promise<{ success: boolean; content?: unknown }> => {
    const api = getApi()
    if (!api) return { success: false }
    const result = await api.open(path)
    await refresh()
    return result
  }, [refresh])

  const save = useCallback(async (content: unknown): Promise<boolean> => {
    const api = getApi()
    if (!api) return false
    const result = await api.save(content)
    await refresh()
    return result
  }, [refresh])

  const saveAs = useCallback(async (
    content: unknown,
    filename?: string,
    format?: SerializationFormat
  ): Promise<boolean> => {
    const api = getApi()
    if (!api) return false
    const result = await api.saveAs(content, filename, format)
    await refresh()
    return result
  }, [refresh])

  const close = useCallback(async (): Promise<boolean> => {
    const api = getApi()
    if (!api) return false
    const result = await api.close()
    await refresh()
    return result
  }, [refresh])

  const showUnsavedChangesDialog = useCallback(async (labels?: UnsavedChangesDialogLabels): Promise<'save' | 'discard' | 'cancel'> => {
    const api = getApi()
    if (!api) return 'cancel'
    return api.showUnsavedChangesDialog(labels)
  }, [])

  const toggleFavorite = useCallback(async (path: string): Promise<boolean> => {
    const api = getApi()
    if (!api) return false
    const result = await api.toggleFavorite(path)
    await refresh()
    return result
  }, [refresh])

  const removeFromRecent = useCallback(async (path: string): Promise<void> => {
    const api = getApi()
    if (!api) return
    await api.removeFromRecent(path)
    await refresh()
  }, [refresh])

  return {
    state,
    isLoading,
    fileName: state?.currentFile.name ?? null,
    filePath: state?.currentFile.path ?? null,
    isDirty: state?.currentFile.isDirty ?? false,
    recentFiles,
    favorites,
    newFile,
    open,
    save,
    saveAs,
    close,
    showUnsavedChangesDialog,
    toggleFavorite,
    removeFromRecent,
    refresh
  }
}

/**
 * Hook to track the global dirty state — derived from the save-unit
 * registry by the main process. Read-only: to flip dirty state, mutate
 * a unit via `upsertSaveUnit` / `markSaveUnitDeleted` and let the
 * registry fire the transition.
 */
export const useFileDirty = (): { isDirty: boolean } => {
  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => {
    const api = getApi()
    if (!api) return

    // Get initial state
    void api.isDirty().then(setIsDirty)

    // Subscribe to changes
    const unsubscribe = api.onDirtyChanged(setIsDirty)
    return unsubscribe
  }, [])

  return { isDirty }
}

/**
 * Utility to get file name imperatively
 */
export const getFileName = async (): Promise<string | null> => {
  const api = getApi()
  if (!api) return null
  return api.getFileName()
}

/**
 * Utility to get file path imperatively
 */
export const getFilePath = async (): Promise<string | null> => {
  const api = getApi()
  if (!api) return null
  return api.getFilePath()
}

/**
 * Hook to listen to file events (opened, closed)
 * Uses refs to ensure callbacks are stable and events are never missed
 * @param onOpened - Callback when a file is opened
 * @param onClosed - Callback when a file is closed
 */
export const useFileEvents = (
  onOpened?: (state: FileServiceState) => void,
  onClosed?: () => void
): void => {
  // Use refs to store callbacks so we never miss events during re-renders
  const onOpenedRef = useRef(onOpened)
  const onClosedRef = useRef(onClosed)

  // Keep refs updated with latest callbacks
  useEffect(() => {
    onOpenedRef.current = onOpened
    onClosedRef.current = onClosed
  }, [onOpened, onClosed])

  // Subscribe to events once and use refs to call current callbacks
  useEffect(() => {
    const api = getApi()
    if (!api) return

    const unsubscribers: (() => void)[] = []

    // Always subscribe, use ref to call current callback
    unsubscribers.push(api.onFileOpened((state) => {
      onOpenedRef.current?.(state)
    }))

    unsubscribers.push(api.onFileClosed(() => {
      onClosedRef.current?.()
    }))

    return () => {
      for (const unsub of unsubscribers) {
        unsub()
      }
    }
  }, []) // Empty deps - subscribe once on mount
}

/**
 * Get the content checksum from the file service
 * Returns the JSON stringified content at last save/open
 */
export const getContentChecksum = async (): Promise<string | null> => {
  const api = getApi()
  if (!api) return null
  return api.getContentChecksum()
}

/**
 * Set the content checksum in the file service
 * @param checksum JSON stringified content
 */
export const setContentChecksum = async (checksum: string): Promise<void> => {
  const api = getApi()
  if (!api) return
  await api.setContentChecksum(checksum)
}

/**
 * Check if content has changed from the saved/opened state
 * @param currentChecksum JSON stringified current content
 * @returns true if content has changed
 */
export const hasContentChanged = async (currentChecksum: string): Promise<boolean> => {
  const api = getApi()
  if (!api) return false
  return api.hasContentChanged(currentChecksum)
}

/**
 * Signal that file loading/initialization is complete
 * Call this after the renderer has finished initializing the file content
 */
export const finishLoading = async (): Promise<void> => {
  const api = getApi()
  if (!api) return
  await api.finishLoading()
}

// ==========================================================================
// Save Unit V2 API
// ==========================================================================

/**
 * Subscribe to a single save unit's dirty state. Rerenders the caller
 * every time the file service broadcasts a change for the supplied
 * `runtimeId`. Initial state is hydrated from the registry snapshot on
 * mount. Safe to call from tab rows, tree nodes, headers, etc.
 */
export const useUnitDirtyState = (
  runtimeId: string | null | undefined
): { isDirty: boolean; reason: SaveUnitDirtyReason | undefined } => {
  const [isDirty, setIsDirty] = useState(false)
  const [reason, setReason] = useState<SaveUnitDirtyReason | undefined>(undefined)

  useEffect(() => {
    if (!runtimeId) {
      // Reset state asynchronously so we don't schedule a render
      // synchronously inside a parent's commit phase — React 19 flags
      // that with `react-hooks/set-state-in-effect`.
      queueMicrotask(() => {
        setIsDirty(false)
        setReason(undefined)
      })
      return
    }
    const api = getApi()
    if (!api) return

    let cancelled = false
    // Subscribe *before* the snapshot fetch so events that arrive
    // while the snapshot is in flight are not lost. If a live event
    // has landed by the time the snapshot resolves, the snapshot is
    // necessarily stale — discard it and trust the event.
    let liveUpdateReceived = false
    const off = api.onUnitDirtyChanged((payload) => {
      if (cancelled) return
      if (payload.runtimeId !== runtimeId) return
      liveUpdateReceived = true
      setIsDirty(payload.isDirty)
      setReason(payload.reason)
    })
    void api.getSaveUnitsSnapshot().then((snapshot) => {
      if (cancelled || liveUpdateReceived) return
      const entry = snapshot.dirtyUnits.find((u) => u.runtimeId === runtimeId)
      setIsDirty(Boolean(entry))
      setReason(entry?.reason)
    })

    return () => {
      cancelled = true
      off()
    }
  }, [runtimeId])

  return { isDirty, reason }
}

/**
 * Aggregate view of every dirty save-unit. Seeds from the current
 * registry snapshot on mount and updates on every per-unit event. The
 * returned set is referentially stable across re-renders when the dirty
 * membership hasn't changed — useful for passing into deep trees that
 * rely on `===` to skip work.
 */
export const useDirtyUnitsSet = (): ReadonlySet<string> => {
  const [dirty, setDirty] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    const api = getApi()
    if (!api) return

    let cancelled = false
    const mutable = new Set<string>()
    // Subscribe first so no event is missed between snapshot request and response.
    const off = api.onUnitDirtyChanged((payload) => {
      if (cancelled) return
      const before = mutable.has(payload.runtimeId)
      if (payload.isDirty) mutable.add(payload.runtimeId)
      else mutable.delete(payload.runtimeId)
      if (before !== payload.isDirty) {
        setDirty(new Set(mutable))
      }
    })
    void api.getSaveUnitsSnapshot().then((snapshot) => {
      if (cancelled) return
      for (const u of snapshot.dirtyUnits) mutable.add(u.runtimeId)
      setDirty(new Set(mutable))
    })

    return () => {
      cancelled = true
      off()
    }
  }, [])

  return dirty
}

/** Imperative lookup of the current save-units snapshot. */
export const getSaveUnitsSnapshot = async (): Promise<{
  isDirty: boolean
  dirtyCount: number
  dirtyUnits: { runtimeId: string; reason?: SaveUnitDirtyReason }[]
}> => {
  const api = getApi()
  if (!api) return { isDirty: false, dirtyCount: 0, dirtyUnits: [] }
  return api.getSaveUnitsSnapshot()
}

/** Hydrate (or re-hydrate) a unit with its on-disk reference state. */
export const hydrateSaveUnit = async (params: {
  runtimeId: string
  kind: 'file' | 'folder'
  reference: unknown
  parentId?: string
}): Promise<void> => {
  const api = getApi()
  if (!api) return
  await api.hydrateSaveUnit(params)
}

/** Record a mutation — auto-creates the unit if it's new. */
export const upsertSaveUnit = async (params: {
  runtimeId: string
  kind: 'file' | 'folder'
  draft: unknown
  reason?: SaveUnitDirtyReason
  parentId?: string
}): Promise<void> => {
  const api = getApi()
  if (!api) return
  await api.upsertSaveUnit(params)
}

export const markSaveUnitDeleted = async (runtimeId: string): Promise<void> => {
  const api = getApi()
  if (!api) return
  await api.markSaveUnitDeleted(runtimeId)
}

export const commitSaveUnit = async (runtimeId: string): Promise<void> => {
  const api = getApi()
  if (!api) return
  await api.commitSaveUnit(runtimeId)
}

export const revertSaveUnit = async (runtimeId: string): Promise<void> => {
  const api = getApi()
  if (!api) return
  await api.revertSaveUnit(runtimeId)
}

/**
 * Persist a single save unit to disk atomically. Commits the unit in
 * the registry on success — dirty state clears and any draft file is
 * deleted via the registry event bridge.
 *
 * The caller supplies the absolute target path because only the
 * renderer knows the tree's on-disk layout for each unit.
 */
export const saveUnitToDisk = async (entry: {
  runtimeId: string
  content: unknown
  absolutePath: string
  format: 'json' | 'json5' | 'yaml'
}): Promise<boolean> => {
  const api = getApi()
  if (!api) return false
  return api.saveUnit(entry)
}

/**
 * Persist a batch of save units in a single IPC round trip. Per-unit
 * failures do not short-circuit the batch — the returned array shows
 * each outcome individually.
 */
export const saveUnitsToDiskBatch = async (
  entries: { runtimeId: string; content: unknown; absolutePath: string; format: 'json' | 'json5' | 'yaml' }[]
): Promise<{ runtimeId: string; success: boolean }[]> => {
  const api = getApi()
  if (!api) return []
  return api.saveUnitsBatch(entries)
}

/**
 * Subscribe to the `file:drafts-restored` broadcast — fired at project
 * open when one or more drafts were successfully loaded from disk.
 * Typical usage: push a toast via `toasterService.push(…)`.
 */
export const useDraftsRestored = (
  callback: (payload: { count: number }) => void
): void => {
  const callbackRef = useRef(callback)
  useEffect(() => { callbackRef.current = callback }, [callback])
  useEffect(() => {
    const api = getApi()
    if (!api) return
    return api.onDraftsRestored((payload) => {
      callbackRef.current(payload)
    })
  }, [])
}
