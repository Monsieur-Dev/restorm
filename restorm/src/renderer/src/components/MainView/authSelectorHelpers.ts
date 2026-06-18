import type {
  AuthenticationRequest,
  FolderItem
} from '../../../../shared/types/collections'
import {
  isAnyFolder,
  isAuthenticationRequest,
  isRequest
} from '../../../../shared/types/collections'

/** Walk an env-folder subtree and collect every AuthenticationRequest
 * inside it. The auth-route selector uses this to know what to show. */
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
