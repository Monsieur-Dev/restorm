// Main process exports - with proper TypeScript types
export { getThemeService, getStorageService, logger, initFeatureService, getFeatureService, isFeatureServiceInitialized, initFileService, getFileService, isFileServiceInitialized, eventBusService, searchService, i18nService, graphQLService, createSchema, createPubSub, initPersistenceService, getPersistenceService, isPersistenceServiceInitialized, PersistenceService, serialize, deserialize, detectFormat, filterNonSerialised, generateIndexedFileName, sanitizeFileName, calculateIndexPadding, PERSISTENCE_FORMATS, graphQLSchemaGenerator, inferGraphQLType, createFieldDefinitions } from './services'

// Decorators
export {
  trackable,
  searchable,
  NonSerialised,
  separateFiles,
  separateFolders,
  fileNaming,
  graphqlType,
  graphqlField,
  isTrackable,
  getTrackableConfig,
  getTrackableProperties,
  isSearchable,
  getSearchableConfig,
  getSearchableProperties,
  isNonSerialised,
  getNonSerialisedProperties,
  hasSeparateFiles,
  getSeparateFilesConfig,
  getSeparateFilesProperties,
  hasSeparateFolders,
  getSeparateFoldersConfig,
  getSeparateFoldersProperties,
  getFileNamingConfig,
  generateFileName,
  isGraphQLField,
  getGraphQLTypeConfig,
  getGraphQLFieldConfig,
  getGraphQLFields,
  getAllMetadata,
  serializeWithDecorators
} from './decorators'
export type {
  TrackableConfig,
  SearchableConfig,
  SeparateFilesConfig,
  SeparateFoldersConfig,
  FileNamingConfig,
  GraphQLTypeConfig,
  GraphQLFieldConfig,
  AllMetadata
} from './decorators'
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
export type { PersistenceFormat, PersistenceMode, PersistenceConfig, FileNamingContext, SaveResult, LoadResult } from './services/PersistenceService'
export type { SchemaGeneratorConfig, RegisterClassOptions } from './services/GraphQLSchemaGenerator'

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

// Re-export feature types
export type {
  FeatureStrategyType,
  FeaturePlatform,
  FeatureStrategy,
  BasicStrategy,
  PlatformStrategy,
  FeatureConfig,
  FeaturesYamlConfig
} from '../types/feature'

// Re-export file types
export type {
  SerializationFormat,
  FilePlatform,
  FileMetadata,
  CurrentFileState,
  FileServiceConfig,
  FileServiceState,
  FileServiceApi
} from '../types/file'
