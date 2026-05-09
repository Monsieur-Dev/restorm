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
  | LegacyTab

/** Stable singleton id for the Console workbench tab.
 * `View → Console` and the focus-or-create logic both key off this. */
export const CONSOLE_TAB_ID = 'console:singleton'

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
