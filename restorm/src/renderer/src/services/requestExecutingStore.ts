/**
 * Global, ephemeral registry of which requests are currently executing —
 * drives the "running" border-beam on a request's sidebar badge (and replaces
 * the in-tab progress bar), mirroring the scenario running-beam + websocket
 * listening-beam pattern.
 *
 * Fed by `REQUEST_EXECUTION_STARTED` / `REQUEST_EXECUTION_ENDED` events that
 * `BaseRequestTabView` emits whenever its `isLoading` flips — so it covers every
 * request protocol (HTTP / GraphQL / SOAP / gRPC / OData / auth) in one place.
 * State is purely in-memory.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { eventBus } from 'electron-core-ui/renderer'
import { DocumentEvents } from './DocumentEvents'

interface ExecutionEventPayload { requestId: string }

const active = new Set<string>()
const listeners = new Set<() => void>()
let subscribed = false

function notify(): void {
  for (const cb of listeners) cb()
}

function ensureSubscription(): void {
  if (subscribed) return
  subscribed = true
  eventBus.subscribe<ExecutionEventPayload>(DocumentEvents.REQUEST_EXECUTION_STARTED, ({ requestId }) => {
    if (requestId && !active.has(requestId)) {
      active.add(requestId)
      notify()
    }
  })
  eventBus.subscribe<ExecutionEventPayload>(DocumentEvents.REQUEST_EXECUTION_ENDED, ({ requestId }) => {
    if (requestId && active.delete(requestId)) notify()
  })
}

function subscribe(cb: () => void): () => void {
  ensureSubscription()
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function isRequestExecuting(requestId: string): boolean {
  return active.has(requestId)
}

/** React hook: `true` while the request is mid-execution. */
export function useIsRequestExecuting(requestId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => active.has(requestId),
    () => false
  )
}

/**
 * Publish a request's activity into this store from a tab view whose
 * in-flight state does NOT flow through `BaseRequestTabView`'s `isLoading`
 * (long-lived sessions like a Redis subscribe or a Kafka consume, and
 * transient sends on connection-style views). Emits the same
 * `REQUEST_EXECUTION_STARTED` / `REQUEST_EXECUTION_ENDED` pair the base view
 * emits, so every surface (send button, sidebar badge, tab badge) reads one
 * truth. A request id has a single owner view state, so feeders never fight.
 */
export function useEmitRequestExecution(requestId: string, isActive: boolean): void {
  useEffect(() => {
    if (!isActive) return undefined
    eventBus.emitLocalSync(DocumentEvents.REQUEST_EXECUTION_STARTED, { requestId })
    return () => { eventBus.emitLocalSync(DocumentEvents.REQUEST_EXECUTION_ENDED, { requestId }) }
  }, [requestId, isActive])
}
