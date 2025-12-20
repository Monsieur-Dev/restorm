// Main process exports - with proper TypeScript types
export { getThemeService, getStorageService, logger, initFeatureService, getFeatureService, isFeatureServiceInitialized, initFileService, getFileService, isFileServiceInitialized } from './services'
export { BaseWindow, setupIPC, setupAppLifecycle, initializeApp, configureCommandLineSwitches } from './managers'
export type { WindowConfiguration, WindowState } from './managers'

// Re-export types for better type inference
export type { ThemeService } from './services/ThemeService'
export type { StorageService } from './services/StorageService'
export type { LoggerInterface } from './services/LoggerService'
export type { FeatureFlippingService } from './services/FeatureFlippingService'
export type { FileService } from './services/FileService'

// Re-export feature types
export type {
  FeatureStrategyType,
  FeaturePlatform,
  FeatureStrategy,
  BasicStrategy,
  PlatformStrategy,
  FeatureConfig,
  FeaturesYamlConfig
} from '../../types/feature'

// Re-export file types
export type {
  SerializationFormat,
  FilePlatform,
  FileMetadata,
  CurrentFileState,
  FileServiceConfig,
  FileServiceState,
  FileServiceApi
} from '../../types/file'
