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

// Git service
export { getGitService, resetGitService, GitService } from './services'
export type { GitServiceConfig } from './services'

// Git semi-pull CRON controller
export {
  GitSemiPullController,
  initGitSemiPullController,
  getGitSemiPullController
} from './services'
export type { GitSemiPullFrequency, GitSemiPullControllerOptions } from './services'

// Commit-message engine — process-neutral (pure Handlebars, no DOM), lives
// in `src/shared` and is exported from BOTH processes: the renderer's Push
// modal renders live previews, a main-process MCP tool renders the same
// commit message for an AI agent to review before it lands.
export { renderCommitMessage } from '../shared/CommitMessageEngine'
export type { CommitMessageTemplates, RenderedCommitMessage } from '../shared/CommitMessageEngine'

// OS-locale matching — also process-neutral, and also exported from both:
// the renderer resolves its initial UI language with it, and a host that
// wants the main-process translator to follow the OS locale needs the same
// matching rules rather than a second, divergent implementation.
export { matchSupportedLocale } from '../shared/localeMatch'

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
  atomicWriteFile,
  codeOf
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
export type { McpServiceOptions, McpToolConfig, McpToolHandler, McpToolResult, McpToolGate, McpResourceConfig, McpResourceHandler } from './services'
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
  RequestRecordProtocol,
  SystemEndpointDeclaration,
  SystemEndpointStatus,
  SystemEndpointExemption
} from '../types/firewall'

// Privacy / consent — the main-process consent authority, its persistence
// adapter, and the firewall exemption that follows consent on and off.
export {
  ConsentService,
  makeConsentFileStore,
  ConsentFirewallExemption
} from './services'
export type {
  ConsentServiceOptions,
  ConsentSettingsPort,
  ConsentStorePort,
  ConsentGatedEndpoint
} from './services'

// Privacy / consent shared model + the fail-closed payload scrubber.
export type {
  ConsentDecision,
  ConsentGateDefinition,
  ConsentOverride,
  ConsentSource,
  PersistedConsentFile,
  PersistedConsentEntry
} from '../shared/privacy/consent'
export {
  scrubPayload,
  scrubString,
  assertScrubbed,
  findScrubViolations,
  PayloadNotScrubbedError,
  REDACTED,
  REDACTED_URL,
  REDACTED_EMAIL,
  REDACTED_IP,
  REDACTED_TOKEN,
  REDACTED_BODY,
  REDACTED_DEPTH,
  REDACTED_CIRCULAR
} from '../shared/privacy/scrub'
export type { ScrubOptions, ScrubViolation, UrlPolicy } from '../shared/privacy/scrub'

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
  setTopLevelKey,
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

// Session name generator — friendly random adjective-animal names for MCP instances
export { generateSessionName, generateUniqueSessionName } from './utils/sessionNameGenerator'

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
  BuiltinFeatureStrategyType,
  FeaturePlatform,
  FeatureStrategy,
  BasicStrategy,
  PlatformStrategy,
  CustomStrategyConfig,
  CustomStrategyEvaluator,
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

// Re-export git types
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

// ── Auth / entitlement ─────────────────────────────────────────────────────
// Shared auth types (AuthState, AUTH_IPC, CheckoutResult, PlanTier …)
export type { AuthState, CheckoutResult, PlanTier } from './services'
export { AUTH_IPC, SIGNED_OUT_STATE, hasCapability } from './services'

// AuthStore — encrypted safeStorage for session + entitlement tokens.
export { AuthStore } from './services'
export type { SecureStoragePort, AuthStoreFs, PersistedAuth } from './services'

// SessionToken — HS256 session JWT utilities.
export { isSessionExpired, NO_CAPABILITIES } from './services'

// GuardedFetch — network requests gated by an `isEligibleUrl` predicate.
export { makeGuardedFetch } from './services'
export type { GuardedFetchDeps } from './services'

// LoopbackLogin — RFC 8252 loopback OAuth flow.
export {
  loopbackLogin,
  evaluateCallback,
  generateLoopbackNonce,
  buildLoginUrl,
  LoopbackLoginCancelledError
} from './services'
export type { LoopbackLoginDeps, CallbackVerdict } from './services'

// AvatarFirewallExemption — per-session CDN host exemption in the firewall.
export { AvatarFirewallExemption, avatarHostOf } from './services'
export type { SystemHostAllowlist } from './services'

// AuthIpc — registers `auth:*` IPC channels on the main process.
export { registerAuthIpc, broadcastAuthState } from './services'

// EntitlementService — reactive capability source of truth.
export { EntitlementService, E2E_PRO_CAPABILITIES, seedEntitlementForE2E } from './services'
export type { EntitlementServiceDeps } from './services'

// EntitlementClient — fetch, verify and cache the EdDSA entitlement JWT.
export {
  fetchEntitlement,
  verifyEntitlementToken,
  importEntitlementPublicKey,
  createCheckout,
  isWithinGrace,
  needsRefresh,
  nowSeconds,
  CheckoutHttpError,
  DEFAULT_CHECKOUT_REQUEST
} from './services'
export type { EntitlementClaims, EntitlementResponse, CheckoutRequest } from './services'

// AutoRefresh — interval + focus-triggered entitlement refresh.
export {
  startEntitlementAutoRefresh,
  DEFAULT_AUTO_REFRESH_INTERVAL_MS,
  DEFAULT_AUTO_REFRESH_MIN_GAP_MS
} from './services'
export type { AutoRefreshOptions } from './services'

// EntitlementTestKit — test-only helpers for signing EdDSA tokens.
export { generateEdKeyPair, signEntitlement, signSession, ENTITLEMENT_AUD, SESSION_AUD } from './services'
export type { EdKeyPair, FixtureEntitlementOpts } from './services'
