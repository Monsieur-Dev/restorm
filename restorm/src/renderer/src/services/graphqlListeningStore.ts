/**
 * Global, ephemeral registry of which GraphQL requests currently host a local
 * mock server (are listening) — drives the "listening" border-beam on a
 * request's badge (sidebar tree + workbench tab) and on its Listen button,
 * mirroring {@link ./httpListeningStore} and {@link ./websocketListeningStore}.
 *
 * Fed by the single app-wide `graphql:request-progress` stream: a request is
 * "listening" between a `started` event and the matching
 * `completed` / `cancelled` / `error`. State is purely in-memory. The listening
 * badge only renders for `server === true` requests, so a transient flag from a
 * client execute is never shown.
 */

import { useSyncExternalStore } from 'react'

interface ProgressEvent {
  requestId: string
  status: 'started' | 'completed' | 'cancelled' | 'error'
}

interface Bridge {
  onProgress?: (cb: (event: ProgressEvent) => void) => (() => void) | undefined
}

function bridge(): Bridge | undefined {
  return (window as { restorm?: { graphql?: Bridge } }).restorm?.graphql
}

const active = new Set<string>()
const listeners = new Set<() => void>()
const END_STATUSES = new Set(['completed', 'cancelled', 'error'])

let subscribed = false

function notify(): void {
  for (const cb of listeners) cb()
}

function handleProgress(event: ProgressEvent): void {
  if (event.status === 'started') {
    if (!active.has(event.requestId)) {
      active.add(event.requestId)
      notify()
    }
    return
  }
  if (END_STATUSES.has(event.status) && active.delete(event.requestId)) {
    notify()
  }
}

/** Wire the single app-wide progress subscription. Idempotent + retried on each
 * `subscribe` until the preload bridge is available. */
function ensureSubscription(): void {
  if (subscribed) return
  const unsub = bridge()?.onProgress?.(handleProgress)
  if (unsub) subscribed = true
}

function subscribe(cb: () => void): () => void {
  ensureSubscription()
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** React hook: `true` while the request is hosting a GraphQL mock route. */
export function useIsGraphqlListening(requestId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => active.has(requestId),
    () => false
  )
}
