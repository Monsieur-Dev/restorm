// Main process exports - with proper TypeScript types
export { getThemeService, getStorageService, logger, initFeatureService, getFeatureService, isFeatureServiceInitialized, initFileService, getFileService, isFileServiceInitialized, eventBusService, searchService, i18nService, graphQLService, createSchema, createPubSub } from './services'
export { BaseWindow, setupIPC, setupAppLifecycle, initializeApp, configureCommandLineSwitches, setupAppProtocol } from './managers'
export type { WindowConfiguration, WindowState } from './managers'

// Re-export types for better type inference
export type { ThemeService } from './services/ThemeService'
export type { StorageService } from './services/StorageService'
export type { LoggerInterface } from './services/LoggerService'
export type { FeatureFlippingService } from './services/FeatureFlippingService'
export type { FileService } from './services/FileService'
export type { EventHandler, Subscription } from './services/EventBusService'
export type { SearchDocument, SearchResult, SearchNavigation, GroupedResults, CategoryMeta } from './services/SearchService'
export type { GraphQLServiceConfig, PubSub } from './services/GraphQLService'

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
