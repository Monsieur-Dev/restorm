// Global type definitions for electron-core-ui

import type { ThemeInfo, ThemeDefinition, ThemeVariables } from '../../types/theme'
import type { FeaturePlatform } from '../../types/feature'
import type { FileServiceState, FileMetadata, SerializationFormat } from '../../types/file'
import type { SettingValue, ResolvedSetting, SettingsGroup } from '../../types/settings'
import type { AuthState, CheckoutResult, PortalResult } from '../../shared/auth/authState'
import type {
  GitStatus,
  GitCommitResult,
  GitPushResult,
  GitPullResult,
  GitFetchCompareResult,
  GitConflictVersions,
  GitConflictCommitTimestamps,
  GitState
} from '../../types/git'

interface WindowApiTheme {
  list: () => Promise<ThemeInfo[]>
  load: (themeId: string) => Promise<{ theme: ThemeDefinition; variables: ThemeVariables } | null>
  getCurrent: () => Promise<string | undefined>
  set: (themeId: string) => Promise<boolean>
  updateWCO: (colors: { backgroundColor: string; symbolColor: string }) => Promise<boolean>
  onThemeChanged: (callback: (themeId: string) => void) => () => void
}

interface WindowApiI18n {
  setLanguage: (language: string) => Promise<boolean>
  /** The language the user EXPLICITLY chose, or `''` when they never have.
   * Callers read `''` as "fall back to the OS locale", so an implementation
   * must never substitute a guess of its own here. */
  getLanguage: () => Promise<string>
}

interface WindowApiStorage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<boolean>
  delete: (key: string) => Promise<boolean>
}

interface WindowApiFeature {
  isEnabled: (featureName: string) => Promise<boolean>
  getPlatform: () => Promise<FeaturePlatform>
}

interface WindowApiFile {
  newFile: () => Promise<boolean>
  open: (path?: string) => Promise<{ success: boolean; content?: unknown }>
  save: (content: unknown) => Promise<boolean>
  saveAs: (content: unknown, filename?: string, format?: SerializationFormat) => Promise<boolean>
  close: () => Promise<boolean>
  getState: () => Promise<FileServiceState | null>
  getFileName: () => Promise<string | null>
  getFilePath: () => Promise<string | null>
  isDirty: () => Promise<boolean>
  finishLoading: () => Promise<void>
  showUnsavedChangesDialog: (labels?: {
    title?: string
    message?: string
    detail?: string
    save?: string
    dontSave?: string
    cancel?: string
  }) => Promise<'save' | 'discard' | 'cancel'>
  getRecentFiles: () => Promise<FileMetadata[]>
  getFavorites: () => Promise<FileMetadata[]>
  toggleFavorite: (path: string) => Promise<boolean>
  removeFromRecent: (path: string) => Promise<void>
  getContentChecksum: () => Promise<string | null>
  setContentChecksum: (checksum: string) => Promise<void>
  hasContentChanged: (currentChecksum: string) => Promise<boolean>
  onStateChanged: (callback: (state: FileServiceState) => void) => () => void
  onDirtyChanged: (callback: (isDirty: boolean) => void) => () => void
  onFileOpened: (callback: (state: FileServiceState) => void) => () => void
  onFileClosed: (callback: () => void) => () => void
}

interface WindowApiEventBus {
  emit: (event: string, payload: unknown) => Promise<boolean>
  emitSync: (event: string, payload: unknown) => Promise<boolean>
}

