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
  ODataRequest,
  AuthenticationRequest,
  Environment
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
  /**
   * Per-pane collapsed state for request tab views (HTTP / GraphQL /
   * gRPC / SOAP / WebSocket / OData). Keys are pane ids the matching
   * RequestTabView declares ('headers', 'pathParams', 'query',
   * 'message', …) — each value is the latest user toggle for that
   * pane. Round-tripped through `EditorTab.persistedState` so the
   * state survives both the SplitView's remount on response-panel
   * toggle AND a full file close+reopen. Undefined means "no user
   * choice yet — fall back to the per-section heuristic on mount".
   */
  panelCollapsed?: Record<string, boolean>
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

/** Tab displaying an OData request */
export interface ODataRequestTab extends BaseRestormTab {
  tabType: 'odata-request'
  /** The OData request data to display */
  request: ODataRequest
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
  | ODataRequestTab
  | AuthenticationRequestTab
  | ConsoleTab
  | FirewallTab
  | MiniBrowserTab
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

/** Type guard for ODataRequestTab */
export function isODataRequestTab(tab: RestormEditorTab): tab is ODataRequestTab {
  return tab.tabType === 'odata-request'
}

/** Type guard for AuthenticationRequestTab */
export function isAuthenticationRequestTab(tab: RestormEditorTab): tab is AuthenticationRequestTab {
  return tab.tabType === 'auth-request'
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
