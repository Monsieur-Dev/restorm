/**
 * Utility functions for manipulating the folder tree structure
 */

import type { FolderItem } from '../../../shared/types/collections'
import { isAnyFolder } from '../../../shared/types/collections'
import { findItemWithParent } from './treeSearch'

/** Generate a unique ID */
export function generateUniqueId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/** A container's children array, created in place if missing. Scenarios carry
 * an optional `items` (they double as containers); this gives a mutable handle
 * for splice/push regardless of folder vs scenario. */
function childrenArray(container: { items?: FolderItem[] }): FolderItem[] {
  container.items ??= []
  return container.items
}

/** Deep clone an item with new IDs */
export function deepCloneItem(item: FolderItem): FolderItem {
  const newId = generateUniqueId()

  if (isAnyFolder(item)) {
    const clonedFolder = {
      ...item,
      id: newId,
      name: `${item.name} (copy)`,
      items: item.items.map((child) => deepCloneItem(child))
    }
    return clonedFolder
  }

  // It's a request
  return {
    ...item,
    id: newId,
    name: `${item.name} (copy)`
  }
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
    // Insert into the target (which must be a folder)
    if (isAnyFolder(target)) {
      target.items.push(item)
      return true
    }
    // If target is not a folder, insert after it instead
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
  itemId: string
): FolderItem | null {
  const { item, parent, index } = findItemWithParent(rootItems, itemId)
  if (!item || !parent || index < 0) return null

  // Deep clone the item
  const clonedItem = deepCloneItem(item)

  // Insert after the original
  childrenArray(parent).splice(index + 1, 0, clonedItem)

  return clonedItem
}
