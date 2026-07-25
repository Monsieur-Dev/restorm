/**
 * Shared API type definitions for window.api
 *
 * These interfaces define the contract between the renderer process and the
 * main process. Both the preload bridge (IPC-based) and the web shim
 * (in-memory fallback) implement these same interfaces.
 */
import type { ThemeInfo, ThemeDefinition, ThemeVariables } from './theme'
import type { FeatureEnvironment, FeaturePlatform } from './feature'
import type { FileServiceState, FileMetadata, SerializationFormat } from './file'
import type { SettingValue, ResolvedSetting, SettingsGroup } from './settings'
import type {
  GitStatus,
  GitCommitResult,
  GitPushResult,
  GitResetResult,
  GitPullResult,
  GitFetchCompareResult,
  GitConflictVersions,
  GitConflictCommitTimestamps,
  GitState
, GitLogEntry} from './git'

export interface CoreUiThemeApi {
  list: () => Promise<ThemeInfo[]>
  load: (themeId: string) => Promise<{ theme: ThemeDefinition; variables: ThemeVariables } | null>
  getCurrent: () => Promise<string | undefined>
  set: (themeId: string) => Promise<boolean>
  updateWCO: (colors: { backgroundColor: string; symbolColor: string }) => Promise<boolean>
  onThemeChanged: (callback: (themeId: string) => void) => () => void
}

export interface CoreUiI18nApi {
  setLanguage: (language: string) => Promise<boolean>
  getLanguage: () => Promise<string>
}

export interface CoreUiLoggerApi {
  log: (level: string, message: string, meta?: Record<string, unknown>) => Promise<void>
}

export interface CoreUiStorageApi {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<boolean>
  delete: (key: string) => Promise<boolean>
}

export interface CoreUiFeatureApi {
  isEnabled: (featureName: string) => Promise<boolean>
  getPlatform: () => Promise<FeaturePlatform>
  getEnvironment: () => Promise<FeatureEnvironment>
  /** Subscribe to feature state change notifications pushed from the main
   * process. Returns an unsubscribe function. Re-query `isEnabled` inside the
   * callback to get the updated state. */
  onChanged: (callback: () => void) => () => void
}

export interface CoreUiFileApi {
  newFile: () => Promise<boolean>
  open: (path?: string) => Promise<{ success: boolean; content?: unknown }>
  save: (content: unknown, options?: { force?: boolean }) => Promise<boolean>
  showExternalChangeDialog: () => Promise<'reload' | 'keepMine'>
  acceptExternalChange: () => Promise<void>
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
  // Save unit v2 API
  hydrateSaveUnit: (params: {
    runtimeId: string
    kind: 'file' | 'folder'
    reference: unknown
    parentId?: string
  }) => Promise<void>
  upsertSaveUnit: (params: {
    runtimeId: string
    kind: 'file' | 'folder'
    draft: unknown
    reason?: 'modify' | 'create' | 'delete' | 'rename' | 'move' | 'reorder'
    parentId?: string
  }) => Promise<void>
  markSaveUnitDeleted: (runtimeId: string) => Promise<void>
  commitSaveUnit: (runtimeId: string) => Promise<void>
  revertSaveUnit: (runtimeId: string) => Promise<void>
  getSaveUnitsSnapshot: () => Promise<{
    isDirty: boolean
    dirtyCount: number
    dirtyUnits: { runtimeId: string; reason?: string }[]
  }>
  onUnitDirtyChanged: (
    callback: (payload: { runtimeId: string; isDirty: boolean; reason?: string }) => void
  ) => () => void
  onDraftsRestored: (
    callback: (payload: { count: number }) => void
  ) => () => void
  onFileExternallyChanged: (
    callback: (payload: { path: string | null }) => void
  ) => () => void
  onAutoSaveTrigger: (callback: () => void) => () => void
  saveUnit: (entry: {
    runtimeId: string
    content: unknown
    absolutePath: string
    format: 'json' | 'json5' | 'yaml'
  }) => Promise<boolean>
  saveUnitsBatch: (
    entries: { runtimeId: string; content: unknown; absolutePath: string; format: 'json' | 'json5' | 'yaml' }[]
  ) => Promise<{ runtimeId: string; success: boolean }[]>
}

export interface CoreUiEventBusApi {
  emit: (event: string, payload: unknown) => Promise<boolean>
  emitSync: (event: string, payload: unknown) => Promise<boolean>
}

export interface CoreUiSearchDocument {
  id: string
  title: string
  description?: string | undefined
  category: string
  icon?: string | undefined
  keywords?: string | undefined
  navigation?: Record<string, unknown> | undefined
  metadata?: Record<string, unknown> | undefined
}

export interface CoreUiSearchResult extends CoreUiSearchDocument {
  score: number
}

export interface CoreUiSearchResultGroup {
  category: string
  label: string
  icon: string
  items: CoreUiSearchResult[]
}

