/**
 * Global, ephemeral registry of which WebSocket / Socket.IO requests currently
 * hold an open connection — drives the "listening" border-beam on a request's
 * badge (sidebar tree) and on its Connect button, mirroring the scenario
 * running-beam pattern.
 *
 * Fed by the single app-wide `websocket:connection-progress` stream: a request
 * is "listening" between a `started` event and the matching
 * `completed` / `cancelled` / `error`. State is purely in-memory.
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
  return (window as { restorm?: { websocket?: Bridge } }).restorm?.websocket
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

export function isWebsocketListening(requestId: string): boolean {
  return active.has(requestId)
}

/** React hook: `true` while the request holds an open WebSocket/Socket.IO connection. */
export function useIsWebsocketListening(requestId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => active.has(requestId),
    () => false
  )
}
