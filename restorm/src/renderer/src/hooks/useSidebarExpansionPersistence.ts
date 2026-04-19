import { useEffect, useMemo, useRef } from 'react'
import type { EnvironmentFolder, Folder, Request } from '../../../shared/types/collections'
import { logger } from 'electron-core-ui/renderer'
import { collectAllFolderIds } from '../services/FolderToListView'
import {
  filterKnownIds,
  getStoredExpansion,
  setStoredExpansion
} from '../services/sidebarExpansionStore'

/**
 * Debounce window between the last expand/collapse toggle and the disk
 * write. Short enough to feel instant but long enough to coalesce a
 * burst of toggles (e.g. "expand all" that fans out).
 */
const WRITE_DEBOUNCE_MS = 300

type RootItem = EnvironmentFolder | Folder | Request

function isAnyFolderLike(item: RootItem): item is EnvironmentFolder | Folder {
  return 'items' in item && Array.isArray((item as { items?: unknown[] }).items)
}

function collectFolderIds(items: readonly RootItem[]): string[] {
  const out: string[] = []
  for (const item of items) {
    if (isAnyFolderLike(item)) {
      out.push(...collectAllFolderIds(item))
    }
  }
  return out
}

export interface UseSidebarExpansionPersistenceOptions {
  filePath: string | null | undefined
  rootItems: RootItem[]
  expandedIds: string[]
  setExpandedIds: React.Dispatch<React.SetStateAction<string[]>>
}

/**
 * Persists the sidebar's `expandedIds` per-project under the
 * `restorm-main-sidebar:<filePath>` storage key, and restores it after
 * `rootItems` become available on file open.
 *
 * - First open of a given file with no stored state → default to
 *   "expand everything" (same IDs the sidebar showed before this ticket
 *   existed; matches the `onCollapseAll` fallback expectation).
 * - Stored state is filtered against the current tree on restore so
 *   stale ids (deleted folders) drop out silently.
 * - Writes are debounced (300 ms) so a burst of toggles coalesces into
 *   a single IO.
 * - `null`/empty `filePath` (app boot, welcome screen) → persistence is
 *   dormant; nothing is read or written.
 */
export function useSidebarExpansionPersistence(
  options: UseSidebarExpansionPersistenceOptions
): void {
  const { filePath, rootItems, expandedIds, setExpandedIds } = options

  const restoredForPathRef = useRef<string | null>(null)
  const latestExpandedRef = useRef<string[]>(expandedIds)

  useEffect(() => {
    latestExpandedRef.current = expandedIds
  }, [expandedIds])

  const allFolderIds = useMemo(() => collectFolderIds(rootItems), [rootItems])

  // Reset the restore guard when the file path changes so reopening a
  // project re-hydrates from storage rather than reusing the last state.
  useEffect(() => {
    restoredForPathRef.current = null
  }, [filePath])

  // Restore — runs once per (filePath, tree-ready) pair.
  useEffect(() => {
    if (!filePath || rootItems.length === 0) return
    if (restoredForPathRef.current === filePath) return
    restoredForPathRef.current = filePath

    void (async (): Promise<void> => {
      try {
        const stored = await getStoredExpansion(filePath)
        if (stored === null) {
          // First visit to this file: fall back to "expand all".
          setExpandedIds(allFolderIds)
          return
        }
        setExpandedIds(filterKnownIds(stored, allFolderIds))
      } catch (error) {
        logger.warn('[useSidebarExpansionPersistence] failed to restore', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    })()
  }, [filePath, rootItems, allFolderIds, setExpandedIds])

  // Debounced write on every change after restore.
  useEffect(() => {
    if (!filePath) return
    if (restoredForPathRef.current !== filePath) return

    const snapshot = latestExpandedRef.current
    const handle = setTimeout(() => {
      void setStoredExpansion(filePath, snapshot).catch((error: unknown) => {
        logger.warn('[useSidebarExpansionPersistence] failed to persist', {
          error: error instanceof Error ? error.message : String(error)
        })
      })
    }, WRITE_DEBOUNCE_MS)

    return () => { clearTimeout(handle) }
  }, [filePath, expandedIds])
}
