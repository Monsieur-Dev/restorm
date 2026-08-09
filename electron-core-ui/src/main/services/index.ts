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

export { getGitService, resetGitService, GitService } from './GitService'
export type { GitServiceConfig } from './GitService'

export {
  GitSemiPullController,
  initGitSemiPullController,
  getGitSemiPullController
} from './GitSemiPullController'
export type { GitSemiPullFrequency, GitSemiPullControllerOptions } from './GitSemiPullController'

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
  PERSISTENCE_FORMATS,
  atomicWriteFile,
  codeOf
} from './PersistenceService'
export type {
  PersistenceFormat,
  PersistenceConfig,
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
  setTopLevelKey,
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
  McpToolResult,
  McpToolGate,
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

// ── Privacy / consent ──────────────────────────────────────────────────────
// ConsentService — the single main-process answer to "may we send this?", plus
// the scrubber every outbound diagnostic payload must pass through and the
// firewall exemption that follows consent on and off.
// See docs/Architecture/Privacy.md.
export { ConsentService } from './privacy/ConsentService'
export type {
  ConsentServiceOptions,
  ConsentSettingsPort,
  ConsentStorePort
} from './privacy/ConsentService'
export { makeConsentFileStore } from './privacy/consentFileStore'
export { ConsentFirewallExemption } from './privacy/ConsentFirewallExemption'
export type { ConsentGatedEndpoint } from './privacy/ConsentFirewallExemption'

// ── Auth / entitlement ─────────────────────────────────────────────────────
// Shared auth types (AuthState, AUTH_IPC, CheckoutResult, PlanTier …)
export type { AuthState, CheckoutResult, PlanTier } from '../../shared/auth/authState'
export { AUTH_IPC, SIGNED_OUT_STATE, hasCapability } from '../../shared/auth/authState'

// AuthStore — encrypted safeStorage for session + entitlement tokens.
export { AuthStore } from './auth/authStore'
export type { SecureStoragePort, AuthStoreFs, PersistedAuth } from './auth/authStore'

// SessionToken — HS256 session JWT utilities.
export { isSessionExpired, NO_CAPABILITIES } from './auth/sessionToken'

// GuardedFetch — network requests gated by an `isEligibleUrl` predicate.
export { makeGuardedFetch } from './auth/guardedFetch'
export type { GuardedFetchDeps } from './auth/guardedFetch'

// LoopbackLogin — RFC 8252 loopback OAuth flow.
export { loopbackLogin, evaluateCallback, generateLoopbackNonce, buildLoginUrl, LoopbackLoginCancelledError } from './auth/loopbackLogin'
export type { LoopbackLoginDeps, CallbackVerdict } from './auth/loopbackLogin'

// AvatarFirewallExemption — per-session CDN host exemption in the firewall.
export { AvatarFirewallExemption, avatarHostOf } from './auth/avatarFirewallExemption'
export type { SystemHostAllowlist } from './auth/avatarFirewallExemption'

// AuthIpc — registers `auth:*` IPC channels on the main process.
export { registerAuthIpc, broadcastAuthState } from './auth/authIpc'

// EntitlementService — reactive capability source of truth.
export { EntitlementService, E2E_PRO_CAPABILITIES, seedEntitlementForE2E } from './entitlement/EntitlementService'
export type { EntitlementServiceDeps } from './entitlement/EntitlementService'

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
} from './entitlement/entitlementClient'
export type { EntitlementClaims, EntitlementResponse, CheckoutRequest } from './entitlement/entitlementClient'

// AutoRefresh — interval + focus-triggered entitlement refresh.
export { startEntitlementAutoRefresh, DEFAULT_AUTO_REFRESH_INTERVAL_MS, DEFAULT_AUTO_REFRESH_MIN_GAP_MS } from './entitlement/autoRefresh'
export type { AutoRefreshOptions } from './entitlement/autoRefresh'

// EntitlementTestKit — test-only helpers for signing EdDSA tokens.
export { generateEdKeyPair, signEntitlement, signSession, ENTITLEMENT_AUD, SESSION_AUD } from './entitlement/entitlementTestKit'
export type { EdKeyPair, FixtureEntitlementOpts } from './entitlement/entitlementTestKit'
