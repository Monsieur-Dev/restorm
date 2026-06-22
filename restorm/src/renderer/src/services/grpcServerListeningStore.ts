/**
 * Global, ephemeral registry of which gRPC requests currently HOST a local mock
 * server (are listening) — drives the "listening" border-beam on a request's
 * badge (sidebar tree + workbench tab) and on its Listen button, mirroring
 * {@link ./httpListeningStore}.
 *
 * Fed by the single app-wide `grpc:server-progress` stream (DISTINCT from the
 * client `grpc:request-progress` the {@link ./grpcListeningStore} watches — a
 * hosting server's beam must not collide with a client streaming call's beam on
 * the same request id): a request is "listening" between a `started` event and
 * the matching `completed` / `cancelled` / `error`. State is purely in-memory.
 */

import { useSyncExternalStore } from 'react'

interface ProgressEvent {
  requestId: string
  status: 'started' | 'completed' | 'cancelled' | 'error'
}

interface Bridge {
  onServerProgress?: (cb: (event: ProgressEvent) => void) => (() => void) | undefined
}

function bridge(): Bridge | undefined {
  return (window as { restorm?: { grpc?: Bridge } }).restorm?.grpc
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

/** Wire the single app-wide server-progress subscription. Idempotent + retried
 * on each `subscribe` until the preload bridge is available. */
function ensureSubscription(): void {
  if (subscribed) return
  const unsub = bridge()?.onServerProgress?.(handleProgress)
  if (unsub) subscribed = true
}

function subscribe(cb: () => void): () => void {
  ensureSubscription()
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** React hook: `true` while the request is hosting a gRPC mock server. */
export function useIsGrpcServerListening(requestId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => active.has(requestId),
    () => false
  )
}
