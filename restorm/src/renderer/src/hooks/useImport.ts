/**
 * Hook for managing import operations
 */

import React, { useCallback, useState } from 'react'
import { eventBus, logger } from 'electron-core-ui/renderer'
import { DocumentEvents } from '../services/DocumentEvents'
import { makeReactiveFolder, makeReactiveRequest, makeReactiveApiDesign } from '../types/reactive'
import { processAfterDeserialization } from '../utils/serialization'
import { reidentifyForest } from '../../../shared/utils/reidentifyTree'
import { cloneForEventBus } from '../utils/cloneForEventBus'
import type { Folder, EnvironmentFolder, Environment, FolderItem } from '../../../shared/types/collections'
import { isScenario, isApiDesign } from '../../../shared/types/collections'

export interface UseImportOptions {
  rootItems: FolderItem[]
  setRootItems: React.Dispatch<React.SetStateAction<FolderItem[]>>
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

/**
 * Threaded from `ImportModal`'s last successful `import:preview` call, so
 * `handleImport` can fire the post-import seed IPC once the tree's final
 * ids are known. Absent for import paths that don't carry a format (e.g.
 * the gRPC reflection import, which isn't a registered `ImportProvider`) —
 * `handleImport` just skips seeding in that case.
 */
export interface ImportMeta {
  /** Same `source` string passed to `import:preview` (URL or file path). */
  source: string
  format: string
  extraHeaders?: Record<string, string>
  /** `payloadChecksum` from the preview result, see `runPostImportSeed`
   * in `ImportManager.ts`. */
  expectedChecksum?: string
}

export interface UseImportReturn {
  handleImport: (items: FolderItem[], meta?: ImportMeta) => void
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
    (items: FolderItem[], meta?: ImportMeta) => {
      logger.debug('[useImport] Importing items', {
        count: items.length,
        rootItemsCount: rootItems.length
      })

      // Emit ENVIRONMENT_CREATED for every env (and nested sub-envs) on an
      // imported EnvironmentFolder so ContextService can register them and
      // handlebars variable resolution (e.g. `{{baseUrl}}`) works without
      // waiting for a file save + reload.
      const emitEnvironmentTree = (
        env: Environment,
        envFolderId: string,
        parentEnvironmentId: string | null
      ): void => {
        // `cloneForEventBus` instead of `JSON.parse(JSON.stringify(...))`:
        // the latter calls `SecretValue.toJSON()` which drops the
        // plaintext, so main-side `ContextService` would receive every
        // secret as an empty string and templated headers like
        // `Bearer {{JWTBearer_token}}` would substitute to `Bearer `
        // on the wire. The custom walker copies own enumerable props
        // (so the `value` field survives), never invokes `toJSON`, and
        // tolerates the reactive Proxy graph in any environment.
        eventBus.emitSync(DocumentEvents.ENVIRONMENT_CREATED, {
          id: env.id,
          type: 'environment',
          document: cloneForEventBus(env),
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
          if ('items' in child && !isScenario(child)) emitNestedEnvironments(child)
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
        if ('items' in item && !isScenario(item)) {
          const folder = item
          eventBus.emitSync(DocumentEvents.FOLDER_CREATED, {
            id: folder.id,
            type: 'folder',
            // See `emitEnvironmentTree` — `cloneForEventBus` preserves
            // SecretValue secrets so main-side ContextService can
            // substitute templated headers correctly.
            document: cloneForEventBus(folder)
          })
          emitNestedEnvironments(folder)
        } else {
          const request = item
          eventBus.emitSync(DocumentEvents.REQUEST_CREATED, {
            id: request.id,
            type: 'request',
            document: cloneForEventBus(request)
          })
        }
      }

      // Imported items arrive over IPC as plain JSON — `ExpressionValue`
      // instances created by the main-side importer survive only as
      // `{ type: 'expression', value }` POJOs after structured clone.
      // Run them through the same deserialisation pass we use for
      // file loads so KeyValue ids are stable and every `ValueType`
      // becomes a real class instance before reaching the renderer's
      // `instanceof`-driven cell renderers.
      const itemsWithNewIds = processAfterDeserialization(items)

      // Re-identify the whole imported forest — a fresh id for EVERY
      // id-bearing node (folders, requests, environments, sub-envs, enum
      // definitions, custom value lists, scenario nodes/edges, quick
      // configs) and every known reference key remapped onto the new ids,
      // cross-item references between sibling roots included. This is the
      // same primitive the Clone action uses; the previous inline pass only
      // re-id'd folders/requests and remapped three reference kinds, which
      // was enough for external specs but leaves everything else colliding
      // when the imported tree is a full `.restorm` project (whose ids may
      // even belong to THIS very project, when a file is imported into
      // itself).
      //
      // Order matters: AFTER `processAfterDeserialization`, never before.
      // Some importers (cURL, PowerShell, REST Client) emit a root folder
      // WITHOUT an id; `reassignTreeIds` deliberately skips id-less nodes,
      // and the deserialisation pass then derives a DETERMINISTIC id for
      // them — so re-identifying first would land two successive pastes as
      // two root folders SHARING one id. Running after the pass, every
      // document node carries an id and gets a fresh one. (KeyValue rows
      // stay outside the reassignment either way — `reidentifyTree`'s
      // container list deliberately doesn't descend into `headers`/`params`/
      // `variables`; their duplicate ids self-heal on the next load via the
      // path-derived dedup.)
      const idMap = reidentifyForest(itemsWithNewIds)

      logger.debug('[useImport] Items with new IDs', { count: itemsWithNewIds.length })

      // Let the imported format run its post-import side effect (e.g.
      // HAR's response-history seeding) now that every item has the id it
      // will actually keep — `idMap` maps the parser's original id to the
      // final one `regenerateIds` just stamped. Fire-and-forget: this is a
      // best-effort enhancement (recorded responses show up in history),
      // never a reason to hold up the visible import, and `meta` is absent
      // for import paths with no registered `ImportProvider` (e.g. gRPC
      // reflection) — nothing to seed there.
      if (meta) {
        void window.restorm?.import
          .postImportSeed({
            source: meta.source,
            format: meta.format,
            idMap: Object.fromEntries(idMap),
            ...(meta.extraHeaders !== undefined ? { extraHeaders: meta.extraHeaders } : {}),
            ...(meta.expectedChecksum !== undefined ? { expectedChecksum: meta.expectedChecksum } : {})
          })
          .catch((error: unknown) => {
            logger.error('[useImport] postImportSeed failed', { error: error instanceof Error ? error.message : String(error) })
          })
      }

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
        isScenario(item) ? item : isApiDesign(item) ? makeReactiveApiDesign(item) : 'items' in item ? makeReactiveFolder(item) : makeReactiveRequest(item)
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
