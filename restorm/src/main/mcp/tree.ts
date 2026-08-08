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
  type Scenario,
  isAnyFolder,
  isEnvironmentFolder,
  isFolder,
  isRequest,
  isScenario
} from '../../shared/models'
import type { ListedFolder, ListedRequest, ListedScenario, FolderKind } from './types'

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
  // Read off the typed Request union (the `as unknown as Record` cast
  // defeated the types and silently emitted UNKNOWN_PROTOCOL). `type` is
  // the discriminant — always a string on every member. `method` only
  // exists on the members that have it (HTTP/GraphQL/SOAP/OData/…), so
  // narrow with an `in` check rather than reading a non-existent field.
  const protocol: string = request.type
  const method = 'method' in request && typeof request.method === 'string' ? request.method : undefined
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
export function listChildren(folder: Folder | EnvironmentFolder | Scenario): { folders: ListedFolder[]; requests: ListedRequest[] } {
  const folders: ListedFolder[] = []
  const requests: ListedRequest[] = []
  const items = isScenario(folder) ? (folder.items ?? []) : folder.items
  for (const item of items) {
    // `isScenario` must be tested before the folder guards: at runtime a
    // scenario carries both `items` and `configuration`, so `isAnyFolder`
    // mis-classifies it as a folder. Scenarios are surfaced by
    // `list_scenarios`, so they stay out of the folder/request lists here.
    if (isScenario(item)) continue
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
export function flattenTree(roots: readonly FolderItem[]): { folders: ListedFolder[]; requests: ListedRequest[] } {
  const folders: ListedFolder[] = []
  const requests: ListedRequest[] = []
  for (const root of roots) {
    // The root is not folders-only: the sidebar lets a scenario or a request
    // sit there as a sibling of a collection. Dispatch per kind exactly as
    // `walkAndCollect` does one level down, with a `null` parentId.
    if (isScenario(root)) {
      walkAndCollect(root, folders, requests)
    } else if (isFolder(root) || isEnvironmentFolder(root)) {
      folders.push(projectFolder(root, null))
      walkAndCollect(root, folders, requests)
    } else if (isRequest(root)) {
      requests.push(projectRequest(root, null))
    }
  }
  return { folders, requests }
}

function walkAndCollect(
  container: Folder | EnvironmentFolder | Scenario,
  folders: ListedFolder[],
  requests: ListedRequest[]
): void {
  const items = isScenario(container) ? (container.items ?? []) : container.items
  for (const item of items) {
    // `isScenario` is tested first: at runtime a scenario satisfies the folder
    // guards (it carries `items` + `configuration`), so without this it would
    // be projected as a `kind: "folder"`. A scenario is folder-like and may
    // hold requests / sub-folders / sub-scenarios, so we still descend to keep
    // those children reachable — but the scenario itself stays out of the
    // `folders` list (`list_scenarios` owns that surface).
    if (isScenario(item)) {
      walkAndCollect(item, folders, requests)
    } else if (isFolder(item) || isEnvironmentFolder(item)) {
      folders.push(projectFolder(item, container.id))
      walkAndCollect(item, folders, requests)
    } else if (isRequest(item)) {
      requests.push(projectRequest(item, container.id))
    }
  }
}

export function projectScenario(scenario: Scenario, parentId: string | null, path: string): ListedScenario {
  return {
    id: scenario.id,
    name: scenario.name,
    path,
    tags: scenario.tags,
    nodeCount: scenario.nodes.length,
    edgeCount: scenario.edges.length,
    parentId
  }
}

/**
 * Every scenario reachable from the roots, each with its `parentId` and a
 * folder-mode `path` (ancestor container names + the scenario name). Descends
 * through folders, env-folders AND scenarios (a scenario is folder-like and
 * may nest other scenarios). Used by `list_scenarios()`.
 */
export function flattenScenarios(roots: readonly FolderItem[]): ListedScenario[] {
  const out: ListedScenario[] = []
  for (const root of roots) {
    // A scenario may itself BE a root item; it has no ancestor container, so
    // its path is just its own name and its `parentId` is null. Listing only
    // what the roots CONTAIN would leave it out of `list_scenarios` entirely.
    if (isScenario(root)) {
      out.push(projectScenario(root, null, root.name))
      walkForScenarios(root, root.name, root.id, out)
    } else if (isFolder(root) || isEnvironmentFolder(root)) {
      walkForScenarios(root, root.name, root.id, out)
    }
  }
  return out
}

function walkForScenarios(
  container: Folder | EnvironmentFolder | Scenario,
  prefix: string,
  parentId: string,
  out: ListedScenario[]
): void {
  const items = isScenario(container) ? (container.items ?? []) : container.items
  for (const item of items) {
    if (isScenario(item)) {
      const path = `${prefix} / ${item.name}`
      out.push(projectScenario(item, parentId, path))
      walkForScenarios(item, path, item.id, out)
    } else if (isFolder(item) || isEnvironmentFolder(item)) {
      walkForScenarios(item, `${prefix} / ${item.name}`, item.id, out)
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
  kind: FolderKind | 'request' | 'scenario'
  protocol?: string
  children?: TreeNode[]
}

export function buildTree(roots: readonly FolderItem[]): TreeNode[] {
  // `toTreeNode` already dispatches on kind, so a root scenario / request
  // renders as itself rather than being forced into a folder node.
  return roots.map(toTreeNode)
}

function toTreeNode(item: FolderItem): TreeNode {
  // Scenarios are checked first: at runtime they satisfy the folder guards
  // (`items` + `configuration`), so without this a scenario would render as a
  // `kind: "folder"`. A scenario is a folder-like container — emit it as a
  // distinct `kind: "scenario"` node and recurse into its child items so
  // requests / sub-folders / sub-scenarios authored inside it stay visible.
  if (isScenario(item)) {
    return {
      id: item.id,
      name: item.name,
      kind: 'scenario',
      children: (item.items ?? []).map(toTreeNode)
    }
  }
  if (isFolder(item) || isEnvironmentFolder(item)) {
    return {
      id: item.id,
      name: item.name,
      kind: folderKind(item),
      children: item.items.map(toTreeNode)
    }
  }
  // Request leaf — read the discriminant off the typed shape (the
  // `as unknown as Record` cast defeated the types + silently emitted
  // UNKNOWN_PROTOCOL).
  const protocol: string = isRequest(item) ? item.type : UNKNOWN_PROTOCOL
  return { id: item.id, name: item.name, kind: 'request', protocol }
}
