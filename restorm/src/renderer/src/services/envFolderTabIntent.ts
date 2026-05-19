/**
 * Cross-component channel for "open env-folder tab AND activate
 * sub-tab X" navigation. The opener (e.g. `ApiCard`'s quick-link
 * buttons on the EmptyBench) stages the desired sub-tab id here,
 * then triggers the normal env-folder open path; the matching
 * `EnvironmentFolderView` consumes the staged value once it
 * mounts (or immediately, if it was already mounted).
 *
 * Why a dedicated module instead of, say, an eventBus event: the
 * env-folder view may not be mounted yet when the opener fires.
 * A fire-and-forget event would be lost in that window. Storing
 * the target in a module-level Map keyed by folder id lets the
 * view pick it up on first render and clear it atomically — no
 * race, no timer.
 */

const pendingByFolderId = new Map<string, string>()
type Subscriber = (folderId: string, tabId: string) => void
const subscribers = new Set<Subscriber>()

/** Stage a sub-tab id for the next render of the env-folder with
 *  `folderId`. Call this just BEFORE triggering the normal open
 *  flow (e.g. `handleItemClick(folderId)`); `EnvironmentFolderView`
 *  drains the entry on mount via `consumePendingEnvFolderSubTab`. */
export function setPendingEnvFolderSubTab(folderId: string, tabId: string): void {
  if (!folderId || !tabId) return
  pendingByFolderId.set(folderId, tabId)
  // Live notify any already-mounted env-folder view with this
  // id so we cover the "tab is already open + user clicks the
  // quick-link" path where there's no remount to drain on.
  for (const sub of subscribers) sub(folderId, tabId)
}

/** Read + clear the staged sub-tab id for a folder. Returns
 *  `undefined` when nothing is pending. */
export function consumePendingEnvFolderSubTab(folderId: string): string | undefined {
  const value = pendingByFolderId.get(folderId)
  if (value !== undefined) pendingByFolderId.delete(folderId)
  return value
}

/** Subscribe to live intent updates — fires when
 *  `setPendingEnvFolderSubTab` is called for any folder. The
 *  env-folder view uses this to react when it's ALREADY mounted
 *  (e.g. the user is on the env-folder tab and clicks the quick
 *  link from another EmptyBench surface). */
export function subscribeEnvFolderSubTabIntent(handler: Subscriber): () => void {
  subscribers.add(handler)
  return () => { subscribers.delete(handler) }
}