export interface CoreUiSearchApi {
  registerCategories: (categories: Record<string, { label: string; icon: string; order: number }>) => Promise<boolean>
  indexDocument: (doc: CoreUiSearchDocument) => Promise<boolean>
  indexDocuments: (docs: CoreUiSearchDocument[]) => Promise<boolean>
  removeDocument: (id: string) => Promise<boolean>
  clearIndex: () => Promise<boolean>
  search: (query: string) => Promise<CoreUiSearchResultGroup[]>
  getDocumentCount: () => Promise<number>
}

export interface CoreUiTabData {
  tabId: string
  title: string
  groupId: string
  content?: string | undefined
  cursorX?: number | undefined
  cursorY?: number | undefined
}

export interface CoreUiWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface CoreUiSettingsApi {
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

export interface CoreUiGitApi {
  isRepo: (folder: string) => Promise<boolean>
  getStatus: (folder: string) => Promise<GitStatus>
  /** Full multi-ref history, newest first (`git log --all --topo-order`). */
  log: (folder: string) => Promise<GitLogEntry[]>
  stage: (folder: string, paths: string[]) => Promise<void>
  /** `paths` scopes the commit to those files — without it, anything the
   * user staged themselves would be published too. */
  commit: (folder: string, message: string, paths?: string[]) => Promise<GitCommitResult>
  push: (folder: string) => Promise<GitPushResult>
  pull: (folder: string) => Promise<GitPullResult>
  refreshState: () => Promise<void>
  fetchAndCompare: (folder: string) => Promise<GitFetchCompareResult>
  getConflictVersions: (folder: string, filePath: string) => Promise<GitConflictVersions>
  getFileAtHead: (folder: string, filePath: string) => Promise<string | null>
  /** Read the file on the branch's upstream ref — the "theirs" side of a
   * pre-merge comparison (no commit, no merge, no working-tree change). */
  getFileAtRemote: (folder: string, filePath: string) => Promise<string | null>
  /** The file at the merge base (common ancestor of HEAD and its
   * upstream) — the "base" side of a three-way merge. */
  getFileAtMergeBase: (folder: string, filePath: string) => Promise<string | null>
  /** Read the file as it stands in the working tree — the "ours" side. */
  getWorkingTreeFile: (folder: string, filePath: string) => Promise<string | null>
  /** Move the branch onto its upstream, leaving every file on disk as-is. */
  resetToRemoteKeepingWorkingTree: (folder: string) => Promise<GitResetResult>
  /** Move the branch AND the working tree onto the upstream, discarding
   * local modifications to tracked files. Destructive — confirm first. */
  resetHardToRemote: (folder: string) => Promise<GitResetResult>
  writeResolvedConflict: (folder: string, filePath: string, content: string) => Promise<void>
  recoverFileAtRevision: (folder: string, filePath: string, revision: string) => Promise<string>
  abortMerge: (folder: string) => Promise<void>
  getConflictCommitTimestamps: (folder: string) => Promise<GitConflictCommitTimestamps>
  setActiveFolder: (folder: string | null) => Promise<void>
  getState: () => Promise<GitState>
  onStateChanged: (callback: (state: GitState) => void) => () => void
  onCliMissing: (callback: () => void) => () => void
  onPullAvailable: (callback: () => void) => () => void
}

/**
 * Native application menu (macOS puts menus in the system bar, outside the
 * window). The template is derived by walking the MenuBar JSX, so the menu
 * definition stays in one place.
 */
export interface CoreUiNativeMenuApi {
  set: (template: unknown) => Promise<boolean>
  clear: () => Promise<boolean>
  onInvoke: (callback: (id: string) => void) => () => void
}

export interface CoreUiApi {
  platform: string
  nativeMenu: CoreUiNativeMenuApi
  theme: CoreUiThemeApi
  i18n: CoreUiI18nApi
  logger: CoreUiLoggerApi
  storage: CoreUiStorageApi
  feature: CoreUiFeatureApi
  file: CoreUiFileApi
  eventBus: CoreUiEventBusApi
  search: CoreUiSearchApi
  settings: CoreUiSettingsApi
  git: CoreUiGitApi
  toggleFullscreen: () => Promise<boolean>
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  toggleDeveloperTools: () => Promise<void>
  setWindowTitle: (title: string) => void | Promise<void>
  getWindowIcon: () => Promise<string | undefined>
  getCursorScreenPoint: () => Promise<{ x: number; y: number; display?: CoreUiWindowBounds | undefined }>
  getActiveWindowBounds: () => Promise<CoreUiWindowBounds>
  getCurrentWindowBounds: () => Promise<CoreUiWindowBounds & { windowId: number }>
  createAuxWindow: (payload: { editorId: string; title: string }, bounds: { x: number; y: number; width?: number | undefined; height?: number | undefined }) => Promise<void>
  getWindowUnderCursor: () => Promise<{ windowId: number; bounds: CoreUiWindowBounds } | null>
  sendWorkbenchTabToWindow: (targetWindowId: number, tabData: CoreUiTabData) => Promise<boolean>
  onWorkbenchTabDropped: (callback: (tabData: CoreUiTabData) => void) => () => void
}
