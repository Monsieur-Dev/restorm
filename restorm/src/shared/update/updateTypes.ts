/**
 * Shared auto-update contract — the vocabulary crossing main ↔ preload ↔
 * renderer. Kept free of Electron/Node imports so all three layers can import it
 * (mirrors `shared/auth/authState.ts`).
 */

/** IPC channel names for the auto-update surface. */
export const UPDATE_IPC = {
  GET_STATE: 'update:get-state',
  GET_SETTINGS: 'update:get-settings',
  CHECK_NOW: 'update:check-now',
  QUIT_AND_INSTALL: 'update:quit-and-install',
  SET_AUTO_CHECK: 'update:set-auto-check',
  GET_CHANGELOG_SINCE: 'update:get-changelog-since',
  GET_LAST_SEEN_VERSION: 'update:get-last-seen-version',
  MARK_VERSION_SEEN: 'update:mark-version-seen',
  /** main → renderer broadcast of every state transition. */
  STATE_CHANGED: 'update:state-changed'
} as const

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export type UpdateTrigger = 'auto' | 'manual'

export interface UpdateState {
  phase: UpdatePhase
  /** Version offered by the feed (available/downloading/downloaded), else null. */
  version: string | null
  /** The running app version. */
  currentVersion: string
  /** Download progress 0-100 while `downloading`, else null. */
  percent: number | null
  /** ISO timestamp of the last completed check, or null. */
  lastCheckedAt: string | null
  /** Set only in `error`; carries whether the failing action was user-initiated. */
  error: { trigger: UpdateTrigger; message: string } | null
  /** Trigger of the in-flight/last check — lets the renderer scope its toasts. */
  trigger: UpdateTrigger | null
}

export interface UpdateSettings {
  autoCheckEnabled: boolean
  currentVersion: string
}
