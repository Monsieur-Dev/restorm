import { useSyncExternalStore } from 'react'
import { graphQLClient, type GraphQLLinkStatus } from '../services/GraphQLClient'

/**
 * Subscribe to the renderer's GraphQL subscription link status.
 * Re-renders the component on every `ok` / `reconnecting` / `failed`
 * transition reported by {@link GraphQLClient.onLinkStatusChange}.
 *
 * Implemented on top of `useSyncExternalStore` so the subscribe path
 * is tear-safe under concurrent rendering and the re-read between
 * initial render and effect attachment is handled by React itself
 * (rather than a manual `setState` inside `useEffect`, which
 * `react-hooks/set-state-in-effect` rightly flags).
 *
 * Typical use: drive a small status-bar indicator so the user knows
 * the live feed from the main process is (briefly) stale. Pair with
 * `<GraphQLLinkStatusIndicator>` for an out-of-the-box element.
 */
export function useGraphQLLinkStatus(): GraphQLLinkStatus {
  return useSyncExternalStore(
    (onStoreChange) => graphQLClient.onLinkStatusChange(onStoreChange),
    () => graphQLClient.getLinkStatus(),
    () => 'ok' as const
  )
}
