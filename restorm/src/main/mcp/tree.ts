/**
 * Helpers for projecting CollectionStore's typed model into the wire
 * shapes the MCP tools / resources expose. Kept separate from
 * `read.ts` so the projection logic is unit-testable on its own and
 * the tool handlers stay focused on the MCP plumbing.
 */

import {
  type Folder,
  type EnvironmentFolder,
  type FolderItem,
  type Request,
  isAnyFolder,
  isEnvironmentFolder,
  isFolder,
  isRequest
} from '../../shared/models'
import type { ListedFolder, ListedRequest, FolderKind } from './types'

/**
 * Default protocol value when a request type field is unexpectedly
 * absent. Treated as a strong signal in the wire shape — clients can
 * detect stale projects this way without crashing.
 */
const UNKNOWN_PROTOCOL = 'unknown'

export function folderKind(folder: Folder | EnvironmentFolder): FolderKind {
  return isEnvironmentFolder(folder) ? 'env-folder' : 'folder'
}

/**
 * Walk the tree and find the parent folder of an item. Returns `null`
 * for root-level items (collections own themselves, no parent recorded).
 */
export function findParentId(roots: readonly (Folder | EnvironmentFolder)[], itemId: string): string | null {
  for (const root of roots) {
    if (root.id === itemId) return null
    const parent = walkForParent(root, itemId)
    if (parent !== undefined) return parent
  }
  return null
}

function walkForParent(folder: Folder | EnvironmentFolder, itemId: string): string | undefined {
  for (const item of folder.items) {
    if (item.id === itemId) return folder.id
    if (isAnyFolder(item)) {
      const found = walkForParent(item, itemId)
      if (found !== undefined) return found
    }
  }
  return undefined
}

export function projectFolder(folder: Folder | EnvironmentFolder, parentId: string | null): ListedFolder {
  return { id: folder.id, name: folder.name, kind: folderKind(folder), parentId }
}

export function projectRequest(request: Request, parentId: string | null): ListedRequest {
  const recordRequest = request as unknown as Record<string, unknown>
  const protocol = typeof recordRequest['type'] === 'string' ? recordRequest['type'] : UNKNOWN_PROTOCOL
  const method = typeof recordRequest['method'] === 'string' ? recordRequest['method'] : undefined
  return {
    id: request.id,
    name: request.name,
    protocol,
    parentId,
    ...(method !== undefined ? { method } : {})
  }
}

/**
 * Children of a folder, projected into wire-shape lists. Returns both
 * subfolders and requests; callers filter by kind. Throws when the
 * argument isn't a folder so callers can rely on the type narrowing.
 */
export function listChildren(folder: Folder | EnvironmentFolder): { folders: ListedFolder[]; requests: ListedRequest[] } {
  const folders: ListedFolder[] = []
  const requests: ListedRequest[] = []
  for (const item of folder.items) {
    if (isAnyFolder(item)) {
      folders.push(projectFolder(item, folder.id))
    } else if (isRequest(item)) {
      requests.push(projectRequest(item, folder.id))
    }
  }
  return { folders, requests }
}

/**
 * Flatten a tree into every folder + request reachable from the roots,
 * with each item carrying its parentId. Used by `list_folders()` /
 * `list_requests()` when called without a `parentId` filter.
 */
export function flattenTree(roots: readonly (Folder | EnvironmentFolder)[]): { folders: ListedFolder[]; requests: ListedRequest[] } {
  const folders: ListedFolder[] = []
  const requests: ListedRequest[] = []
  for (const root of roots) {
    folders.push(projectFolder(root, null))
    walkAndCollect(root, folders, requests)
  }
  return { folders, requests }
}

function walkAndCollect(folder: Folder | EnvironmentFolder, folders: ListedFolder[], requests: ListedRequest[]): void {
  for (const item of folder.items) {
    if (isFolder(item) || isEnvironmentFolder(item)) {
      folders.push(projectFolder(item, folder.id))
      walkAndCollect(item, folders, requests)
    } else if (isRequest(item)) {
      requests.push(projectRequest(item, folder.id))
    }
  }
}

/**
 * Build a hierarchical id+name tree of the entire project. Used by the
 * `restorm://tree` resource so a client can ask for the topology in a
 * single round-trip without paginating the flat lists. Request leaves
 * carry their `protocol` (for navigation hints); content stays out —
 * fetch via `get_request` / `restorm://request/{id}`.
 */
export interface TreeNode {
  id: string
  name: string
  kind: FolderKind | 'request'
  protocol?: string
  children?: TreeNode[]
}

export function buildTree(roots: readonly (Folder | EnvironmentFolder)[]): TreeNode[] {
  return roots.map(toTreeNode)
}

function toTreeNode(item: FolderItem): TreeNode {
  if (isFolder(item) || isEnvironmentFolder(item)) {
    return {
      id: item.id,
      name: item.name,
      kind: folderKind(item),
      children: item.items.map(toTreeNode)
    }
  }
  // Request leaf.
  const recordRequest = item as unknown as Record<string, unknown>
  const protocol = typeof recordRequest['type'] === 'string' ? recordRequest['type'] : UNKNOWN_PROTOCOL
  return { id: item.id, name: item.name, kind: 'request', protocol }
}
