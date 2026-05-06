/**
 * Hook for managing import operations
 */

import React, { useCallback, useState } from 'react'
import { eventBus, logger } from 'electron-core-ui/renderer'
import { DocumentEvents } from '../services/DocumentEvents'
import { makeReactiveFolder, makeReactiveRequest } from '../types/reactive'
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
  handleImport: (items: FolderItem[]) => void
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
    (items: FolderItem[]) => {
      logger.debug('[useImport] Importing items', {
        count: items.length,
        rootItemsCount: rootItems.length
      })

      // Regenerate all IDs to avoid conflicts with existing items.
      // Keeps an `old → new` map so we can remap cross-item
      // references (`authenticationRequestId`) in a second pass —
      // otherwise requests wired up upstream with
      // `authenticationRequestId: <old auth id>` point at a node
      // that no longer exists after regeneration.
      const idMap = new Map<string, string>()
      const regenerateIds = (item: FolderItem): FolderItem => {
        const newId = crypto.randomUUID()
        idMap.set(item.id, newId)
        if ('items' in item) {
          const folder = item
          return {
            ...folder,
            id: newId,
            items: folder.items.map((child) => regenerateIds(child))
          }
        } else {
          const request = item
          return {
            ...request,
            id: newId
          }
        }
      }

      // Walk a regenerated tree and fix any `authenticationRequestId`
      // that still points at a pre-regeneration id. Runs top-down;
      // cheap even on a 10k-route tree because it only touches
      // already-shallow-cloned nodes.
      const remapAuthRefs = (item: FolderItem): FolderItem => {
        if ('items' in item) {
          let next: FolderItem = { ...item, items: item.items.map(remapAuthRefs) }
          // Env folders may carry an `apiUpdate.authenticationRequestId`
          // that points at the auth request the import flow attached.
          // The regenerateIds pass above stamped a fresh id on the
          // attached auth, so remap the env-folder reference here too —
          // otherwise the refresh-from-source path looks up the auth
          // route by the stale pre-regen id, falls back to "no auth",
          // and the spec fetch 401's.
          const apiUpdate = (next as unknown as { apiUpdate?: { authenticationRequestId?: string } }).apiUpdate
          if (apiUpdate?.authenticationRequestId) {
            const remapped = idMap.get(apiUpdate.authenticationRequestId)
            if (remapped !== undefined && remapped !== apiUpdate.authenticationRequestId) {
              next = {
                ...next,
                apiUpdate: { ...apiUpdate, authenticationRequestId: remapped }
              } as FolderItem
            }
          }
          return next
        }
        const current = (item as { authenticationRequestId?: string }).authenticationRequestId
        if (current !== undefined) {
          const remapped = idMap.get(current)
          if (remapped !== undefined && remapped !== current) {
            return { ...item, authenticationRequestId: remapped }
          }
        }
        return item
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
      const emitTopLevelCreated = (item: FolderItem): void => {
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
            document: JSON.parse(JSON.stringify(request)) as Request
          })
        }
      }

      const regenerated = items.map((item) => regenerateIds(item))
      const itemsWithNewIds = regenerated.map((item) => remapAuthRefs(item))

      logger.debug('[useImport] Items with new IDs', { count: itemsWithNewIds.length })

      // Expand every folder we just imported (and every sub-folder inside
      // them) so the user sees the full imported structure in the sidebar.
      const importedFolderIds = collectFolderIds(itemsWithNewIds)

      // Defer the expansion so React first paints the new `rootItems`
      // with folders collapsed (a small tree: just the top-level
      // folders) before turning around and re-rendering the whole
      // expanded 10k-leaf sidebar. Without the microtask the two state
      // updates batch into a single commit whose render has to lay
      // out every descendant up front, blocking the first paint.
      const expandAfterImport = (): void => {
        if (importedFolderIds.length === 0) return
        queueMicrotask(() => {
          setExpandedIds((prev) => Array.from(new Set([...prev, ...importedFolderIds])))
        })
      }

      // Collect env-folder IDs from the top-level imported items for
      // automatic tab-opening after the import.
      const collectEnvFolderIds = (importedItems: FolderItem[]): string[] =>
        importedItems
          .filter((item) => 'items' in item && 'environments' in item)
          .map((item) => item.id)

      // Imports always land at the root of the tree. Folders go through
      // `makeReactiveFolder`, root-level requests through
      // `makeReactiveRequest` so their edits emit `REQUEST_UPDATED`
      // and flow into the dirty tracker / search index like any
      // nested request.
      const reactiveImported = itemsWithNewIds.map((item) =>
        'items' in item ? makeReactiveFolder(item) : makeReactiveRequest(item)
      )
      setRootItems((prev) => [...prev, ...reactiveImported])
      expandAfterImport()

      // One CREATED per top-level item — descendants land in the search
      // index via SearchIndexService's recursive walk inside
      // `FOLDER_CREATED`.
      itemsWithNewIds.forEach((item) => { emitTopLevelCreated(item) })

      setPendingEnvFolderIds(collectEnvFolderIds(itemsWithNewIds))

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
