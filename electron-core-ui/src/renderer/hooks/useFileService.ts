import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  FileServiceState,
  FileMetadata,
  SerializationFormat,
  UnsavedChangesDialogLabels
} from '../../types/file'
import { logger } from '../services/logger'

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
    markDirty: () => Promise<void>
    clearDirty: () => Promise<void>
    checkAndUpdateDirty: (currentChecksum: string) => Promise<void>
    finishLoading: () => Promise<void>
    showUnsavedChangesDialog: (labels?: UnsavedChangesDialogLabels) => Promise<'save' | 'discard' | 'cancel'>
    getRecentFiles: () => Promise<FileMetadata[]>
    getFavorites: () => Promise<FileMetadata[]>
    toggleFavorite: (path: string) => Promise<boolean>
    removeFromRecent: (path: string) => Promise<void>
    getContentChecksum: () => Promise<string | null>
    setContentChecksum: (checksum: string) => Promise<void>
    hasContentChanged: (currentChecksum: string) => Promise<boolean>
    // Object checksum tracking
    registerInitialChecksums: (objects: Map<string, unknown>) => Promise<void>
    updateObjectChecksum: (runtimeId: string, data: unknown) => Promise<void>
    removeObjectChecksum: (runtimeId: string) => Promise<void>
    commitChecksums: () => Promise<void>
    getDirtyStateDetails: () => Promise<{
      isDirty: boolean
      changedIds: string[]
      newIds: string[]
      deletedIds: string[]
    }>
    onStateChanged: (callback: (state: FileServiceState) => void) => () => void
    onDirtyChanged: (callback: (isDirty: boolean) => void) => () => void
    onFileOpened: (callback: (state: FileServiceState) => void) => () => void
    onFileClosed: (callback: () => void) => () => void
  }
}

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
  markDirty: () => Promise<void>
  clearDirty: () => Promise<void>
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

  const markDirty = useCallback(async (): Promise<void> => {
    const api = getApi()
    if (!api) return
    await api.markDirty()
    await refresh()
  }, [refresh])

  const clearDirty = useCallback(async (): Promise<void> => {
    const api = getApi()
    if (!api) return
    await api.clearDirty()
    await refresh()
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
    markDirty,
    clearDirty,
    showUnsavedChangesDialog,
    toggleFavorite,
    removeFromRecent,
    refresh
  }
}

/**
 * Hook to track dirty state
 */
export const useFileDirty = (): { isDirty: boolean; markDirty: () => Promise<void>; clearDirty: () => Promise<void> } => {
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

  const markDirty = useCallback(async (): Promise<void> => {
    const api = getApi()
    if (api) {
      await api.markDirty()
    }
  }, [])

  const clearDirty = useCallback(async (): Promise<void> => {
    const api = getApi()
    if (api) {
      await api.clearDirty()
    }
  }, [])

  return { isDirty, markDirty, clearDirty }
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
// Object Checksum Tracking
// ==========================================================================

/**
 * Register initial checksums for all objects when a file is loaded.
 * This establishes the "clean" state baseline.
 * @param objects Map of runtimeId → object data
 */
export const registerInitialChecksums = async (objects: Map<string, unknown>): Promise<void> => {
  logger.debug('[useFileService] registerInitialChecksums called', { count: objects.size })
  const api = getApi()
  if (!api) {
    logger.warn('[useFileService] No API available for registerInitialChecksums')
    return
  }
  await api.registerInitialChecksums(objects)
}

/**
 * Update the checksum for a specific object
 * @param runtimeId Runtime ID of the object
 * @param data Current state of the object
 */
export const updateObjectChecksum = async (runtimeId: string, data: unknown): Promise<void> => {
  const api = getApi()
  if (!api) return
  await api.updateObjectChecksum(runtimeId, data)
}

/**
 * Remove an object from checksum tracking (when object is deleted)
 * @param runtimeId Runtime ID of the object
 */
export const removeObjectChecksum = async (runtimeId: string): Promise<void> => {
  const api = getApi()
  if (!api) return
  await api.removeObjectChecksum(runtimeId)
}

/**
 * Commit current checksums as the new "saved" state.
 * Call this after a successful save operation.
 */
export const commitChecksums = async (): Promise<void> => {
  const api = getApi()
  if (!api) return
  await api.commitChecksums()
}

/**
 * Get detailed dirty state information including which objects changed
 */
export const getDirtyStateDetails = async (): Promise<{
  isDirty: boolean
  changedIds: string[]
  newIds: string[]
  deletedIds: string[]
}> => {
  const api = getApi()
  if (!api) return { isDirty: false, changedIds: [], newIds: [], deletedIds: [] }
  return api.getDirtyStateDetails()
}

/**
 * Check and update dirty state based on content checksum
 * Compares the provided checksum with the saved checksum and updates dirty state accordingly
 * @param currentChecksum JSON stringified current content
 */
export const checkAndUpdateDirty = async (currentChecksum: string): Promise<void> => {
  const api = getApi()
  if (!api) return
  await api.checkAndUpdateDirty(currentChecksum)
}
