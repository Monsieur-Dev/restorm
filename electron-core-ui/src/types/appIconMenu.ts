/**
 * Wire contract for the application-icon menu (macOS Dock and Windows jump
 * lists; Linux desktop actions land later).
 *
 * The menu is built in the main process, because the OS shows it while the
 * app has no window open at all. Its *dynamic* part (recent files,
 * favorites) therefore comes from the main-side `FileService`, while its
 * three static labels are pushed in by the host renderer: the renderer is
 * the process that loads the full set of shipped locales, so it is the only
 * one that can name the entries in the user's own language.
 */

/** Renderer → main: translated labels for the static menu entries. */
export interface AppIconMenuLabels {
  /** Label of the "new file" action. */
  newFile: string
  /** Label of the recent-files submenu. */
  recentFiles: string
  /** Label of the favorites submenu. */
  favorites: string
}

/** Renderer → main: publish the translated labels. Payload: {@link AppIconMenuLabels}. */
export const APP_ICON_MENU_SET_LABELS_CHANNEL = 'app-icon-menu:set-labels'

/**
 * Stable ids for the three top-level entries of the neutral menu model.
 *
 * Adapters that render only part of the model (e.g. the Linux integration,
 * which maps recents onto the freedesktop recent-documents store and drops the
 * rest) match on these rather than on translated labels.
 */
export const NEW_FILE_ENTRY_ID = 'new-file'
export const FAVORITES_ENTRY_ID = 'favorites'
export const RECENT_FILES_ENTRY_ID = 'recent-files'

/**
 * What activating an entry of the app-icon menu does.
 *
 * The set is closed: the menu is a shortcut into the file lifecycle, not a
 * second application menu. It travels on the wire so the same value that
 * built an entry can be dispatched when the entry is activated — whether that
 * is a Dock click handled in main or a jump-list relaunch that carries it in
 * argv.
 */
export type AppIconAction =
  | { kind: 'new-file' }
  | { kind: 'open-file'; path: string }

/**
 * Main → renderer: run an activated action through the host's own file flow.
 *
 * A window's "new" and "open recent" commands guard unsaved work before they
 * replace the current document; dispatching the menu action straight against
 * the file service in main would bypass that prompt. So when a window is
 * present the host forwards the action here and lets the renderer run the
 * same guarded command the in-app menus use. Payload: {@link AppIconAction}.
 */
export const APP_ICON_MENU_INVOKE_CHANNEL = 'app-icon-menu:invoke'
