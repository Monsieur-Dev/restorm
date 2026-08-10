/**
 * Utility functions for manipulating the folder tree structure
 */

import type { FolderItem } from '../../../shared/types/collections'
import { isAnyFolder, isScenario, isEnvironmentFolder } from '../../../shared/types/collections'
import { reidentifyForest } from '../../../shared/utils/reidentifyTree'
import { findItemWithParent } from './treeSearch'

// The re-identification primitive (fresh ids + reference remap) lives in
// `shared/utils/reidentifyTree` so the import pipeline — renderer AND main
// process — shares the exact same id/reference surface as the Clone action.
// Re-exported here so the tree-manipulation call sites (and the coverage
// tests that pin the container/reference key lists) keep one import path.
export {
  generateUniqueId,
  REASSIGNED_ID_CONTAINER_KEYS,
  ID_REFERENCE_KEYS,
  reassignTreeIds,
  remapReferences,
  reidentifyForest
} from '../../../shared/utils/reidentifyTree'

/** A container's children array, created in place if missing. Scenarios carry
 * an optional `items` (they double as containers); this gives a mutable handle
 * for splice/push regardless of folder vs scenario. */
function childrenArray(container: { items?: FolderItem[] }): FolderItem[] {
  container.items ??= []
  return container.items
}

/** Deep-clone a tree item for the "Clone" action: a fully independent copy that
 * shares NO arrays/objects with the source (so editing the copy — or adding a
 * child to it — never touches the original), with a fresh id for the item and
 * every descendant id, and intra-subtree references remapped onto the new ids.
 * Only the top-level clone is renamed "(copy)". Handles folders, environment
 * folders, scenarios (their `items` + `nodes` + `edges`) and requests alike. */
export function deepCloneItem(item: FolderItem, copyLabel = 'copy'): FolderItem {
  // JSON round-trip: a plain, reference-free deep copy that also strips the
  // reactive Proxy wrappers (which structuredClone can't ferry).
  const clone = JSON.parse(JSON.stringify(item)) as FolderItem
  reidentifyForest([clone])
  clone.name = `${item.name} (${copyLabel})`
  return clone
}

/** Remove an item from its parent folder and return a copy of the item */
export function removeItemFromTree(
  rootItems: FolderItem[],
  itemId: string
): FolderItem | null {
  const { item, parent, index } = findItemWithParent(rootItems, itemId)
  if (!item || !parent || index < 0) return null

  // Remove from parent
  childrenArray(parent).splice(index, 1)
  return item
}

/** Insert an item into the tree at the specified position */
export function insertItemIntoTree(
  rootItems: FolderItem[],
  item: FolderItem,
  targetId: string,
  position: 'before' | 'after' | 'into'
): boolean {
  const { item: target, parent, index } = findItemWithParent(rootItems, targetId)
  if (!target) return false

  if (position === 'into') {
    // A scenario is a folder-like container too (it carries `items`), so it
    // accepts dropped children — every kind EXCEPT an environment folder, which
    // mirrors what the scenario's "Add" context menu allows.
    const canContain = isAnyFolder(target) || (isScenario(target) && !isEnvironmentFolder(item))
    if (canContain) {
      childrenArray(target).push(item)
      return true
    }
    // If target can't contain the item, insert after it instead.
    if (parent) {
      childrenArray(parent).splice(index + 1, 0, item)
      return true
    }
    return false
  }

  // Insert before or after the target
  if (!parent) return false

  const insertIndex = position === 'before' ? index : index + 1
  childrenArray(parent).splice(insertIndex, 0, item)
  return true
}

/** Clone an item and insert the clone after it */
export function cloneItemInTree(
  rootItems: FolderItem[],
  itemId: string,
  copyLabel = 'copy'
): FolderItem | null {
  const { item, parent, index } = findItemWithParent(rootItems, itemId)
  if (!item || index < 0) return null

  // Deep clone the item
  const clonedItem = deepCloneItem(item, copyLabel)

  // Insert right after the original — into its parent's children, or directly
  // into the root list when the original is a root item (e.g. an environment
  // folder), which has no `parent`.
  const siblings = parent ? childrenArray(parent) : rootItems
  siblings.splice(index + 1, 0, clonedItem)

  return clonedItem
}
