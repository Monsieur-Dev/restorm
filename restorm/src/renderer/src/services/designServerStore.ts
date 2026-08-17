/**
 * Global, ephemeral registry of which designs currently HOST their
 * design server — the design-side sibling of
 * {@link ./grpcServerListeningStore}. Drives the "serving" border-beam
 * on the design's badge (sidebar tree + workbench tab) and the spin
 * button, plus the run modal's live per-route call counters.
 *
 * Fed by the two app-wide `design-server:*` streams: a design is
 * "serving" between a `started` progress event and the matching
 * `completed`/`error`; each served request pushes a fresh counters
 * snapshot. State is purely in-memory — a reload re-syncs via
 * `status()` polling from the settings section.
 */

import { useSyncExternalStore } from 'react'
import type { DesignServerCounters } from '../types/global'

interface ProgressEvent {
  designId: string
  status: 'started' | 'completed' | 'error'
}

interface ServedEvent {
  designId: string
  routeId: string
  code: string
  counters: DesignServerCounters
}

interface Bridge {
  onProgress?: (cb: (event: ProgressEvent) => void) => (() => void) | undefined
  onServed?: (cb: (event: ServedEvent) => void) => (() => void) | undefined
}

function bridge(): Bridge | undefined {
  return (window as { restorm?: { designServer?: Bridge } }).restorm?.designServer
}

const serving = new Set<string>()
const counters = new Map<string, DesignServerCounters>()
const listeners = new Set<() => void>()

let subscribed = false

const EMPTY_COUNTERS: DesignServerCounters = { total: 0, routes: {} }

function notify(): void {
  for (const cb of listeners) cb()
}

function handleProgress(event: ProgressEvent): void {
  if (event.status === 'started') {
    if (!serving.has(event.designId)) {
      serving.add(event.designId)
      // A fresh run starts from zeroed counters.
      counters.set(event.designId, EMPTY_COUNTERS)
      notify()
    }
    return
  }
  if (serving.delete(event.designId)) notify()
}

function handleServed(event: ServedEvent): void {
  counters.set(event.designId, event.counters)
  notify()
}

/** Wire the app-wide subscriptions. Idempotent + retried on each
 * `subscribe` until the preload bridge is available. */
function ensureSubscription(): void {
  if (subscribed) return
  const designServer = bridge()
  const unsubProgress = designServer?.onProgress?.(handleProgress)
  designServer?.onServed?.(handleServed)
  if (unsubProgress) subscribed = true
}

function subscribe(cb: () => void): () => void {
  ensureSubscription()
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** React hook: `true` while the design's server is up — the beam. */
export function useIsDesignServerListening(designId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => serving.has(designId),
    () => false
  )
}

/** React hook: this run's live counters (zeroed while not serving). */
export function useDesignServerCounters(designId: string): DesignServerCounters {
  return useSyncExternalStore(
    subscribe,
    () => counters.get(designId) ?? EMPTY_COUNTERS,
    () => EMPTY_COUNTERS
  )
}

/** Imperative read used outside React (autosave push while serving). */
export function isDesignServerListening(designId: string): boolean {
  ensureSubscription()
  return serving.has(designId)
}

/**
 * Fold a polled `status()` snapshot into the store. The progress
 * subscription is LAZY (armed by the first React subscriber), so a
 * `started` fired before any design surface mounted — an MCP
 * `serve_design` on a closed tab — would otherwise be missed for the
 * whole session. Mount-time reconciliation closes that window.
 */
export function applyServingSnapshot(designId: string, listening: boolean): void {
  ensureSubscription()
  if (listening && !serving.has(designId)) {
    serving.add(designId)
    notify()
  } else if (!listening && serving.delete(designId)) {
    notify()
  }
}
