import {
  isHTTPRequest,
  isGraphQLRequest,
  isGrpcRequest,
  isSoapRequest,
  isWebSocketRequest,
  isODataRequest,
  isAuthenticationRequest,
  type Request
} from '../types/requests'
import { isAnyFolder, type Folder, type EnvironmentFolder, type FolderItem } from '../types/folderTypes'

/**
 * Stable identifier for a single item in a parsed-spec import preview
 * tree. Used by the import modal as the selection-set key (which
 * leaves are checked) and by the refresh modal to bridge between the
 * pipeline's spec keys and the user-facing selection.
 *
 * The key is **stable across imports of the same source** (the spec
 * may have been re-fetched, regenerated, or pulled from a different
 * URL — the user's selection should still apply). It is **unique
 * within a single import** so a single set never collides on two
 * different leaves. It does **not** carry runtime state (random
 * UUIDs, generated ids, request payloads) — only the natural identity
 * of the item as it appears in the source spec.
 *
 * Format per item kind:
 *
 * - HTTP / Authentication request (`http`, `auth`):
 *   `request:http:{METHOD} {URL}` — e.g. `request:http:GET /pet/{petId}`.
 *   Authentication requests reuse the HTTP shape since they expose
 *   the same `method` + `url` surface; treating them under the same
 *   `http` slot keeps the key form simple, and the natural identity
 *   is the same anyway (you can't have two routes with identical
 *   method + url).
 * - GraphQL operation (`graphql`):
 *   `request:graphql:{name}` — e.g. `request:graphql:GetUserById`.
 *   The operation name (or query field name) is the natural
 *   identifier; the `request.name` field carries it through the
 *   import pipeline.
 * - gRPC method (`grpc`):
 *   `request:grpc:{name}` where `name` already encodes
 *   `Service.Method` per the import service convention.
 * - SOAP / WebSocket / OData / other typed requests:
 *   `request:{type}:{name}`.
 * - Folder (regular `Folder` or `EnvironmentFolder`):
 *   `folder:{path}` where `path` is the folder breadcrumb joined by
 *   `/` (e.g. `folder:Swagger Petstore/pet`). Doesn't include the
 *   import-time prefix the import pipeline adds (numeric ordering
 *   prefixes like `1 - Swagger Petstore`); the prefix is computed
 *   at write-time and isn't part of the source spec's natural
 *   identity.
 *
 * The path-based folder key intentionally uses the **display name**
 * rather than a generated id: the runtime id changes between imports
 * (each import generates fresh UUIDs), but the user-facing folder
 * name is the stable identity the user reasons about and the only
 * thing they can correlate against the source spec.
 */
export function importNaturalKeyForRequest(request: Request): string {
  if (isHTTPRequest(request) || isAuthenticationRequest(request)) {
    return `request:http:${request.method.toUpperCase()} ${request.url}`
  }
  if (isGraphQLRequest(request)) return `request:graphql:${request.name}`
  if (isGrpcRequest(request)) return `request:grpc:${request.name}`
  if (isSoapRequest(request)) return `request:soap:${request.name}`
  if (isWebSocketRequest(request)) return `request:websocket:${request.name}`
  if (isODataRequest(request)) return `request:odata:${request.name}`
  // Future request kinds fall through to a generic shape so the
  // selective-import flow doesn't crash on an unknown type — the
  // shape stays stable as long as `name` is.
  const fallbackName = (request as { name?: string }).name ?? ''
  const fallbackType = (request as { type?: string }).type ?? 'unknown'
  return `request:${fallbackType}:${fallbackName}`
}

/**
 * Folder key from a breadcrumb path (folder names from root down to
 * the folder itself, joined by `/`). The breadcrumb is what the user
 * sees in the import preview; the runtime id is generated fresh on
 * each import and isn't a stable identity.
 */
export function importNaturalKeyForFolder(path: readonly string[]): string {
  return `folder:${path.join('/')}`
}

/**
 * Walk the parsed-spec tree and emit `[naturalKey, item]` pairs for
 * every node — the env-folder root is excluded (per the ticket: no
 * checkbox at the root). Folders carry their breadcrumb path through
 * the recursion so the key reflects nesting.
 *
 * The order of the returned array is a depth-first traversal,
 * matching what the preview tree renders, so callers can use it
 * directly as an iteration source for "select all" / "select none"
 * defaults.
 */
export interface ImportTreeWalkEntry {
  key: string
  item: FolderItem
  path: string[]
}

/**
 * Prune the parsed-spec tree down to only the items the user opted
 * into. Folders survive iff at least one of their leaf descendants is
 * in `selection` — otherwise they'd render as empty placeholders in
 * the imported folder. The env-folder root passes through verbatim
 * regardless of selection (the user is importing *into* it, not
 * *of* it).
 *
 * Operates on a structural copy: each surviving folder gets a fresh
 * `items` array, but the leaf request references pass through
 * unchanged so any reactive proxies / runtime payloads attached
 * upstream survive the filter.
 */
export function filterImportTreeBySelection(
  items: readonly FolderItem[],
  selection: ReadonlySet<string>
): FolderItem[] {
  const out: FolderItem[] = []
  for (const item of items) {
    if (isAnyFolder(item)) {
      const folder: Folder | EnvironmentFolder = item
      const filteredChildren = filterImportTreeBySelection(folder.items, selection)
      if (filteredChildren.length > 0) {
        out.push({ ...folder, items: filteredChildren })
      }
    } else {
      const key = importNaturalKeyForRequest(item)
      if (selection.has(key)) out.push(item)
    }
  }
  return out
}

export function walkImportTreeWithKeys(
  items: readonly FolderItem[],
  parentPath: readonly string[] = []
): ImportTreeWalkEntry[] {
  const out: ImportTreeWalkEntry[] = []
  for (const item of items) {
    if (isAnyFolder(item)) {
      const folder: Folder | EnvironmentFolder = item
      const path = [...parentPath, folder.name]
      out.push({ key: importNaturalKeyForFolder(path), item, path })
      out.push(...walkImportTreeWithKeys(folder.items, path))
    } else {
      // Leaf request — its path is the parent's path; the key carries
      // the request kind + identity, not the path, since two routes
      // with the same method+url can't coexist anywhere in the tree.
      out.push({
        key: importNaturalKeyForRequest(item),
        item,
        path: [...parentPath]
      })
    }
  }
  return out
}
