import {
  importNaturalKeyForRequest,
  walkImportTreeWithKeys
} from '../../../../shared/utils/importNaturalKey'
import type { FolderItem } from '../../../../shared/types/folderTypes'
import { isAnyFolder, isRequest } from '../../../../shared/types/collections'

/**
 * Compute the initial selection set for a parsed import preview —
 * every leaf is selected by default, mirroring the legacy "import
 * everything" behaviour. Exposed as a helper so consumers can also
 * use it as a "Select all" reset.
 */
export function allLeafKeys(items: readonly FolderItem[]): Set<string> {
  const out = new Set<string>()
  const walk = (subtree: readonly FolderItem[]): void => {
    for (const item of subtree) {
      if (isAnyFolder(item)) walk(item.items)
      else if (isRequest(item)) out.add(importNaturalKeyForRequest(item))
    }
  }
  walk(items)
  return out
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
