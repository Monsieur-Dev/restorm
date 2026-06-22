// Main process exports — grouped by concern so Rollup's static analyzer
// keeps tracing each one reliably even when the dist/ CJS emit is split
// into multiple `exports.X = void 0` declarator lines.

// Core services
export {
  getThemeService,
  getStorageService,
  logger,
  eventBusService,
  searchService,
  i18nService
} from './services'

// Feature flags
export {
  initFeatureService,
  getFeatureService,
  isFeatureServiceInitialized,
  resetFeatureService
} from './services'

// File service
export {
  initFileService,
  getFileService,
  isFileServiceInitialized,
  FileService
} from './services'

// GraphQL runtime
export {
  graphQLService,
  createSchema,
  createYoga,
  createPubSub,
  graphQLSchemaGenerator,
  inferGraphQLType,
  createFieldDefinitions
} from './services'

// Persistence service + helpers
export {
  initPersistenceService,
  getPersistenceService,
  isPersistenceServiceInitialized,
  PersistenceService,
  serialize,
  deserialize,
  detectFormat,
  filterNonSerialised,
  generateIndexedFileName,
  sanitizeFileName,
  calculateIndexPadding,
  PERSISTENCE_FORMATS,
  atomicWriteFile
} from './services'

// Settings
export {
  initSettingsService,
  getSettingsService,
  isSettingsServiceInitialized
} from './services'

// AutoSave controller
export {
  AutoSaveController,
  initAutoSaveController,
  getAutoSaveController
} from './services'
export type { AutoSaveMode, AutoSaveControllerOptions } from './services'

// MCP service (Streamable HTTP, off by default)
export { McpService, MCP_SESSION_ROUTING_KEY, MCP_FORWARDED_HEADER } from './services'
export type { McpServiceOptions, McpToolConfig, McpToolHandler, McpResourceConfig, McpResourceHandler } from './services'
export {
  resolveMcpDiscoveryDir,
  writeMcpDiscoveryFile,
  cleanupMcpDiscoveryFile,
  findLiveSessionByName,
  forwardToNamedSession,
  readAllInstancesIncludingCut
} from './services'
export type { McpDiscoveryEntry } from './services'

// Firewall — generic outbound-network gating (intercept → permission
// model → user prompt → allow/deny rules). See docs/Firewall/README.md.
export {
  firewallService,
  permissionService,
  installMainProcessInterceptor,
  installHardenInterceptor,
  installWorkerPatcher,
  registerFirewallIpc,
  withFirewallBypass,
  withFirewallBypassSync,
  isFirewallBypassed,
  configureFirewall,
  resetFirewallConfig
} from './services'
export type {
  Verdict,
  Classification,
  CheckInput,
  InfraPorts,
  PendingPromptSnapshot,
  FirewallConfig
} from './services'
// Firewall shared types (origins, IPC channels, request records)
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

// Save-unit / draft-store (file service v2)
export {
  SaveUnitRegistry,
  DraftStore,
  sweepOrphanedDrafts,
  DEFAULT_DRAFT_DEBOUNCE_MS,
  isTombstone,
  makeTombstone,
  isUnitDirty,
  isUnitPendingDelete,
  isUnitNew,
  decomposeForPersistence,
  cleanseForPersistence,
  ensureFolderUuid,
  ensureFileUuid,
  readFolderUuid,
  DEFAULT_UUID_KEY
} from './services'

export type {
  SaveUnit,
  SaveUnitKind,
  Tombstone,
  DirtyReason,
  UnitChangeSnapshot,
  UnitChangeListener,
  DraftStoreOptions,
  LoadedDraft,
  DecomposedUnit,
  DecomposedProject,
  DecomposeOptions,
  EnsureFolderUuidOptions,
  EnsureFileUuidOptions,
  EnsureUuidResult
} from './services'

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
export { BaseWindow, setupIPC, setupAppLifecycle, initializeApp, configureCommandLineSwitches, setupAppProtocol, createSplashWindow, isInactiveRevealRequested, clearStartupActivationEnv } from './managers'
export type { WindowConfiguration, WindowState, InitializeAppOptions, SplashWindowOptions, SplashWindowHandle } from './managers'

// IPC validation
export { validatedHandle } from './ipc/validate'

// Re-export types for better type inference
export type { ThemeService } from './services/ThemeService'
export type { StorageService } from './services/StorageService'
export type { LoggerInterface } from './services/LoggerService'
export type { FeatureFlippingService } from './services/FeatureFlippingService'
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
