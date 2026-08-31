import {
  importNaturalKeyForFolder,
  importNaturalKeyForRequest,
  walkImportTreeWithKeys
} from '../../../../shared/utils/importNaturalKey'
import type { FolderItem } from '../../../../shared/types/folderTypes'
import { isAnyFolder, isRequest } from '../../../../shared/types/collections'

/**
 * Selectable-leaf keys for a subtree: every Request descendant, or —
 * when a folder's own subtree carries none at all (a documentation-only
 * importer like Thrift, whose services/methods have no executable
 * request behind them) — the folder's own natural key stands in as
 * the sole leaf. Without this fallback a pure-docs import would
 * default to an empty selection and the Import button could never
 * enable, since nothing in the tree would ever be "selected".
 *
 * Shared by `allLeafKeys` (default selection) and the selection
 * tree's tri-state / toggle logic (`ImportSelectionTree.tsx`) so both
 * agree on what counts as a leaf.
 */
export function collectSelectableLeafKeys(items: readonly FolderItem[], path: readonly string[] = []): string[] {
  const out: string[] = []
  for (const item of items) {
    if (isAnyFolder(item)) {
      const childPath = [...path, item.name]
      const childLeaves = collectSelectableLeafKeys(item.items, childPath)
      if (childLeaves.length === 0) {
        out.push(importNaturalKeyForFolder(childPath))
      } else {
        out.push(...childLeaves)
      }
    } else if (isRequest(item)) {
      out.push(importNaturalKeyForRequest(item))
    }
  }
  return out
}

/**
 * Compute the initial selection set for a parsed import preview —
 * every leaf is selected by default, mirroring the legacy "import
 * everything" behaviour. Exposed as a helper so consumers can also
 * use it as a "Select all" reset.
 */
export function allLeafKeys(items: readonly FolderItem[]): Set<string> {
  return new Set(collectSelectableLeafKeys(items))
}

/**
 * Total leaf count in the tree (regardless of folder structure).
 * Used by callers to label the Import button (`Import N items`).
 *
 * `walkImportTreeWithKeys` is deliberately reused so leaf counting
 * stays in lockstep with the natural-key helper — no second
 * definition of "what counts as a leaf" creeping in.
 */
export function leafCount(items: readonly FolderItem[]): number {
  return walkImportTreeWithKeys(items).filter((e) => !isAnyFolder(e.item)).length
}

/**
 * Above this many importable routes, the import modal nudges the user to
 * bring in only what they need. A collection with thousands of routes bloats
 * the sidebar and, at the extreme, can make the whole project too large to
 * serialize to disk — importing selectively is the cure at the source.
 */
export const LARGE_IMPORT_LEAF_THRESHOLD = 200

/**
 * True when a parsed import preview is large enough to warrant the
 * "import only the routes you need" hint. Measures the same leaf count the
 * Import button shows, so the hint and the button always agree.
 */
export function isLargeImport(
  items: readonly FolderItem[],
  threshold: number = LARGE_IMPORT_LEAF_THRESHOLD
): boolean {
  return leafCount(items) > threshold
}
