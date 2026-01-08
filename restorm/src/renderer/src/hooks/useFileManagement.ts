/**
 * Hook for managing file operations (open, save, close)
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  useFileService,
  setContentChecksum,
  finishLoading,
  hasContentChanged,
  registerInitialChecksums,
  commitChecksums,
  eventBus,
  logger,
  computeChecksum
} from 'electron-core-ui/renderer'
import { DocumentEvents, type DocumentChangedPayload } from '../services/DocumentEvents'
import { searchIndexService } from '../services/SearchIndexService'
import { makeReactiveFolder } from '../types/reactive'
import { prepareForSerialization, processAfterDeserialization } from '../utils/serialization'
import { collectAllObjectsForChecksums } from '../utils/checksumHelpers'
import type { Folder, EnvironmentFolder, Request, FolderItem, Environment } from '../types/collections'
import { isEnvironmentFolder, isAnyFolder } from '../types/collections'
import type { PersistenceFormat } from 'electron-core-ui/renderer'
import type { SaveOptions } from '../components/Modals/SaveOptionsModal'

export interface UseFileManagementOptions {
  rootItems: (EnvironmentFolder | Folder | Request)[]
  setRootItems: React.Dispatch<React.SetStateAction<(EnvironmentFolder | Folder | Request)[]>>
  setWorkbenchTree: React.Dispatch<React.SetStateAction<unknown>>
  clearTabDirtyState: () => void
  registerTabDirtyState: (id: string, checksum: string) => void
  markAllTabsSaved: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}

export interface UseFileManagementReturn {
  // File menu handlers
  handleMenuNew: () => Promise<void>
  handleMenuOpen: () => Promise<void>
  handleMenuOpenFolder: () => Promise<void>
  handleMenuSave: () => void
  handleMenuSaveAs: () => void
  handleMenuClose: () => Promise<void>
  handleOpenRecentFile: (path: string) => Promise<void>
  handleSaveWithOptions: (options: SaveOptions) => Promise<void>
  // File state
  isOpenedAsFolder: boolean
  folderFormat: PersistenceFormat
  currentFolderPath: string | null
  // Modals
  showSaveOptionsModal: boolean
  setShowSaveOptionsModal: (show: boolean) => void
}

export function useFileManagement(options: UseFileManagementOptions): UseFileManagementReturn {
  const {
    rootItems,
    setRootItems,
    setWorkbenchTree,
    clearTabDirtyState,
    registerTabDirtyState,
    markAllTabsSaved,
    t
  } = options

  const {
    state: fileState,
    fileName,
    isDirty,
    newFile,
    open: openFile,
    save: saveFile,
    close: closeFile,
    showUnsavedChangesDialog,
    clearDirty
  } = useFileService()

  const [showSaveOptionsModal, setShowSaveOptionsModal] = useState(false)
  const [isOpenedAsFolder, setIsOpenedAsFolder] = useState(false)
  const [folderFormat, setFolderFormat] = useState<PersistenceFormat>('yaml')
  const [currentFolderPath, setCurrentFolderPath] = useState<string | null>(null)

  // Track loading state
  const lastLoadedPathRef = useRef<string | null>(null)
  const isLoadingRef = useRef(false)
  const initialLoadDoneRef = useRef(false)

  // Save handlers
  const handleMenuSave = useCallback(() => {
    const plainData = JSON.parse(JSON.stringify({ collections: rootItems })) as Record<
      string,
      unknown
    >

    if (isOpenedAsFolder && currentFolderPath) {
      void (async () => {
        const result = await window.restorm?.file.saveAsFolder(
          plainData,
          folderFormat,
          currentFolderPath
        )
        if (result?.success) {
          void clearDirty()
        }
      })()
    } else {
      const dataForSave = prepareForSerialization(plainData)
      void saveFile(dataForSave)
    }
  }, [saveFile, rootItems, isOpenedAsFolder, folderFormat, clearDirty, currentFolderPath])

  const handleMenuSaveAs = useCallback(() => {
    setShowSaveOptionsModal(true)
  }, [])

  const handleSaveWithOptions = useCallback(
    async (saveOptions: SaveOptions) => {
      const plainData = JSON.parse(JSON.stringify({ collections: rootItems })) as Record<
        string,
        unknown
      >

      logger.info('[useFileManagement] Saving with options', {
        mode: saveOptions.mode,
        format: saveOptions.format
      })

      try {
        if (saveOptions.mode === 'folder') {
          const result = await window.restorm?.file.saveAsFolder(plainData, saveOptions.format)
          if (result?.success && result.path) {
            logger.info('[useFileManagement] Folder saved successfully', { path: result.path })
            setIsOpenedAsFolder(true)
            setFolderFormat(saveOptions.format)
            setCurrentFolderPath(result.path)
            await clearDirty()
          } else {
            logger.error('[useFileManagement] Failed to save folder', {
              error: result?.error ?? 'Unknown error'
            })
          }
        } else {
          const dataForSave = prepareForSerialization(plainData)
          const result = await window.restorm?.file.saveAsFile(dataForSave, saveOptions.format)
          if (result?.success) {
            logger.info('[useFileManagement] File saved successfully', { path: result.path })
            setIsOpenedAsFolder(false)
            await clearDirty()
          } else {
            logger.error('[useFileManagement] Failed to save file', {
              error: result?.error ?? 'Unknown error'
            })
          }
        }
      } catch (error) {
        logger.error('[useFileManagement] Save error', { error: String(error) })
      }
    },
    [rootItems, clearDirty]
  )

  const checkUnsavedChanges = useCallback(async (): Promise<boolean> => {
    const dataForChecksum = prepareForSerialization({ collections: rootItems })
    const currentChecksum = JSON.stringify(dataForChecksum)
    const hasRealChanges = await hasContentChanged(currentChecksum)

    if (!hasRealChanges) return true

    const result = await showUnsavedChangesDialog({
      title: t('file.unsavedChanges.title'),
      message: t('file.unsavedChanges.message', { fileName: fileName ?? t('file.untitled') }),
      detail: t('file.unsavedChanges.detail'),
      save: t('file.unsavedChanges.save'),
      dontSave: t('file.unsavedChanges.dontSave'),
      cancel: t('file.unsavedChanges.cancel')
    })
    if (result === 'cancel') return false
    if (result === 'save') {
      const plainData = JSON.parse(JSON.stringify({ collections: rootItems })) as unknown
      const dataForSave = prepareForSerialization(plainData)
      const saved = await saveFile(dataForSave)
      return saved
    }
    return true
  }, [showUnsavedChangesDialog, rootItems, saveFile, t, fileName])

  const handleMenuNew = useCallback(async () => {
    const canProceed = await checkUnsavedChanges()
    if (canProceed) {
      await newFile()
    }
  }, [checkUnsavedChanges, newFile])

  const handleMenuOpen = useCallback(async () => {
    const canProceed = await checkUnsavedChanges()
    if (canProceed) {
      setIsOpenedAsFolder(false)
      await openFile()
    }
  }, [checkUnsavedChanges, openFile])

  const handleMenuOpenFolder = useCallback(async () => {
    const canProceed = await checkUnsavedChanges()
    if (canProceed) {
      const result = await window.restorm?.file.openFolder()
      if (result?.success && result.path) {
        setIsOpenedAsFolder(true)
        setFolderFormat(result.format ?? 'yaml')
        setCurrentFolderPath(result.path)
      }
    }
  }, [checkUnsavedChanges])

  const handleMenuClose = useCallback(async () => {
    const canProceed = await checkUnsavedChanges()
    if (canProceed) {
      await closeFile()
    }
  }, [checkUnsavedChanges, closeFile])

  const handleOpenRecentFile = useCallback(
    async (path: string) => {
      const canProceed = await checkUnsavedChanges()
      if (canProceed) {
        await closeFile()
        setIsOpenedAsFolder(false)
        await openFile(path)
      }
    },
    [checkUnsavedChanges, closeFile, openFile]
  )

  // Handle file opened event
  const handleFileOpened = useCallback(
    (state: { currentFile: { content: unknown; path?: string | null; format?: string } }) => {
      const newPath = state.currentFile.path ?? null

      if (isLoadingRef.current && newPath === lastLoadedPathRef.current) {
        return
      }

      isLoadingRef.current = true
      lastLoadedPathRef.current = newPath

      const content = state.currentFile.content as { collections?: EnvironmentFolder[] } | null
      const collections =
        content?.collections && Array.isArray(content.collections) ? content.collections : []

      const path = state.currentFile.path ?? ''
      const openedAsFolder = path !== '' && !/\.(json|yaml|yml|json5|restorm)$/i.test(path)
      setIsOpenedAsFolder(openedAsFolder)
      if (openedAsFolder) {
        const format = state.currentFile.format as PersistenceFormat | undefined
        setFolderFormat(format ?? 'yaml')
        setCurrentFolderPath(path)
      } else {
        setCurrentFolderPath(null)
      }

      clearTabDirtyState()

      const collectionsWithIds = processAfterDeserialization(collections)
      const reactiveItems = collectionsWithIds.map((folder) =>
        makeReactiveFolder(folder)
      ) as EnvironmentFolder[]
      setRootItems(reactiveItems)

      if (openedAsFolder) {
        const registerAllItems = (items: FolderItem[]): void => {
          for (const item of items) {
            const itemChecksum = computeChecksum(JSON.parse(JSON.stringify(item)))
            registerTabDirtyState(item.id, itemChecksum)

            if (isAnyFolder(item)) {
              registerAllItems((item as Folder).items)
            }
          }
        }

        for (const folder of reactiveItems) {
          const folderChecksum = computeChecksum(JSON.parse(JSON.stringify(folder)))
          registerTabDirtyState(folder.id, folderChecksum)
          registerAllItems(folder.items)
        }
      }

      const objectsForChecksums = collectAllObjectsForChecksums(reactiveItems)
      const serializableObjects = new Map<string, unknown>()
      for (const [id, data] of objectsForChecksums) {
        try {
          serializableObjects.set(id, JSON.parse(JSON.stringify(data)))
        } catch (e) {
          logger.warn('[useFileManagement] Failed to serialize object for checksum', {
            id,
            error: e
          })
        }
      }
      logger.info('[useFileManagement] About to register initial checksums', {
        count: serializableObjects.size
      })
      registerInitialChecksums(serializableObjects)
        .then(() => {
          logger.info('[useFileManagement] Initial checksums registered successfully')
        })
        .catch((err: unknown) => {
          logger.error('[useFileManagement] Failed to register initial checksums', {
            error: String(err)
          })
        })

      const dataForChecksum = prepareForSerialization({ collections: reactiveItems })
      void setContentChecksum(JSON.stringify(dataForChecksum))

      void (async () => {
        await searchIndexService.clearIndex()
        await window.restorm?.context.clearAll()

        const emitEnvironmentCreated = (
          env: Environment,
          parentFolderId: string,
          parentEnvironmentId?: string
        ): void => {
          const payload: DocumentChangedPayload = {
            id: env.id,
            type: 'environment',
            document: JSON.parse(JSON.stringify(env)),
            parentFolderId,
            parentEnvironmentId
          }
          eventBus.emitSync(DocumentEvents.ENVIRONMENT_CREATED, payload)
          if (env.subEnvironments) {
            for (const subEnv of env.subEnvironments) {
              emitEnvironmentCreated(subEnv, parentFolderId, env.id)
            }
          }
        }

        for (const folder of reactiveItems) {
          if (isEnvironmentFolder(folder as FolderItem)) {
            const envFolder = folder
            for (const env of envFolder.environments) {
              emitEnvironmentCreated(env, envFolder.id)
            }
          }
        }

        await searchIndexService.initialize()
        for (const folder of reactiveItems) {
          await searchIndexService.indexFolderTree(folder)
        }

        await finishLoading()

        isLoadingRef.current = false
      })()
    },
    [clearTabDirtyState, registerTabDirtyState, setRootItems]
  )

  // Handle file closed event
  const handleFileClosed = useCallback(() => {
    isLoadingRef.current = false
    lastLoadedPathRef.current = null
    setIsOpenedAsFolder(false)
    setCurrentFolderPath(null)
    setWorkbenchTree({
      orientation: 'vertical',
      groups: []
    })
    setRootItems([])
    void searchIndexService.clearIndex()
    void window.restorm?.context.clearAll()
    clearTabDirtyState()
  }, [clearTabDirtyState, setWorkbenchTree, setRootItems])

  // Listen to file events
  useEffect(() => {
    const handleOpened = (state: {
      currentFile: { content: unknown; path?: string | null; format?: string }
    }): void => {
      handleFileOpened(state)
    }

    const cleanup1 = window.restorm?.onFileOpened?.(handleOpened)
    const cleanup2 = window.restorm?.onFileClosed?.(handleFileClosed)

    return () => {
      cleanup1?.()
      cleanup2?.()
    }
  }, [handleFileOpened, handleFileClosed])

  // Save-and-close handler
  useEffect(() => {
    const handleSaveAndClose = async (): Promise<void> => {
      const plainData = JSON.parse(JSON.stringify({ collections: rootItems })) as unknown
      const dataForSave = prepareForSerialization(plainData)
      const saved = await saveFile(dataForSave)
      if (saved) {
        await window.restorm?.forceClose()
      }
    }

    const cleanup = window.restorm?.onSaveAndClose(() => {
      void handleSaveAndClose()
    })

    return cleanup
  }, [rootItems, saveFile])

  // Load file on mount if needed
  useEffect(() => {
    if (initialLoadDoneRef.current) return
    if (!fileState?.currentFile.path) return
    if (rootItems.length > 0) return

    initialLoadDoneRef.current = true
    const rafId = requestAnimationFrame(() => {
      handleFileOpened(fileState)
    })
    return (): void => {
      cancelAnimationFrame(rafId)
    }
  }, [fileState, rootItems.length, handleFileOpened])

  // Commit checksums on save
  useEffect(() => {
    const wasDirtyRef = { current: isDirty }
    if (wasDirtyRef.current && !isDirty && fileName) {
      void commitChecksums()
      logger.debug('[useFileManagement] Checksums committed after save')
      const dataForChecksum = prepareForSerialization({ collections: rootItems })
      void setContentChecksum(JSON.stringify(dataForChecksum))
      markAllTabsSaved()
    }
  }, [isDirty, fileName, rootItems, markAllTabsSaved])

  return {
    handleMenuNew,
    handleMenuOpen,
    handleMenuOpenFolder,
    handleMenuSave,
    handleMenuSaveAs,
    handleMenuClose,
    handleOpenRecentFile,
    handleSaveWithOptions,
    isOpenedAsFolder,
    folderFormat,
    currentFolderPath,
    showSaveOptionsModal,
    setShowSaveOptionsModal
  }
}

