/**
 * Hook for managing import operations
 */

import { useCallback } from 'react'
import { eventBus, logger } from 'electron-core-ui/renderer'
import { DocumentEvents } from '../services/DocumentEvents'
import { makeReactiveFolder } from '../types/reactive'
import type { Folder, EnvironmentFolder, Request, FolderItem } from '../../../shared/types/collections'

export interface UseImportOptions {
  rootItems: (EnvironmentFolder | Folder | Request)[]
  setRootItems: React.Dispatch<React.SetStateAction<(EnvironmentFolder | Folder | Request)[]>>
}

export interface UseImportReturn {
  handleImport: (
    items: FolderItem[],
    targetFolderId?: string,
    pendingFolders?: { id: string; name: string; parentId: string }[]
  ) => void
}

export function useImport(options: UseImportOptions): UseImportReturn {
  const { rootItems, setRootItems } = options

  const handleImport = useCallback(
    (
      items: FolderItem[],
      targetFolderId?: string,
      pendingFolders?: { id: string; name: string; parentId: string }[]
    ) => {
      logger.info('[useImport] Importing items', {
        count: items.length,
        targetFolderId,
        rootItemsCount: rootItems.length,
        pendingFoldersCount: pendingFolders?.length ?? 0
      })

      // Regenerate all IDs to avoid conflicts with existing items
      const regenerateIds = (item: FolderItem): FolderItem => {
        if ('items' in item) {
          // It's a folder (Folder or EnvironmentFolder)
          const folder = item
          return {
            ...folder,
            id: crypto.randomUUID(),
            items: folder.items.map((child) => regenerateIds(child))
          }
        } else {
          // It's a request
          const request = item
          return {
            ...request,
            id: crypto.randomUUID()
          }
        }
      }

      // Emit creation events for all imported items recursively
      const emitCreationEvents = (item: FolderItem, parentFolderId: string): void => {
        if ('items' in item) {
          // It's a folder
          const folder = item
          eventBus.emitSync(DocumentEvents.FOLDER_CREATED, {
            id: folder.id,
            type: 'folder',
            document: JSON.parse(JSON.stringify(folder)) as Folder | EnvironmentFolder
          })
          // Recursively emit for children
          folder.items.forEach((child) => {
            emitCreationEvents(child, folder.id)
          })
        } else {
          // It's a request
          const request = item
          eventBus.emitSync(DocumentEvents.REQUEST_CREATED, {
            id: request.id,
            type: 'request',
            document: JSON.parse(JSON.stringify(request)) as Request,
            parentFolderId
          })
        }
      }

      const itemsWithNewIds = items.map((item) => regenerateIds(item))

      logger.info('[useImport] Items with new IDs', { count: itemsWithNewIds.length })

      // Create pending folders if any
      const createdFoldersMap = new Map<string, Folder | EnvironmentFolder>()
      if (pendingFolders && pendingFolders.length > 0) {
        pendingFolders.forEach((pf) => {
          const newFolder: Folder = {
            id: crypto.randomUUID(),
            name: pf.name,
            items: [],
            documentation: '',
            tags: [],
            configuration: {}
          }
          createdFoldersMap.set(pf.id, newFolder)
          logger.info('[useImport] Created pending folder', {
            name: pf.name,
            id: newFolder.id,
            parentId: pf.parentId
          })
        })
      }

      // Resolve target folder ID: if it's a pending folder, use the created folder's ID
      let actualTargetFolderId = targetFolderId
      if (targetFolderId && createdFoldersMap.has(targetFolderId)) {
        const createdFolder = createdFoldersMap.get(targetFolderId)
        if (createdFolder) {
          actualTargetFolderId = createdFolder.id
          logger.info('[useImport] Target is a pending folder, using created folder ID', {
            pendingId: targetFolderId,
            actualId: actualTargetFolderId
          })
        }
      }

      // If file is empty (no root folders), create the imported items as first root folders
      if (rootItems.length === 0 && !actualTargetFolderId) {
        const filteredItems = itemsWithNewIds.filter((item) => 'items' in item)
        logger.info('[useImport] Empty file - creating first root folders', {
          count: filteredItems.length
        })
        const reactiveRootItems = filteredItems.map((folder) =>
          makeReactiveFolder(folder)
        ) as EnvironmentFolder[]
        setRootItems(reactiveRootItems)

        // Emit creation events for indexing
        filteredItems.forEach((folder) => {
          emitCreationEvents(folder, folder.id)
        })
        return
      }

      // Create deep copies of rootItems to avoid mutating reactive objects
      const clonedRootItems = JSON.parse(JSON.stringify(rootItems)) as (
        | EnvironmentFolder
        | Folder
        | Request
      )[]

      // Helper to add pending folders to the tree
      const addPendingFoldersToTree = (
        folders: FolderItem[],
        parentId: string
      ): (FolderItem | Folder)[] => {
        const pendingForParent = pendingFolders?.filter((pf) => pf.parentId === parentId) ?? []
        const createdForParent = pendingForParent
          .map((pf) => createdFoldersMap.get(pf.id))
          .filter(Boolean) as Folder[]
        return [...folders, ...createdForParent]
      }

      // If no target folder specified OR target is a pending folder for root, add to root
      if (
        !actualTargetFolderId ||
        (targetFolderId &&
          createdFoldersMap.has(targetFolderId) &&
          pendingFolders?.find((pf) => pf.id === targetFolderId)?.parentId === '__root__')
      ) {
        // Get pending folders for root
        const pendingForRoot = pendingFolders?.filter((pf) => pf.parentId === '__root__') ?? []
        const createdForRoot = pendingForRoot
          .map((pf) => createdFoldersMap.get(pf.id))
          .filter((f): f is Folder => f !== undefined)

        // If target IS a pending folder, put ALL items (folders + requests) inside it
        if (targetFolderId && createdFoldersMap.has(targetFolderId)) {
          // Get the created folder by the pending ID (not actualTargetFolderId)
          const targetPendingFolder = createdFoldersMap.get(targetFolderId)
          if (targetPendingFolder) {
            targetPendingFolder.items = itemsWithNewIds
            logger.info('[useImport] Put items inside root pending folder', {
              folderName: targetPendingFolder.name,
              itemsCount: itemsWithNewIds.length
            })
          }
        }

        // Build root items: existing + pending folders + direct imports (if no pending target)
        // Note: itemsWithNewIds can contain Folders, EnvironmentFolders AND Requests
        const directImports =
          targetFolderId && createdFoldersMap.has(targetFolderId) ? [] : itemsWithNewIds
        const allRootItems = [...clonedRootItems, ...createdForRoot, ...directImports]

        // Make reactive - makeReactiveFolder handles Folders/EnvironmentFolders, Requests stay as-is
        const reactiveRootItems = allRootItems.map((item) =>
          'items' in item ? makeReactiveFolder(item) : item
        )
        setRootItems(reactiveRootItems)

        // Emit creation events for ALL imported items (folders + requests)
        itemsWithNewIds.forEach((item) => {
          emitCreationEvents(item, item.id)
        })
        return
      }

      // Find target folder recursively in ALL root folders
      const findAndUpdateFolder = (folder: Folder | EnvironmentFolder, targetId: string): boolean => {
        if (folder.id === targetId) {
          // Check if targetFolderId IS a pending folder that was just created
          const isPendingTarget = targetFolderId ? createdFoldersMap.has(targetFolderId) : false

          if (isPendingTarget && targetFolderId) {
            // Target IS the pending folder: put items directly inside it
            const createdFolder = createdFoldersMap.get(targetFolderId)
            if (createdFolder) {
              createdFolder.items = itemsWithNewIds
              folder.items = [...folder.items, createdFolder]
              logger.info('[useImport] Put items inside nested pending folder', {
                folderName: createdFolder.name,
                itemsCount: itemsWithNewIds.length
              })
            }
          } else {
            // Target is parent: add pending folders as children, then add imported items
            const pendingForThis = addPendingFoldersToTree(folder.items, targetId)
            folder.items = [...pendingForThis, ...itemsWithNewIds]
          }
          return true
        }

        if (folder.items.length > 0) {
          for (const item of folder.items) {
            if ('items' in item) {
              if (findAndUpdateFolder(item, targetId)) {
                return true
              }
            }
          }
        }

        return false
      }

      // Try to find and update in each cloned root folder (skip Requests at root)
      for (const rootItem of clonedRootItems) {
        if ('items' in rootItem && findAndUpdateFolder(rootItem, actualTargetFolderId)) {
          break
        }
      }

      // Make all root items reactive (folders become reactive, requests stay as-is)
      const reactiveRootItems = clonedRootItems.map((item) =>
        'items' in item ? makeReactiveFolder(item) : item
      )
      setRootItems(reactiveRootItems)

      // Emit creation events for indexing
      // Emit for pending folders first
      createdFoldersMap.forEach((folder) => {
        const parentId = actualTargetFolderId || '__root__'
        emitCreationEvents(folder, parentId)
      })
      // Then emit for imported items
      itemsWithNewIds.forEach((item) => {
        const parentId = actualTargetFolderId || '__root__'
        emitCreationEvents(item, parentId)
      })
    },
    [rootItems, setRootItems]
  )

  return {
    handleImport
  }
}
