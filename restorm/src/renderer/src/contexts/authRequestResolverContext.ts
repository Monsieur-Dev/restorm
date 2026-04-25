/**
 * AuthRequestResolverContext — a renderer-side lookup that resolves
 * an `authenticationRequestId` to the `AuthenticationRequest` living
 * somewhere in the current collection tree. Request-tab views call
 * it at send time to build the `authRequest` payload the main-process
 * HTTP executor expects (main then hands the auth off to the
 * `AuthenticationCacheService` for cache-or-fetch + header injection).
 *
 * The provider lives in `App.tsx` alongside `rootItems`; consumers
 * inject the tree-walking logic via this context so deeply-nested
 * request-tab views don't have to thread `rootItems` through every
 * intermediate layer.
 */

import { createContext, useContext } from 'react'
import type { AuthenticationRequest } from '../../../shared/types/collections'

export type AuthRequestResolver = (id: string) => AuthenticationRequest | null

export const AuthRequestResolverContext = createContext<AuthRequestResolver | null>(null)

export function useAuthRequestResolver(): AuthRequestResolver {
  const resolver = useContext(AuthRequestResolverContext)
  // Silent no-op when no provider is mounted (e.g. in isolated tests
  // that don't need the send-time auth flow). Callers simply get back
  // `null` and skip auth injection.
  return resolver ?? ((): AuthenticationRequest | null => null)
}
