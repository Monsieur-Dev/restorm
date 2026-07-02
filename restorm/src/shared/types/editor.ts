import type { EditorTab } from 'electron-core-ui/renderer'
import type { Icon } from 'electron-core-ui/types'
import type {
  Folder,
  EnvironmentFolder,
  HTTPRequest,
  GraphQLRequest,
  GrpcRequest,
  SoapRequest,
  WebSocketRequest,
  SseRequest,
  ODataRequest,
  AuthenticationRequest,
  JsonRpcRequest,
  JsonRpcBatchRequest,
  TrpcRequest,
  AmqpRequest,
  Environment,
  Scenario
} from './collections'

/** Breadcrumb item for navigation */
export interface BreadcrumbItem {
  id: string
  label: string
  icon?: Icon | null
}

/** Base extended EditorTab type for restorm */
interface BaseRestormTab extends EditorTab {
  /** String representation of the title for serialization purposes */
  titleString?: string
  /** Breadcrumb path for navigation */
  breadcrumbs?: BreadcrumbItem[]
}

/** Tab displaying a folder's configuration */
export interface FolderTab extends BaseRestormTab {
  tabType: 'folder'
  /** The folder data to display */
  folder: Folder
}

/** Tab displaying an environment folder's configuration */
export interface EnvironmentFolderTab extends BaseRestormTab {
  tabType: 'environment-folder'
  /** The environment folder data to display */
  folder: EnvironmentFolder
}

/** Tab displaying an HTTP request */
export interface HTTPRequestTab extends BaseRestormTab {
  tabType: 'http-request'
  /** The HTTP request data to display */
  request: HTTPRequest
  /** Environments available for this request (from nearest ancestor folder) */
  environments?: Environment[] | undefined
}

/** Tab displaying a GraphQL request */
export interface GraphQLRequestTab extends BaseRestormTab {
  tabType: 'graphql-request'
  /** The GraphQL request data to display */
  request: GraphQLRequest
  /** Environments available for this request */
  environments?: Environment[] | undefined
}

/** Tab displaying a gRPC request */
export interface GrpcRequestTab extends BaseRestormTab {
  tabType: 'grpc-request'
  /** The gRPC request data to display */
  request: GrpcRequest
  /** Environments available for this request */
  environments?: Environment[] | undefined
}

/** Tab displaying a SOAP request */
export interface SoapRequestTab extends BaseRestormTab {
  tabType: 'soap-request'
  /** The SOAP request data to display */
  request: SoapRequest
  /** Environments available for this request */
  environments?: Environment[] | undefined
}

/** Tab displaying a WebSocket request */
export interface WebSocketRequestTab extends BaseRestormTab {
  tabType: 'websocket-request'
  /** The WebSocket request data to display */
  request: WebSocketRequest
  /** Environments available for this request */
  environments?: Environment[] | undefined
}

/** Tab displaying an SSE (Server-Sent Events) request */
export interface SseRequestTab extends BaseRestormTab {
  tabType: 'sse-request'
  /** The SSE request data to display */
  request: SseRequest
  /** Environments available for this request */
  environments?: Environment[] | undefined
}

/** Tab displaying an OData request */
export interface ODataRequestTab extends BaseRestormTab {
  tabType: 'odata-request'
  /** The OData request data to display */
  request: ODataRequest
  /** Environments available for this request */
  environments?: Environment[] | undefined
}

/** Tab displaying a single JSON-RPC 2.0 call */
export interface JsonRpcRequestTab extends BaseRestormTab {
  tabType: 'jsonrpc-request'
  /** The JSON-RPC request data to display */
  request: JsonRpcRequest
  /** Environments available for this request */
  environments?: Environment[] | undefined
}

/** Tab displaying a `jsonrpc-batch` request */
export interface JsonRpcBatchRequestTab extends BaseRestormTab {
  tabType: 'jsonrpc-batch-request'
  /** The JSON-RPC batch request data to display */
  request: JsonRpcBatchRequest
  /** Environments available for this request */
  environments?: Environment[] | undefined
}

/** Tab displaying a tRPC request */
export interface TrpcRequestTab extends BaseRestormTab {
  tabType: 'trpc-request'
  /** The tRPC request data to display */
  request: TrpcRequest
  /** Environments available for this request */
  environments?: Environment[] | undefined
}

/** Tab displaying an Authentication request (HTTP + auth config tab) */
export interface AuthenticationRequestTab extends BaseRestormTab {
  tabType: 'auth-request'
  /** The authentication request data to display */
  request: AuthenticationRequest
  /** Environments available for this request */
  environments?: Environment[] | undefined
}

/** Tab displaying an AMQP request */
export interface AmqpRequestTab extends BaseRestormTab {
  tabType: 'amqp-request'
  /** The AMQP request data to display */
  request: AmqpRequest
  /** Environments available for this request */
  environments?: Environment[] | undefined
}

