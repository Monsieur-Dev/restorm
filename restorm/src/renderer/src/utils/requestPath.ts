import type { FolderItem, Request } from '../../../shared/types/collections'
import { isAnyFolder, isRequest } from '../../../shared/types/collections'

function getPaddingWidth(count: number): number {
  if (count <= 0) return 1
  return String(count).length
}

function formatIndex(index0: number, count: number): string {
  const width = getPaddingWidth(count)
  return String(index0 + 1).padStart(width, '0')
}

function sanitizeName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

function folderSegment(name: string, index0: number, count: number): string {
  return `${formatIndex(index0, count)} - ${sanitizeName(name)}`
}

function requestSegment(req: Request, index0: number, count: number): string {
  const name = typeof req.name === 'string' ? req.name : ''
  return `${formatIndex(index0, count)} - ${sanitizeName(name)}`
}

function findRequestPathInItems(items: FolderItem[], prefix: string, requestId: string): string | null {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) continue
    if (isAnyFolder(item)) {
      const folderPrefix = `${prefix}/${folderSegment(item.name, i, items.length)}`
      const nested = findRequestPathInItems(item.items, folderPrefix, requestId)
      if (nested) return nested
    } else if (isRequest(item) && item.id === requestId) {
      return `${prefix}/${requestSegment(item, i, items.length)}`
    }
  }
  return null
}

export function buildRequestPath(
  collections: FolderItem[],
  requestId: string
): string | null {
  for (let i = 0; i < collections.length; i++) {
    const item = collections[i]
    if (!item) continue
    // Requests can now live at the root of the tree (auth route,
    // for instance). A root-level match returns its own segment.
    if (isRequest(item)) {
      if (item.id === requestId) {
        return requestSegment(item, i, collections.length)
      }
      continue
    }
    // Scenarios are childless leaves like requests, but aren't request
    // matches — skip them so `.items` only runs on real folders.
    if (!isAnyFolder(item)) continue
    const base = folderSegment(item.name, i, collections.length)
    const path = findRequestPathInItems(item.items, base, requestId)
    if (path) return path
  }
  return null
}
