/**
 * Cross-component channel for "open the design tab AND focus section
 * X" navigation. The opener (a sidebar group row under a design node)
 * stages the target section here, then triggers the normal design-tab
 * open path; the matching `DesignTabView` consumes the staged value
 * once it mounts (or immediately, when it is already mounted — the
 * single-tab policy means clicking a group row usually refocuses an
 * open tab with no remount).
 *
 * Same rationale as `envFolderTabIntent.ts`: the view may not be
 * mounted when the opener fires, so a fire-and-forget event would be
 * lost — a module-level Map keyed by design id lets the view drain the
 * intent atomically on first render, and the subscriber path covers
 * the already-mounted case.
 */

import type { DesignSectionKey } from '../../../shared/types/editor'

const pendingByDesignId = new Map<string, DesignSectionKey>()
type Subscriber = (designId: string, section: DesignSectionKey) => void
const subscribers = new Set<Subscriber>()

/** Stage a section for the next render of the design with `designId`.
 *  Call just BEFORE triggering the normal open flow
 *  (`handleItemClick(designId)`); `DesignTabView` drains the entry via
 *  `consumePendingDesignSection`. */
export function setPendingDesignSection(designId: string, section: DesignSectionKey): void {
  if (!designId) return
  pendingByDesignId.set(designId, section)
  for (const sub of subscribers) sub(designId, section)
}

/** Read + clear the staged section for a design. `undefined` when
 *  nothing is pending. */
export function consumePendingDesignSection(designId: string): DesignSectionKey | undefined {
  const value = pendingByDesignId.get(designId)
  if (value !== undefined) pendingByDesignId.delete(designId)
  return value
}

/** Subscribe to live intent updates — covers the already-mounted tab. */
export function subscribeDesignSectionIntent(handler: Subscriber): () => void {
  subscribers.add(handler)
  return () => { subscribers.delete(handler) }
}
