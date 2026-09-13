/**
 * Renderer-side mirror of each recording session's live status (idle /
 * recording / paused + capture count), fed by the main process pushes.
 * Read through `useRecordingStatus` so a badge, a beam or a sidebar row
 * re-renders when a recording starts, pauses or stops — without any
 * component holding IPC subscriptions of its own.
 */

import { useSyncExternalStore } from 'react'
import type { RecordingStatus } from '../../../shared/types/recordingCapture'

interface Bridge {
  onStatusChanged?: (cb: (status: RecordingStatus) => void) => () => void
  status?: (sessionId: string) => Promise<RecordingStatus>
}

function bridge(): Bridge | undefined {
  return (window as { restorm?: { recording?: Bridge } }).restorm?.recording
}

const statuses = new Map<string, RecordingStatus>()
// One frozen idle status per session, so `getRecordingStatus` hands the SAME
// object back on every call while nothing is known — `useSyncExternalStore`
// compares snapshots by identity, and a fresh object per call would re-render
// forever (React error #185).
const idleStatuses = new Map<string, RecordingStatus>()

function idleStatus(sessionId: string): RecordingStatus {
  let idle = idleStatuses.get(sessionId)
  if (!idle) {
    idle = Object.freeze({ sessionId, state: 'idle', runId: null, tabId: null, captureCount: 0 }) as RecordingStatus
    idleStatuses.set(sessionId, idle)
  }
  return idle
}
const listeners = new Set<() => void>()
let version = 0
let subscribed = false
const primed = new Set<string>()

function notify(): void {
  version += 1
  for (const cb of listeners) cb()
}

function ingest(status: RecordingStatus): void {
  const previous = statuses.get(status.sessionId)
  if (previous !== undefined) {
    const same = previous.state === status.state && previous.runId === status.runId && previous.tabId === status.tabId && previous.captureCount === status.captureCount
    if (same) return
  }
  statuses.set(status.sessionId, status)
  notify()
}

function ensureSubscription(): void {
  if (subscribed) return
  const unsub = bridge()?.onStatusChanged?.(ingest)
  if (unsub) subscribed = true
}

function subscribe(cb: () => void): () => void {
  ensureSubscription()
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** Ask main once for a session's current status (a freshly opened project
 * has sessions the pushes never mentioned). Idempotent per session. */
export function primeRecordingStatus(sessionId: string): void {
  if (primed.has(sessionId)) return
  primed.add(sessionId)
  const fetch = bridge()?.status
  if (!fetch) return
  void fetch(sessionId).then(ingest).catch(() => { primed.delete(sessionId) })
}

export function getRecordingStatus(sessionId: string): RecordingStatus {
  return statuses.get(sessionId) ?? idleStatus(sessionId)
}

export function useRecordingStatus(sessionId: string): RecordingStatus {
  ensureSubscription()
  return useSyncExternalStore(subscribe, () => getRecordingStatus(sessionId), () => idleStatus(sessionId))
}

/** A counter that moves on every status change — a cheap dependency for a
 * memo that folds many sessions (the sidebar tree). */
export function useRecordingStatusVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0)
}

/** Test seam: reset the mirror. */
export function resetRecordingStatusStoreForTests(): void {
  statuses.clear()
  idleStatuses.clear()
  primed.clear()
  version = 0
}
