import type {
  AuthenticationRequest,
  FolderItem,
  Request
} from '../../../../shared/types/collections'
import {
  isAnyFolder,
  isAuthenticationRequest,
  isRequest
} from '../../../../shared/types/collections'

/** Walk an env-folder subtree and collect every AuthenticationRequest
 * inside it. The auth selector uses this to know what to show, and
 * App.tsx uses it (via `shouldShowAuthSelector`) to know whether the
 * cell will actually render before deciding which status-bar entry
 * carries the `right-aligned` class. */
export function collectAuthRequests(items: readonly FolderItem[]): AuthenticationRequest[] {
  const out: AuthenticationRequest[] = []
  const walk = (nodes: readonly FolderItem[]): void => {
    for (const n of nodes) {
      if (isRequest(n) && isAuthenticationRequest(n)) out.push(n)
      if (isAnyFolder(n)) walk(n.items)
    }
  }
  walk(items)
  return out
}

/** Mirror of the visibility checks at the top of `StatusbarAuthSelector`.
 * Lets the parent know whether the cell will actually render so it can
 * decide which status-bar entry should carry `right-aligned`
 * (margin-left: auto) — only the leftmost of the right group needs it. */
export function shouldShowAuthSelector(
  activeRequest: Request,
  envFolderItems: readonly FolderItem[]
): boolean {
  if (activeRequest.type === 'auth') return false
  return collectAuthRequests(envFolderItems).length > 0
}
