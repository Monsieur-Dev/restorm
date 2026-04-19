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
  FILE_SAVED: 'file:saved',
  FILE_CLOSED: 'file:closed'
} as const

export type FileServiceEventName = (typeof FileServiceEvents)[keyof typeof FileServiceEvents]
