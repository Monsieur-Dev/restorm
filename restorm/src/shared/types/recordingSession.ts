/**
 * Recording session — a tree item that records the API calls a web page
 * makes while it is browsed in the mini-browser, and turns them into a
 * tree of replayable requests.
 *
 * What is PERSISTED is deliberately small: the page url to listen on, the
 * protocols to capture, the white/black lists, and the routes deduced so
 * far (`items`). The captured calls themselves are runtime data held in the
 * main process for the life of the app and never written to the document —
 * a project file must not grow with the traffic of a browsing session.
 *
 * A session is a container like a scenario: its deduced routes are real
 * folders + requests under `items`, so every tree walk (ids, search,
 * history, git) sees them as ordinary items. The other sidebar rows under a
 * session (the live browser node, the captures node, the "Routes" node the
 * items hang from) are virtual — they exist only in the sidebar view model.
 */

import type { RuntimeId } from './baseTypes'
import type { FolderItem } from './folderTypes'

/** A protocol family the capture engine can listen to. */
export type RecordingProtocol = 'http' | 'websocket' | 'graphql' | 'grpc-web'

/** Every protocol the engine knows — the default set for a new session,
 * in display order. */
export const RECORDING_PROTOCOLS: readonly RecordingProtocol[] = ['http', 'websocket', 'graphql', 'grpc-web']

/** Type guard for a persisted protocol key. */
export function isRecordingProtocol(value: unknown): value is RecordingProtocol {
  return typeof value === 'string' && (RECORDING_PROTOCOLS as readonly string[]).includes(value)
}

export interface RecordingSession {
  type: 'recording'
  id: RuntimeId
  name: string
  notes?: string
  /**
   * The page to browse and listen on. Any http(s) url (a remote page or a
   * `localhost:<port>` dev server) or a local `file://` page. Empty until
   * the user fills it in — an empty url disables the record button.
   */
  url: string
  /** Protocols captured during a recording. */
  protocols: RecordingProtocol[]
  /**
   * Regular-expression sources. A captured url is kept when the white list
   * is empty OR it matches at least one entry, AND it matches no black-list
   * entry — the black list has the last word.
   */
  whitelist: string[]
  blacklist: string[]
  /**
   * The routes deduced from the captures: folders nested per path segment,
   * each holding real, replayable requests. Absent until the first
   * deduction, so a session that never deduced anything serializes without
   * an empty array. Shown under the session's "Routes" sidebar row.
   */
  items?: FolderItem[]
}
