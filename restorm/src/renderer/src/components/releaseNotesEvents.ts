/**
 * Cross-component signal to open the release-notes modal (owned by
 * `UpdateNotifications`, mounted once near the app root) from elsewhere in the
 * renderer — e.g. the Help-menu entry in the titlebar. Dispatched over the
 * shared `eventBus`.
 */

export const RELEASE_NOTES_OPEN = 'updates:release-notes:open'

/**
 * Which slice the modal shows initially:
 * - `sinceCurrent`: the versions newer than the running one show up front (the
 *   rest sit behind "show more") — used from the update-ready toast.
 * - `recent`: the most recent versions show up front — used from the post-update
 *   toast and the Help menu, where the previously-installed version is unknown.
 */
export type ReleaseNotesMode = 'sinceCurrent' | 'recent'

export interface ReleaseNotesOpenPayload {
  mode: ReleaseNotesMode
}