/** Tab hosting the scenario (dataflow graph) editor. */
export interface ScenarioEditorTab extends BaseRestormTab {
  tabType: 'scenario-editor'
  /** The scenario being edited. */
  scenario: Scenario
}

/** Tab displaying the firewall + outgoing-request console.
 * Singleton — there is at most one open at any time, identified
 * by the constant `tabId` `console:singleton`. The tab content
 * is mounted by `RestormWorkbench`'s `renderTabContent` branch
 * to a `<ConsolePanel />`; closing the tab disposes the xterm
 * instance and unsubscribes from the firewall feed. */
export interface ConsoleTab extends BaseRestormTab {
  tabType: 'console'
}

/** Tab displaying the firewall admin UI (mode picker + allowlist
 * editor + audit log). Singleton, identified by `tabId`
 * `firewall:singleton`. Mounted by `RestormWorkbench`'s
 * `renderTabContent` branch to a `<FirewallPanel />`. */
export interface FirewallTab extends BaseRestormTab {
  tabType: 'firewall'
}

/** Tab displaying the Mini browser (address bar + back + refresh +
 * iframe). Singleton — `View → Mini browser` focuses the existing
 * tab if one is open. The currently-navigated `url` is persisted
 * on the tab itself so reopening the workbench restores it. */
export interface MiniBrowserTab extends BaseRestormTab {
  tabType: 'mini-browser'
  /** URL currently loaded into the iframe. Optional so a freshly
   * opened tab can sit on a blank "type an address" state until
   * the user enters something. */
  url?: string
}

/** Tab displaying the application settings (User / Workspace
 * sections — the same content as the full-screen Settings modal).
 * Singleton, identified by `tabId` `settings:singleton`. Mounted by
 * `RestormWorkbench`'s `renderTabContent` branch to the shared
 * `<SettingsPage />`. Opened when a workbench is already active; when
 * no file is open the Settings modal is shown instead. */
export interface SettingsTab extends BaseRestormTab {
  tabType: 'settings'
}

/** Tab displaying the MCP call-logs viewer (the calls the embedded MCP
 * server has executed locally — tool / timestamp / payload, plus inline
 * captures). Singleton, identified by `tabId` `mcp-logs:singleton`. Mounted
 * by `RestormWorkbench`'s `renderTabContent` branch to the shared ECUI
 * `<McpLogsPanel />`. Opened from the status-bar `mcp` tooltip link and the
 * `View → MCP logs` menu item; same tab-or-modal pattern as Settings. */
export interface McpLogsTab extends BaseRestormTab {
  tabType: 'mcp-logs'
}

/** Legacy tab type for backward compatibility */
export interface LegacyTab extends BaseRestormTab {
  tabType?: undefined
  content?: string
}

/** Union of all restorm tab types */
export type RestormEditorTab =
  | FolderTab
  | EnvironmentFolderTab
  | HTTPRequestTab
  | GraphQLRequestTab
  | GrpcRequestTab
  | SoapRequestTab
  | WebSocketRequestTab
  | SseRequestTab
  | ODataRequestTab
  | JsonRpcRequestTab
  | JsonRpcBatchRequestTab
  | AuthenticationRequestTab
  | TrpcRequestTab
  | AmqpRequestTab
  | ScenarioEditorTab
  | ConsoleTab
  | FirewallTab
  | MiniBrowserTab
  | SettingsTab
  | McpLogsTab
  | LegacyTab

/** Stable singleton id for the Console workbench tab.
 * `View → Console` and the focus-or-create logic both key off this. */
export const CONSOLE_TAB_ID = 'console:singleton'

/** Stable singleton id for the Firewall admin workbench tab.
 * `View → Firewall` and the focus-or-create logic both key off this. */
export const FIREWALL_TAB_ID = 'firewall:singleton'

/** Stable singleton id for the Mini browser workbench tab.
 * `View → Mini browser` and the focus-or-create logic both key off this. */
export const MINI_BROWSER_TAB_ID = 'mini-browser:singleton'

/** Stable singleton id for the Settings workbench tab. The gear
 * button + `View → Settings` open-or-focus this tab when a workbench
 * is active (and the modal otherwise). */
export const SETTINGS_TAB_ID = 'settings:singleton'

/** Stable singleton id for the MCP call-logs workbench tab. The status-bar
 * `mcp` tooltip link + `View → MCP logs` open-or-focus this tab when a
 * workbench is active (and a full-screen modal otherwise). Deriving the nav
 * key from this stable id keeps the tab in the Ctrl+Tab MRU ordering. */
export const MCP_LOGS_TAB_ID = 'mcp-logs:singleton'

/** @deprecated Use RestormEditorTab instead */
export type restormEditorTab = RestormEditorTab

/** Type guard for FolderTab */
export function isFolderTab(tab: RestormEditorTab): tab is FolderTab {
  return tab.tabType === 'folder'
}

