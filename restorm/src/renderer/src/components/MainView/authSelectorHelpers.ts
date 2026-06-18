import type {
  AuthenticationRequest,
  FolderItem
} from '../../../../shared/types/collections'
import {
  isAnyFolder,
  isAuthenticationRequest,
  isRequest
} from '../../../../shared/types/collections'

/**
 * Collect only the AuthenticationRequests that are IN SCOPE for a given
 * request: those sitting in the request's own folder or in any ANCESTOR
 * folder, up to the env-folder root. Auth routes in sibling / unrelated
 * branches are excluded — a request can only attach a route it could
 * inherit along its own path.
 *
 * `items` is the env-folder item tree; `requestId` identifies the target
 * request. Returns the in-scope auth routes (each ancestor level's direct
 * AuthenticationRequest children), or `[]` if the request isn't found.
 */
export function collectInScopeAuthRequests(
  items: readonly FolderItem[],
  requestId: string
): AuthenticationRequest[] {
  // Direct auth-request children of one folder level (no descent).
  const directAuthChildren = (nodes: readonly FolderItem[]): AuthenticationRequest[] =>
    nodes.filter((n): n is AuthenticationRequest => isRequest(n) && isAuthenticationRequest(n))

  // Depth-first search for the request, accumulating the in-scope auth
  // routes along the path. At each folder on the path we add that level's
  // direct auth children; we only recurse into the branch that actually
  // contains the request, so siblings never contribute.
  const search = (nodes: readonly FolderItem[]): AuthenticationRequest[] | null => {
    if (nodes.some((n) => isRequest(n) && n.id === requestId)) {
      return directAuthChildren(nodes)
    }
    for (const n of nodes) {
      if (isAnyFolder(n)) {
        const deeper = search(n.items)
        if (deeper !== null) {
          // Prepend this level's auth children (ancestors are in scope too).
          return [...directAuthChildren(nodes), ...deeper]
        }
      }
    }
    return null
  }

  return search(items) ?? []
}
