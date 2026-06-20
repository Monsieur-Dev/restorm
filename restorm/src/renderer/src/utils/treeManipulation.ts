/**
 * Utility functions for manipulating the folder tree structure
 */

import type { FolderItem } from '../../../shared/types/collections'
import { isAnyFolder, isScenario, isEnvironmentFolder } from '../../../shared/types/collections'
import { findItemWithParent } from './treeSearch'

/** Generate a unique ID. Uses crypto.randomUUID (collision-free) rather
 * than Date.now()+Math.random(), which collides for two ids minted in the
 * same millisecond — fatal here since these ids key the per-request
 * stores. Matches serialization.ts's generateId(). */
export function generateUniqueId(): string {
  return crypto.randomUUID()
}

/** A container's children array, created in place if missing. Scenarios carry
 * an optional `items` (they double as containers); this gives a mutable handle
 * for splice/push regardless of folder vs scenario. */
function childrenArray(container: { items?: FolderItem[] }): FolderItem[] {
  container.items ??= []
  return container.items
}

/** Give a fresh id to this object and to every descendant that carries one and
 * could collide in the tree: child `items` (folders / scenarios / requests),
 * an environment folder's `environments` and `customValueLists`. Records every
 * old→new mapping so references can be remapped afterwards. Scenario graph
 * node/edge ids are left untouched — they are scenario-scoped and the deep copy
 * already unshared them (edges keep referencing their own nodes). */
function reassignTreeIds(node: unknown, idMap: Map<string, string>): void {
  if (node === null || typeof node !== 'object') return
  const rec = node as Record<string, unknown>
  const id = rec['id']
  if (typeof id === 'string' && id !== '') {
    const next = generateUniqueId()
    idMap.set(id, next)
    rec['id'] = next
  }
  for (const key of ['items', 'environments', 'customValueLists']) {
    const arr = rec[key]
    if (Array.isArray(arr)) for (const child of arr) reassignTreeIds(child, idMap)
  }
}

/**
 * The set of object keys that hold a REFERENCE to another tree item's id (and
 * so must follow a clone's remapped ids). Scoping the rewrite to these keys
 * means a free-text field that coincidentally equals an id (a URL, a note, a
 * header value) is never silently mutated — the old code rewrote ANY string
 * matching a remapped id, in any field.
 */
const ID_REFERENCE_KEYS = new Set<string>([
  'listId', 'customValueListId',
  'scenarioId', 'targetScenarioId', 'runScenarioId',
  'requestId', 'targetRequestId', 'boundRequestId',
  'environmentId', 'envId', 'selectedEnvironmentId',
  'parentFolderId', 'folderId',
  'sourceNodeId', 'targetNodeId', 'fromNodeId', 'toNodeId', 'nodeId'
])

/** After ids are reassigned, walk the cloned subtree and replace an old id with
 * its new id ONLY in known reference fields (see {@link ID_REFERENCE_KEYS}) — so
 * references to the cloned items/environments/lists follow the copy without
 * touching free-text fields that happen to contain a matching string. The `id`
 * fields themselves already hold new ids and are skipped. */
function remapReferences(node: unknown, idMap: Map<string, string>): void {
  if (Array.isArray(node)) {
    for (const v of node) remapReferences(v, idMap)
    return
  }
  if (node === null || typeof node !== 'object') return
  const rec = node as Record<string, unknown>
  for (const [key, value] of Object.entries(rec)) {
    if (key === 'id') continue
    if (typeof value === 'string') {
      if (!ID_REFERENCE_KEYS.has(key)) continue
      const mapped = idMap.get(value)
      if (mapped !== undefined) rec[key] = mapped
    } else {
      remapReferences(value, idMap)
    }
  }
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
  const idMap = new Map<string, string>()
  reassignTreeIds(clone, idMap)
  remapReferences(clone, idMap)
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
