/**
 * Cross-component channel for "open the design tab AND focus section
 * X (and optionally entity Y in it)" navigation. The opener (a sidebar
 * group row under a design node, a "Used by" chip) stages the target
 * here, then triggers the normal design-tab open path; the matching
 * `DesignTabView` consumes the staged value once it mounts (or
 * immediately, when it is already mounted — the single-tab policy means
 * clicking a group row usually refocuses an open tab with no remount).
 *
 * Same rationale as `envFolderTabIntent.ts`: the view may not be
 * mounted when the opener fires, so a fire-and-forget event would be
 * lost — a module-level Map keyed by design id lets the view drain the
 * intent atomically on first render, and the subscriber path covers
 * the already-mounted case.
 */

import type { DesignSectionKey } from '../../../shared/types/editor'

export interface DesignSectionIntent {
  section: DesignSectionKey
  /** Entity to select inside the section (model id, route id…). */
  entityId?: string
}

const pendingByDesignId = new Map<string, DesignSectionIntent>()
type Subscriber = (designId: string, intent: DesignSectionIntent) => void
const subscribers = new Set<Subscriber>()

/** Stage a section (and optional entity) for the next render of the
 *  design with `designId`. Call just BEFORE triggering the normal open
 *  flow (`handleItemClick(designId)`); `DesignTabView` drains the entry
 *  via `consumePendingDesignSection`. */
export function setPendingDesignSection(designId: string, section: DesignSectionKey, entityId?: string): void {
  if (!designId) return
  const intent: DesignSectionIntent = entityId === undefined ? { section } : { section, entityId }
  pendingByDesignId.set(designId, intent)
  for (const sub of subscribers) sub(designId, intent)
}

/** Read + clear the staged intent for a design. `undefined` when
 *  nothing is pending. */
export function consumePendingDesignSection(designId: string): DesignSectionIntent | undefined {
  const value = pendingByDesignId.get(designId)
  if (value !== undefined) pendingByDesignId.delete(designId)
  return value
}

/** Read WITHOUT clearing — for React state initializers, which
 *  StrictMode double-invokes in dev builds: a consuming initializer
 *  would drain the map on the throwaway first call and hand the real
 *  one nothing. The mount effect does the consuming. */
export function peekPendingDesignSection(designId: string): DesignSectionIntent | undefined {
  return pendingByDesignId.get(designId)
}

/** Subscribe to live intent updates — covers the already-mounted tab. */
export function subscribeDesignSectionIntent(handler: Subscriber): () => void {
  subscribers.add(handler)
  return () => { subscribers.delete(handler) }
}
