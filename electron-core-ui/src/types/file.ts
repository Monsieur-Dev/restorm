/**
 * File Service types and definitions
 *
 * Provides file management with serialization (JSON/YAML),
 * recent files tracking, and favorites management.
 */

/**
 * Serialization format for files
 */
export type SerializationFormat = 'json' | 'yaml'

/**
 * Platform type for file operations
 */
export type FilePlatform = 'desktop' | 'web'

/**
 * File metadata for recent files and favorites
 */
export interface FileMetadata {
  /** Full path (desktop) or storage key (web) */
  path: string
  /** Display name (filename without path and extension) */
  name: string
  /** Last opened timestamp */
  lastOpened: number
  /** Whether this file is a favorite */
  isFavorite: boolean
}

/**
 * Current file state
 */
export interface CurrentFileState {
  /** Full path (desktop) or storage key (web) */
  path: string | null
  /** Display name */
  name: string | null
  /** Whether the file has unsaved changes */
  isDirty: boolean
  /** The file content */
  content: unknown
  /** Serialization format used */
  format: SerializationFormat
  /** Content checksum for change detection (JSON stringified content at last save/open) */
  contentChecksum: string | null
}

/**
 * Verdict returned by {@link FileServiceConfig.validateOnOpen}.
 *
 * `ok: false` aborts the open completely: the document is not loaded, the
 * previous file stays open, the path is not added to recent files, and —
 * crucially — nothing is written to the file.
 */
export interface OpenValidationResult {
  /** `false` refuses the document. */
  ok: boolean
  /**
   * Stable machine-readable reason, forwarded to the renderer with the
   * `file:open-rejected` broadcast. The host app maps it to a localized
   * message; the library never renders user-facing text of its own.
   */
  code?: string
  /**
   * Structured values the host's message needs (e.g. the version found
   * versus the version supported). Must be JSON-serializable — it crosses
   * the IPC boundary.
   */
  detail?: Record<string, unknown>
}

/** Payload of the `file:open-rejected` broadcast. */
export interface OpenRejectedPayload {
  /** Absolute path of the document that was refused. */
  path: string
  /** The `code` returned by the validator, when it supplied one. */
  code?: string
  /** The `detail` returned by the validator, when it supplied one. */
  detail?: Record<string, unknown>
}

/**
 * File service configuration
 */
export interface FileServiceConfig {
  /** File extension to use (e.g., '.myapp') */
  extension: string
  /** Default serialization format */
  defaultFormat: SerializationFormat
  /** Maximum number of recent files to track */
  maxRecentFiles: number
  /** Storage key prefix for web localStorage */
  storagePrefix: string
  /**
   * Top-level property name that stores the file's stable UUID (see
   * `ensureFileUuid` / `ensureFolderUuid`). `FileService.save` /
   * `saveAs` use this key to preserve the UUID across writes so the
   * renderer doesn't need to round-trip it on every payload.
   *
   * Defaults to `_uuid`. Host apps that already ship a bespoke key on
   * disk (e.g. restorm's `_projectUuid`) should set this explicitly.
   */
  uuidKey?: string
  /**
   * Optional gate letting the host app refuse a document it cannot open.
   *
   * Called by `open()` on the freshly parsed content, BEFORE anything is
   * written to the file, before the UUID is stamped, before the path
   * joins recent files, and before `file:opened` is broadcast — so a
   * refusal leaves both the file and the app exactly as they were.
   *
   * The library stays out of the decision: it neither knows nor cares why
   * a document is unacceptable (an unsupported format version, a schema
   * the build predates, a required capability the app lacks). It only
   * relays the `code` / `detail` the validator returns, so the renderer
   * can render a message in the user's language — the main process
   * typically carries far fewer locales than the renderer does.
   *
   * Must be synchronous and side-effect free. Throwing is treated as a
   * refusal rather than being allowed to escape.
   */
  validateOnOpen?: (content: unknown, filePath: string) => OpenValidationResult
}

/**
 * Save dialog result
 */
export interface SaveDialogResult {
  /** Whether the dialog was cancelled */
  canceled: boolean
  /** Selected file path (undefined if cancelled) */
  filePath?: string
}

/**
 * Open dialog result
 */
export interface OpenDialogResult {
  /** Whether the dialog was cancelled */
  canceled: boolean
  /** Selected file paths (empty if cancelled) */
  filePaths: string[]
}

/**
 * File list for web open dialog
 */
export interface WebFileEntry {
  /** Storage key */
  key: string
  /** Display name */
  name: string
  /** Last modified timestamp */
  lastModified: number
}

/**
 * File service state exposed to renderer
 */
export interface FileServiceState {
  /** Current file info */
  currentFile: CurrentFileState
  /** Recent files list */
  recentFiles: FileMetadata[]
  /** Favorite files list */
  favorites: FileMetadata[]
  /** Current platform */
  platform: FilePlatform
}

/**
 * Labels for the unsaved changes dialog (for i18n support)
 */
export interface UnsavedChangesDialogLabels {
  title?: string
  message?: string
  detail?: string
  save?: string
  dontSave?: string
  cancel?: string
}

/**
 * File service API exposed to renderer
 */
export interface FileServiceApi {
  /** Create a new empty file */
  newFile: () => Promise<boolean>
  /** Open a file (shows dialog if no path provided) */
  open: (path?: string) => Promise<boolean>
  /** Save current file (shows SaveAs dialog if new file) */
  save: () => Promise<boolean>
  /** Save file with a new name/path */
  saveAs: (filename?: string, format?: SerializationFormat) => Promise<boolean>
  /** Close current file */
  close: () => Promise<boolean>
  /** Get current file state */
  getState: () => Promise<FileServiceState>
  /** Get current file name */
  getFileName: () => Promise<string | null>
  /** Get current file path */
  getFilePath: () => Promise<string | null>
  /** Check if file is dirty (derived from the save-unit registry) */
  isDirty: () => Promise<boolean>
  /** Get recent files */
  getRecentFiles: () => Promise<FileMetadata[]>
  /** Get favorite files */
  getFavorites: () => Promise<FileMetadata[]>
  /** Toggle favorite status for a file */
  toggleFavorite: (path: string) => Promise<boolean>
  /** Remove a file from recent files */
  removeFromRecent: (path: string) => Promise<void>
  /** Get list of available files for web open dialog */
  getWebFiles: () => Promise<WebFileEntry[]>
  /** Subscribe to file state changes */
  onStateChanged: (callback: (state: FileServiceState) => void) => () => void
  /** Subscribe to dirty state changes */
  onDirtyChanged: (callback: (isDirty: boolean) => void) => () => void
}

/**
 * Events emitted by the file service
 */
export const FileServiceEvents = {
  STATE_CHANGED: 'file:state:changed',
  DIRTY_CHANGED: 'file:dirty:changed',
  FILE_OPENED: 'file:opened',
  FILE_OPEN_REJECTED: 'file:open-rejected',
  FILE_SAVED: 'file:saved',
  FILE_CLOSED: 'file:closed'
} as const

export type FileServiceEventName = (typeof FileServiceEvents)[keyof typeof FileServiceEvents]
