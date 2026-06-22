import { useEffect, useRef } from 'react'
import { eventBus } from 'electron-core-ui/renderer'

/**
 * Subscribes to the `request:transport-replaced` event and invokes
 * `onTransportReplaced` whenever the event fires for the given request.
 *
 * The event is emitted by `applyConfigToRequest` when a quick-config
 * is loaded and by MCP's `update_request` tool. It signals that the
 * request proxy's fields have been mutated in-place, so tab views must
 * re-sync their local React state (url, body, method, …) and re-push to
 * ContextService to trigger Handlebars re-resolution.
 *
 * Pattern: the callback is stored in a ref so the subscription is
 * registered once on mount and never torn-down on callback identity
 * changes — avoids redundant subscribe/unsubscribe cycles when parent
 * re-renders. Mirrors the pattern used in HTTPRequestTabView.
 */
export function useTransportReplaced(
  request: { id: string },
  onTransportReplaced: () => void
): void {
  const callbackRef = useRef(onTransportReplaced)
  useEffect(() => { callbackRef.current = onTransportReplaced }, [onTransportReplaced])

  const requestIdRef = useRef(request.id)
  useEffect(() => { requestIdRef.current = request.id }, [request.id])

  useEffect(() => {
    const subscription = eventBus.subscribe<{ requestId: string }>(
      'request:transport-replaced',
      (payload) => {
        if (payload.requestId !== requestIdRef.current) return
        callbackRef.current()
      }
    )
    return () => { subscription.unsubscribe() }
  }, [])
}
