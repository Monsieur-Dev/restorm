// Ensure a safe window.api shim exists when running in a non-Electron (pure web) environment
import { ensureCoreUiWebApiShim } from './webShim'

ensureCoreUiWebApiShim()

// Renderer process exports
export * from './components'
export * from './effects'
export { MessageType, onWorkbenchTabDropped } from './components'
export { ElectronCoreUiProvider } from './components/ElectronCoreUiProvider'
export type { ElectronCoreUiProviderProps } from './components/ElectronCoreUiProvider'
export * from './hooks'
export * from './contexts'
export type { ThemeContextValue } from './contexts'
export * from './services'
export { initializeI18n, default as i18n } from './i18n'
// Utilities
export { getContrastColor } from './utils/colorContrast'
export { getColorFromString } from './utils/colorFromString'
export { isUndoKeyEvent, isRedoKeyEvent } from './utils/undoRedoKeys'
export {
  runThemeRevealTransition,
  setPendingThemeRevealOrigin,
  consumePendingThemeRevealOrigin
} from './utils/themeReveal'
export type { ThemeRevealOrigin } from './utils/themeReveal'

// Error classes and helpers
export {
  FileSystemError,
  PersistenceError,
  IpcError,
  errorMeta
} from '../errors'
export type {
  FileSystemErrorCode,
  PersistenceErrorCode,
  IpcErrorCode
} from '../errors'

// Firewall shared types + IPC channel constants (consumed by the
// renderer firewall UI + a host app's preload bridge).
export {
  FIREWALL_IPC,
  FIREWALL_REQUEST_RECORD_CHANNEL
} from '../types/firewall'
export type {
  FirewallOrigin,
  FirewallPromptPayload,
  FirewallPromptResolution,
  RequestRecord,
  RequestRecordSource,
  RequestRecordVerdict,
  RequestRecordProtocol
} from '../types/firewall'

export type { ThemeInfo, ThemeDefinition, ThemeVariables } from '../types/theme'
export type {
  FeatureStrategyType,
  FeaturePlatform,
  FeatureStrategy,
  BasicStrategy,
  PlatformStrategy,
  FeatureConfig,
  FeaturesYamlConfig,
  FeatureApi
} from '../types/feature'
export type {
  SerializationFormat,
  FilePlatform,
  FileMetadata,
  CurrentFileState,
  FileServiceConfig,
  FileServiceState,
  FileServiceApi,
  WebFileEntry
} from '../types/file'
export type { PersistenceFormat } from '../main/services/PersistenceService'
export type {
  GitFileState,
  GitFileEntry,
  GitStatus,
  GitCommitResult,
  GitPushResult,
  GitPullResult,
  GitFetchCompareResult,
  GitConflictVersions,
  GitConflictCommitTimestamps,
  GitState
} from '../types/git'
export { NO_GIT_STATE } from '../types/git'
export type { SettingRendererProps } from './components/Settings/renderers/types'
export { registerSettingRenderer, unregisterSettingRenderer } from './components/Settings/renderers/registry'
// The canonical settings storage-key builder — any renderer code hardcoding
// a settings key outside the YAML-driven `useSetting()` path (e.g. a host
// hook like restorm's `usePushModal.ts`) must go through this rather than
// re-deriving the `<group>:<id>` format by hand, or it silently reads/
// writes a DIFFERENT storage entry than the one the Settings UI row uses.
export { buildSettingsStorageKey } from '../types/settings'

// Save-unit pure helpers — safe to import from renderer code (no FS access).
export { decomposeForPersistence, cleanseForPersistence } from '../main/services/saveUnit/decomposer'
export type {
  DecomposedUnit,
  DecomposedProject,
  DecomposeOptions
} from '../main/services/saveUnit/decomposer'
export type { SaveUnitKind, DirtyReason } from '../main/services/saveUnit/types'

// Auth shared types — re-exported from renderer so renderer code can import
// `AuthState`, `AUTH_IPC`, etc. from `electron-core-ui/renderer` without
// crossing into the main-process module tree.
export type { AuthState, CheckoutResult, PlanTier } from '../shared/auth/authState'
export { AUTH_IPC, SIGNED_OUT_STATE, hasCapability } from '../shared/auth/authState'