interface WindowApiSearchDocument {
  id: string
  title: string
  description?: string
  category: string
  icon?: string
  keywords?: string
  navigation?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

interface WindowApiSearchResult extends WindowApiSearchDocument {
  score: number
}

interface WindowApiGroupedResults {
  category: string
  label: string
  icon: string
  items: WindowApiSearchResult[]
}

interface WindowApiSearch {
  registerCategories: (categories: Record<string, { label: string; icon: string; order: number }>) => Promise<boolean>
  indexDocument: (doc: WindowApiSearchDocument) => Promise<boolean>
  indexDocuments: (docs: WindowApiSearchDocument[]) => Promise<boolean>
  removeDocument: (id: string) => Promise<boolean>
  clearIndex: () => Promise<boolean>
  search: (query: string) => Promise<WindowApiGroupedResults[]>
  getDocumentCount: () => Promise<number>
}

interface WindowApiAccount {
  /** Trigger RFC 8252 loopback login; resolves to the resulting AuthState. */
  login: () => Promise<AuthState>
  /** Clear the local session (safeStorage wipe) and broadcast signed-out state. */
  logout: () => Promise<AuthState>
  /** Return the current in-memory AuthState snapshot (no IPC round-trip). */
  getState: () => Promise<AuthState>
  /** Subscribe to live state transitions; returns an unsubscribe function. */
  onStateChanged: (callback: (state: AuthState) => void) => () => void
  /** Open the Paddle checkout URL for upgrading to Pro. */
  subscribe: () => Promise<CheckoutResult>
  /** Open the hosted Paddle customer portal (manage / cancel the subscription)
   * in the system browser. */
  manageSubscription: () => Promise<PortalResult>
}

interface WindowApiSettings {
  get: (storageKey: string) => Promise<SettingValue | null>
  set: (storageKey: string, value: SettingValue) => Promise<boolean>
  getAll: () => Promise<ResolvedSetting[]>
  getGroups: () => Promise<SettingsGroup[]>
  search: (query: string) => Promise<ResolvedSetting[]>
  reset: (storageKey: string) => Promise<boolean>
  reindex: () => Promise<void>
  onSettingChanged: (callback: (storageKey: string, value: SettingValue) => void) => () => void
  onConfigLoaded: (callback: () => void) => () => void
  // ── Workspace overlay ──────────────────────────────────────────
  getWorkspacePath: () => Promise<string | null>
  getWorkspaceValues: () => Promise<Record<string, SettingValue>>
  getWorkspaceValue: (storageKey: string) => Promise<SettingValue | null>
  setWorkspaceValue: (storageKey: string, value: SettingValue) => Promise<boolean>
  resetWorkspaceValue: (storageKey: string) => Promise<boolean>
  getResolvedValue: (storageKey: string) => Promise<{
    storageKey: string
    effective: SettingValue
    source: 'workspace' | 'user' | 'default'
    overriddenBy?: 'workspace'
  } | null>
  onWorkspaceChanged: (callback: (path: string | null) => void) => () => void
}

interface WindowApiGit {
  isRepo: (folder: string) => Promise<boolean>
  getStatus: (folder: string) => Promise<GitStatus>
  stage: (folder: string, paths: string[]) => Promise<void>
  commit: (folder: string, message: string) => Promise<GitCommitResult>
  push: (folder: string) => Promise<GitPushResult>
  pull: (folder: string) => Promise<GitPullResult>
  refreshState: () => Promise<void>
  fetchAndCompare: (folder: string) => Promise<GitFetchCompareResult>
  getConflictVersions: (folder: string, filePath: string) => Promise<GitConflictVersions>
  getFileAtHead: (folder: string, filePath: string) => Promise<string | null>
  writeResolvedConflict: (folder: string, filePath: string, content: string) => Promise<void>
  abortMerge: (folder: string) => Promise<void>
  getConflictCommitTimestamps: (folder: string) => Promise<GitConflictCommitTimestamps>
  setActiveFolder: (folder: string | null) => Promise<void>
  getState: () => Promise<GitState>
  onStateChanged: (callback: (state: GitState) => void) => () => void
  onCliMissing: (callback: () => void) => () => void
  onPullAvailable: (callback: () => void) => () => void
}

/** Native application menu (macOS renders menus in the system bar). */
interface WindowApiNativeMenu {
  set: (template: unknown) => Promise<boolean>
  clear: () => Promise<boolean>
  onInvoke: (callback: (id: string) => void) => () => void
}

interface WindowApi {
  platform: string
  toggleFullscreen: () => Promise<boolean>
  nativeMenu: WindowApiNativeMenu
  theme: WindowApiTheme
  i18n: WindowApiI18n
  logger: {
    log: (level: string, message: string, meta?: Record<string, unknown>) => Promise<void>
  }
  storage: WindowApiStorage
  feature: WindowApiFeature
  file: WindowApiFile
  eventBus: WindowApiEventBus
  search: WindowApiSearch
  settings: WindowApiSettings
  /** Cloud account: session login/logout + live entitlement state. */
  account: WindowApiAccount
  git: WindowApiGit
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  toggleDeveloperTools: () => Promise<void>
  setWindowTitle: (title: string) => void
  getWindowIcon: () => Promise<string | undefined>
  getCursorScreenPoint: () => Promise<{ x: number; y: number; display?: { x: number; y: number; width: number; height: number } }>
  getActiveWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number }>
  getCurrentWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number; windowId: number }>
  createAuxWindow: (payload: { editorId: string; title: string }, bounds: { x: number; y: number; width?: number; height?: number }) => Promise<void>
  getWindowUnderCursor: () => Promise<{ windowId: number; bounds: { x: number; y: number; width: number; height: number } } | null>
  sendWorkbenchTabToWindow: (
    targetWindowId: number,
    tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }
  ) => Promise<boolean>
  onWorkbenchTabDropped: (
    callback: (tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }) => void
  ) => () => void
}

declare global {
  interface Window {
    api: WindowApi
    // Mirrors the preload's createElectronAPI() surface. The on* methods
    // return a disposer that removes the IPC listener — declared here so
    // renderer consumers can capture it (and so the type stays in step with
    // the preload, which is in a separate tsconfig project we don't import
    // across). Keep in sync with src/preload/electronAPI.ts.
    electronAPI?: {
      onPlatform: (callback: (platform: string) => void) => () => void
      onWindowState: (callback: (state: string) => void) => () => void
      sendAction: (action: string) => void
      onKeyboardShortcut: (callback: (shortcut: string) => void) => () => void
      registerInterceptedShortcuts: (shortcuts: string[]) => void
      isDevMode: () => Promise<boolean>
      notifyReady: () => void
    }
  }
}

export {}