/** Type guard for EnvironmentFolderTab */
export function isEnvironmentFolderTab(tab: RestormEditorTab): tab is EnvironmentFolderTab {
  return tab.tabType === 'environment-folder'
}

/** Type guard for HTTPRequestTab */
export function isHTTPRequestTab(tab: RestormEditorTab): tab is HTTPRequestTab {
  return tab.tabType === 'http-request'
}

/** Type guard for ScenarioEditorTab */
export function isScenarioEditorTab(tab: RestormEditorTab): tab is ScenarioEditorTab {
  return tab.tabType === 'scenario-editor'
}

/** Type guard for GraphQLRequestTab */
export function isGraphQLRequestTab(tab: RestormEditorTab): tab is GraphQLRequestTab {
  return tab.tabType === 'graphql-request'
}

/** Type guard for GrpcRequestTab */
export function isGrpcRequestTab(tab: RestormEditorTab): tab is GrpcRequestTab {
  return tab.tabType === 'grpc-request'
}

/** Type guard for SoapRequestTab */
export function isSoapRequestTab(tab: RestormEditorTab): tab is SoapRequestTab {
  return tab.tabType === 'soap-request'
}

/** Type guard for WebSocketRequestTab */
export function isWebSocketRequestTab(tab: RestormEditorTab): tab is WebSocketRequestTab {
  return tab.tabType === 'websocket-request'
}

/** Type guard for SseRequestTab */
export function isSseRequestTab(tab: RestormEditorTab): tab is SseRequestTab {
  return tab.tabType === 'sse-request'
}

/** Type guard for ODataRequestTab */
export function isODataRequestTab(tab: RestormEditorTab): tab is ODataRequestTab {
  return tab.tabType === 'odata-request'
}

/** Type guard for JsonRpcRequestTab */
export function isJsonRpcRequestTab(tab: RestormEditorTab): tab is JsonRpcRequestTab {
  return tab.tabType === 'jsonrpc-request'
}

/** Type guard for JsonRpcBatchRequestTab */
export function isJsonRpcBatchRequestTab(tab: RestormEditorTab): tab is JsonRpcBatchRequestTab {
  return tab.tabType === 'jsonrpc-batch-request'
}

/** Type guard for AuthenticationRequestTab */
export function isAuthenticationRequestTab(tab: RestormEditorTab): tab is AuthenticationRequestTab {
  return tab.tabType === 'auth-request'
}

/** Type guard for TrpcRequestTab */
export function isTrpcRequestTab(tab: RestormEditorTab): tab is TrpcRequestTab {
  return tab.tabType === 'trpc-request'
}

/** Type guard for AmqpRequestTab */
export function isAmqpRequestTab(tab: RestormEditorTab): tab is AmqpRequestTab {
  return tab.tabType === 'amqp-request'
}

/** Any protocol's request tab (carries a backing `request`). */
export type AnyRequestTab =
  | HTTPRequestTab
  | GraphQLRequestTab
  | GrpcRequestTab
  | SoapRequestTab
  | WebSocketRequestTab
  | SseRequestTab
  | ODataRequestTab
  | JsonRpcRequestTab
  | JsonRpcBatchRequestTab
  | AuthenticationRequestTab
  | TrpcRequestTab
  | AmqpRequestTab

const REQUEST_TAB_TYPES: ReadonlySet<string> = new Set([
  'http-request', 'graphql-request', 'grpc-request', 'soap-request',
  'websocket-request', 'sse-request', 'odata-request', 'jsonrpc-request', 'jsonrpc-batch-request', 'auth-request', 'trpc-request', 'amqp-request'
])

/** Type guard for ANY request tab (any protocol). Use this instead of a
 * `tabType.includes('request')` substring sniff — it matches the exact
 * request-tab discriminants and narrows to the union that carries
 * `request`. */
export function isAnyRequestTab(tab: RestormEditorTab): tab is AnyRequestTab {
  return tab.tabType !== undefined && REQUEST_TAB_TYPES.has(tab.tabType)
}

/** Type guard for ConsoleTab */
export function isConsoleTab(tab: RestormEditorTab): tab is ConsoleTab {
  return tab.tabType === 'console'
}

/** Type guard for FirewallTab */
export function isFirewallTab(tab: RestormEditorTab): tab is FirewallTab {
  return tab.tabType === 'firewall'
}

/** Type guard for MiniBrowserTab */
export function isMiniBrowserTab(tab: RestormEditorTab): tab is MiniBrowserTab {
  return tab.tabType === 'mini-browser'
}

/** Type guard for SettingsTab */
export function isSettingsTab(tab: RestormEditorTab): tab is SettingsTab {
  return tab.tabType === 'settings'
}

export function isMcpLogsTab(tab: RestormEditorTab): tab is McpLogsTab {
  return tab.tabType === 'mcp-logs'
}
