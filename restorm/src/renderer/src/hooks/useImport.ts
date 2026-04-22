/**
 * Hook for managing import operations
 */

import React, { useCallback, useState } from 'react'
import { eventBus, logger } from 'electron-core-ui/renderer'
import { DocumentEvents } from '../services/DocumentEvents'
import { makeReactiveFolder } from '../types/reactive'
import type { Folder, EnvironmentFolder, Environment, Request, FolderItem } from '../../../shared/types/collections'

export interface UseImportOptions {
  rootItems: (EnvironmentFolder | Folder | Request)[]
  setRootItems: React.Dispatch<React.SetStateAction<(EnvironmentFolder | Folder | Request)[]>>
  setExpandedIds: React.Dispatch<React.SetStateAction<string[]>>
  /**
   * Fired once after every successful import, after the new tree has
   * been committed via `setRootItems`. Hosts typically trigger a
   * whole-tree save here so the imported content lands on disk before
   * the user has a chance to edit it — keeping the registry's initial
   * reference aligned with the persisted state.
   */
  onImportComplete?: () => void
}

export interface UseImportReturn {
  handleImport: (
    items: FolderItem[],
    targetFolderId?: string,
    pendingFolders?: { id: string; name: string; parentId: string }[]
  ) => void
  pendingEnvFolderIds: string[]
  clearPendingEnvFolderIds: () => void
}

/** Collect every folder id reachable from the given items (inclusive). */
function collectFolderIds(items: FolderItem[]): string[] {
  const ids: string[] = []
  const walk = (item: FolderItem): void => {
    if (!('items' in item)) return
    ids.push(item.id)
    for (const child of item.items) walk(child)
  }
  for (const item of items) walk(item)
  return ids
}

export function useImport(options: UseImportOptions): UseImportReturn {
  const { rootItems, setRootItems, setExpandedIds, onImportComplete } = options

  const [pendingEnvFolderIds, setPendingEnvFolderIds] = useState<string[]>([])
  const clearPendingEnvFolderIds = useCallback(() => { setPendingEnvFolderIds([]) }, [])

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

      // Emit ENVIRONMENT_CREATED for every env (and nested sub-envs) on an
      // imported EnvironmentFolder so ContextService can register them and
      // handlebars variable resolution (e.g. `{{baseUrl}}`) works without
      // waiting for a file save + reload.
      const emitEnvironmentTree = (
        env: Environment,
        envFolderId: string,
        parentEnvironmentId: string | null
      ): void => {
        eventBus.emitSync(DocumentEvents.ENVIRONMENT_CREATED, {
          id: env.id,
          type: 'environment',
          document: JSON.parse(JSON.stringify(env)) as Environment,
          parentFolderId: envFolderId,
          parentEnvironmentId: parentEnvironmentId ?? undefined
        })
        for (const child of env.subEnvironments ?? []) {
          emitEnvironmentTree(child, envFolderId, env.id)
        }
      }

      // Walk a folder subtree and emit ENVIRONMENT_CREATED for every
      // env / sub-env on every EnvironmentFolder reachable from it.
      // Called in addition to the top-level FOLDER_CREATED below so
      // ContextService (which subscribes to ENVIRONMENT_CREATED) can
      // register every env the tree brings in, regardless of depth.
      const emitNestedEnvironments = (folder: Folder | EnvironmentFolder): void => {
        if ('environments' in folder) {
          for (const env of folder.environments) {
            emitEnvironmentTree(env, folder.id, null)
          }
        }
        for (const child of folder.items) {
          if ('items' in child) emitNestedEnvironments(child)
        }
      }

      // Emit exactly one CREATED event per top-level imported item.
      // For folders we emit FOLDER_CREATED only for the root of the
      // imported subtree — SearchIndexService.indexFolderRecursively
      // walks the document and indexes every descendant on its own.
      // This is the hot path for bulk imports (10k+ OData routes): the
      // old recursive emission fired one IPC per descendant plus one
      // draft write per descendant via App.tsx's save-unit bridge,
      // which dominated the import cost. We accept losing per-
      // descendant drafts during import — `onImportComplete` triggers
      // a full-tree save right after, so crash recovery kicks in off
      // the persisted file, not off per-node drafts.
      const emitTopLevelCreated = (item: FolderItem, parentFolderId: string): void => {
        if ('items' in item) {
          const folder = item
          eventBus.emitSync(DocumentEvents.FOLDER_CREATED, {
            id: folder.id,
            type: 'folder',
            document: JSON.parse(JSON.stringify(folder)) as Folder | EnvironmentFolder
          })
          emitNestedEnvironments(folder)
        } else {
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

      // Expand every folder we just imported (and every sub-folder inside
      // them) so the user sees the full imported structure in the sidebar.
      const importedFolderIds = collectFolderIds(itemsWithNewIds)

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

      // Defer the expansion so React first paints the new `rootItems`
      // with folders collapsed (a small tree: just the top-level
      // folders) before turning around and re-rendering the whole
      // expanded 10k-leaf sidebar. Without the microtask the two state
      // updates batch into a single commit whose render has to lay
      // out every descendant up front, blocking the first paint.
      const expandAfterImport = (): void => {
        const pendingFolderIds = Array.from(createdFoldersMap.values()).map((f) => f.id)
        const newlyExpanded = [...pendingFolderIds, ...importedFolderIds]
        if (newlyExpanded.length === 0) return
        queueMicrotask(() => {
          setExpandedIds((prev) => Array.from(new Set([...prev, ...newlyExpanded])))
        })
      }

      // Collect env-folder IDs from the top-level imported items for
      // automatic tab-opening after the import.
      const collectEnvFolderIds = (importedItems: FolderItem[]): string[] =>
        importedItems
          .filter((item) => 'items' in item && 'environments' in item)
          .map((item) => item.id)

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
        expandAfterImport()

        // Emit one CREATED per top-level imported item — descendants
        // land in the search index via SearchIndexService's recursive
        // walk (see `emitTopLevelCreated` comment).
        filteredItems.forEach((folder) => {
          emitTopLevelCreated(folder, folder.id)
        })

        setPendingEnvFolderIds(collectEnvFolderIds(filteredItems))
        if (onImportComplete) onImportComplete()
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
        expandAfterImport()

        // One CREATED per top-level item — see `emitTopLevelCreated`.
        itemsWithNewIds.forEach((item) => {
          emitTopLevelCreated(item, item.id)
        })

        setPendingEnvFolderIds(collectEnvFolderIds(itemsWithNewIds))
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
      expandAfterImport()

      // One CREATED per top-level item — see `emitTopLevelCreated`.
      // Emit for pending folders first (they become new parents),
      // then for the imported items that nest into them.
      createdFoldersMap.forEach((folder) => {
        emitTopLevelCreated(folder, actualTargetFolderId || folder.id)
      })
      itemsWithNewIds.forEach((item) => {
        emitTopLevelCreated(item, actualTargetFolderId || item.id)
      })

      // Signal the host that the import has landed. The callback fires
      // synchronously here, but hosts that want to trigger a save should
      // defer via state + effect (see App.tsx wiring) because `setRootItems`
      // above hasn't committed yet.
      if (onImportComplete) onImportComplete()
    },
    [rootItems, setRootItems, setExpandedIds, onImportComplete]
  )

  return {
    handleImport,
    pendingEnvFolderIds,
    clearPendingEnvFolderIds
  }
}
