/**
 * Pure tree-id collection, deliberately kept out of `workbenchTabs.ts`:
 * that module imports the workbench node guards from the ECUI renderer
 * barrel, which pulls browser-only code in at import time. Consumers that
 * run outside a DOM (the MCP tree-replace hook and its node-environment
 * test) only need this walk, and must not drag the barrel along with it.
 */

interface ItemWithChildren {
  id?: string
  items?: ItemWithChildren[]
}

/**
 * Every tree-item id reachable from a `FolderItem[]` forest — folders,
 * env-folders, their nested items, and scenarios' child items — so
 * callers can reconcile against "what still exists in the tree".
 */
export function collectTreeItemIds(items: readonly ItemWithChildren[]): Set<string> {
  const ids = new Set<string>()
  const walk = (list: readonly ItemWithChildren[]): void => {
    for (const item of list) {
      if (typeof item.id === 'string') ids.add(item.id)
      if (Array.isArray(item.items)) walk(item.items)
    }
  }
  walk(items)
  return ids
}
