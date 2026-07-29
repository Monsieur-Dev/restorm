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
  GET_RELEASE_NOTES: 'update:get-release-notes',
  GET_LAST_SEEN_VERSION: 'update:get-last-seen-version',
  MARK_VERSION_SEEN: 'update:mark-version-seen',
  /** main → renderer broadcast of every state transition. */
  STATE_CHANGED: 'update:state-changed'
} as const

/**
 * Public release-feed base URL, no trailing slash. Single source of truth for
 * the host — it MUST stay in sync with `build.publish[].url` in `package.json`
 * (electron-updater reads that one for the update feed itself; this one is for
 * the hosted changelog served alongside it).
 */
export const RELEASE_FEED_BASE = 'https://dl.restorm.app'

/**
 * A UI locale tag we are willing to interpolate into a path: `fr`, `zh-CN`,
 * `pt-BR`, `zh-Hans-CN`. Deliberately permissive about the SHAPE of a language
 * tag — the point is not to validate BCP-47 (rejecting a tag i18next legitimately
 * produced would break the feature for that user), it is to exclude anything
 * that could act as a path: no separators, no dots, no traversal.
 *
 * It matters because the locale arrives from the renderer over IPC and is
 * interpolated into BOTH a filesystem path (`changelogs/<locale>.md`) and a
 * release-feed URL fetched with the firewall bypassed.
 */
export const LOCALE_TAG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/

/**
 * One release's notes: a version label + its markdown body. Matches the
 * `ReleaseNoteSection` the electron-core-ui `ReleaseNotesModal` consumes
 * (structurally identical) — this is the shape the `get-release-notes` IPC
 * returns. The markdown is rendered with images restricted to inline `data:`
 * URIs (release-note images are authored that way); images and media the
 * renderer would have to fetch are dropped at render time rather than displayed,
 * so opening the notes issues no external image/media request the firewall would
 * gate. Release notes are first-party in-repo markdown, so this is a
 * belt-and-braces guarantee about content we author, not a sandbox for hostile
 * input — raw `<script src>` is out of scope.
 */
export interface ReleaseNoteSection {
  /** Dotted version, e.g. `1.2.0`. */
  version: string
  /** The release note markdown for this version. */
  markdown: string
}

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
  /**
   * Whether THIS build manages its own updates (a direct-download build:
   * AppImage / NSIS / dmg from the release feed). False for store / package-
   * manager builds (Mac App Store, Snap, Windows Store, apt, …) where the store
   * owns updates and the in-app updater is disabled — the "Check for updates"
   * menu entry is hidden in that case.
   */
  autoUpdateSupported: boolean
}
