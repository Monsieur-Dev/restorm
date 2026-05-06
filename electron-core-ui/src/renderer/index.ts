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
export type { UseThemeReturn } from './hooks/useTheme'
export * from './contexts'
export type { ThemeContextValue } from './contexts'
export * from './services'
export { initializeI18n, default as i18n } from './i18n'
// Utilities
export { getContrastColor } from './utils/colorContrast'
export { getColorFromString } from './utils/colorFromString'
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
export type { SettingRendererProps } from './components/Settings/renderers/types'
export { registerSettingRenderer, unregisterSettingRenderer } from './components/Settings/renderers/registry'

// Save-unit pure helpers — safe to import from renderer code (no FS access).
export { decomposeForPersistence, cleanseForPersistence } from '../main/services/saveUnit/decomposer'
export type {
  DecomposedUnit,
  DecomposedProject,
  DecomposeOptions
} from '../main/services/saveUnit/decomposer'
export type { SaveUnitKind, DirtyReason } from '../main/services/saveUnit/types'
