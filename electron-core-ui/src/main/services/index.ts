// Export services explicitly for better type inference
export { logger } from './LoggerService'
export type { LoggerInterface } from './LoggerService'

export { getStorageService, StorageService } from './StorageService'

export { getThemeService, ThemeService } from './ThemeService'

export {
  initFeatureService,
  getFeatureService,
  isFeatureServiceInitialized,
  resetFeatureService,
  FeatureFlippingService
} from './FeatureFlippingService'

export {
  initFileService,
  getFileService,
  isFileServiceInitialized,
  FileService
} from './FileService'

export { eventBusService } from './EventBusService'
export type { EventHandler, Subscription } from './EventBusService'

export { i18nService } from './I18nService'

export { searchService } from './SearchService'
export type {
  SearchDocument,
  SearchResult,
  SearchNavigation,
  GroupedResults,
  CategoryMeta
} from './SearchService'

export { graphQLService, createSchema, createYoga, createPubSub } from './GraphQLService'
export type { GraphQLServiceConfig, PubSub } from './GraphQLService'

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
} from './PersistenceService'
export type {
  PersistenceFormat,
  PersistenceMode,
  PersistenceConfig,
  FileNamingContext,
  SaveResult,
  LoadResult
} from './PersistenceService'

export {
  graphQLSchemaGenerator,
  inferGraphQLType,
  createFieldDefinitions
} from './GraphQLSchemaGenerator'
export type { SchemaGeneratorConfig, RegisterClassOptions } from './GraphQLSchemaGenerator'

export {
  initSettingsService,
  getSettingsService,
  isSettingsServiceInitialized,
  SettingsService
} from './SettingsService'
export type { SettingChangedListener } from './SettingsService'

// AutoSave controller (settings: autoSave, autoSaveDelay)
export {
  AutoSaveController,
  initAutoSaveController,
  getAutoSaveController
} from './AutoSaveController'
export type { AutoSaveMode, AutoSaveControllerOptions } from './AutoSaveController'

// Save unit registry + draft store (file service v2 building blocks)
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
} from './saveUnit'
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
} from './saveUnit'

// MCP service — embeds an MCP server (Streamable HTTP) for AI-tooling
// integrations. Off by default; the consuming app starts it explicitly
// from a CLI flag. See docs/McpService/README.md for the full surface.
export { McpService, DEFAULT_SERVED_CALL_CAP, DEFAULT_CAPTURE_RETENTION_CAP } from './McpService'
export type {
  McpServiceOptions,
  McpToolConfig,
  McpToolHandler,
  McpResourceConfig,
  McpResourceHandler,
  McpServedCallEntry,
  McpServedCapture
} from './McpService'

// MCP cross-instance bridge — generic named-session discovery + transport.
// Lets multiple MCP-enabled instances of the same app coexist and route
// `tools/call`s to a specific instance by name. See docs/McpService/README.md.
export {
  MCP_SESSION_ROUTING_KEY,
  MCP_FORWARDED_HEADER,
  resolveMcpDiscoveryDir,
  writeMcpDiscoveryFile,
  cleanupMcpDiscoveryFile,
  findLiveSessionByName,
  forwardToNamedSession,
  readAllInstancesIncludingCut
} from './mcpDiscovery'
export type { McpDiscoveryEntry } from './mcpDiscovery'

// Firewall — generic outbound-network gating: intercept → permission
// model → user prompt → allow/deny rules. The host app injects its
// config (internal-endpoint skip, infra ports, e2e bypass) via
// `configureFirewall` + `setInfraPorts`; everything else is generic.
// See docs/Firewall/README.md for the full surface.
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
} from './firewall'
export type {
  Verdict,
  Classification,
  CheckInput,
  InfraPorts,
  PendingPromptSnapshot,
  FirewallConfig
} from './firewall'
