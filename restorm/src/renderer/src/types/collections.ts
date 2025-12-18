/**
 * Request collections types for Restorm
 * Defines the structure for organizing HTTP requests in folders with environments
 */

// ============================================================================
// Base Types
// ============================================================================

/**
 * Type of icon (emoji character, codicon name, library icons, or no icon).
 * Duplicated from electron-core-ui to avoid direct type dependency.
 */
export type IconType = 'emoji' | 'codicon' | 'iconoir' | 'phosphor' | 'material' | 'simpleicons' | 'feather' | 'fontawesome' | 'none'

/**
 * Represents an icon that can be an emoji, codicon, or an icon from supported libraries.
 */
export interface Icon {
  /** The type of icon */
  type: IconType
  /** The icon value - emoji character for 'emoji', icon name for library icons, empty for 'none' */
  value: string
}

/** Key-value pair used for headers, params, environment variables, etc. */
export interface KeyValue {
  key: string
  value: string
  /** Optional description, when provided by Swagger or user input */
  description?: string | undefined
}

// ============================================================================
// Environment Types
// ============================================================================

/** Environment configuration with variables and optional sub-environments */
export interface Environment {
  /** Unique identifier for the environment */
  id: string
  /** Display name of the environment */
  name: string
  /** Optional icon for the environment */
  icon?: Icon
  /** Key-value pairs for this environment */
  variables: KeyValue[]
  /** Optional nested sub-environments */
  subEnvironments?: Environment[]
}

/** Folder configuration (currently empty, environments moved to EnvironmentFolder) */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface FolderConfiguration {
  // Reserved for future folder-specific settings
}

// ============================================================================
// HTTP Request Body Types (Discriminated Union)
// ============================================================================

/** Text body content */
export interface HTTPRequestBodyText {
  type: 'text'
  content: string
}

/** File body content */
export interface HTTPRequestBodyFile {
  type: 'file'
  path: string
}

/** Form-data body content (multipart/form-data) */
export interface HTTPRequestBodyFormData {
  type: 'form-data'
  fields: KeyValue[]
}

/** URL-encoded body content (application/x-www-form-urlencoded) */
export interface HTTPRequestBodyXWwwFormUrlEncoded {
  type: 'x-www-form-urlencoded'
  fields: KeyValue[]
}

/** Union of all HTTP request body types */
export type HTTPRequestBody =
  | HTTPRequestBodyText
  | HTTPRequestBodyFile
  | HTTPRequestBodyFormData
  | HTTPRequestBodyXWwwFormUrlEncoded

// ============================================================================
// HTTP Methods
// ============================================================================

export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

// ============================================================================
// Request Types (Discriminated Union)
// ============================================================================

/** Base request interface with common properties */
interface BaseRequest {
  /** Unique identifier for the request */
  id: string
  /** Display name of the request */
  name: string
  /** Optional icon for the request */
  icon?: Icon
  /** Documentation describing the request purpose and usage */
  documentation: string
  /** Optional user notes for the request */
  notes?: string
  /** Tags for categorization and filtering */
  tags: string[]
}

/** HTTP request definition */
export interface HTTPRequest extends BaseRequest {
  type: 'http'
  /** HTTP method (GET, POST, PUT, etc.) */
  method: HTTPMethod
  /** Request URL (may contain environment variable placeholders) */
  url: string
  /** HTTP headers */
  headers: KeyValue[]
  /** URL query parameters (e.g. ?page=1) */
  params: KeyValue[]
  /** URL path parameters (e.g. /users/{id}) */
  pathParams?: KeyValue[]
  /** Optional request body */
  body?: HTTPRequestBody
  /** Whether this endpoint is deprecated */
  deprecated?: boolean
}

// Future request types can be added here:
// export interface GraphQLRequest extends BaseRequest { type: 'graphql'; ... }
// export interface WebSocketRequest extends BaseRequest { type: 'websocket'; ... }

/** Union of all request types */
export type Request = HTTPRequest // | GraphQLRequest | WebSocketRequest

// ============================================================================
// Folder Type
// ============================================================================

/** Environment folder containing environments configuration */
export interface EnvironmentFolder extends Folder {
  /** Discriminator to identify environment folders */
  folderType: 'environment'
  /** Environment configurations for this folder */
  environments: Environment[]
}

/** Folder item can be either a nested folder, an environment folder, or a request */
export type FolderItem = Folder | EnvironmentFolder | Request

/** Folder containing requests and sub-folders with configuration */
export interface Folder {
  /** Unique identifier for the folder */
  id: string
  /** Display name of the folder */
  name: string
  /** Optional icon for the folder */
  icon?: Icon
  /** Documentation describing the folder contents */
  documentation: string
  /** Optional user notes for the folder */
  notes?: string
  /** Tags for categorization and filtering */
  tags: string[]
  /** Folder configuration including environments */
  configuration: FolderConfiguration
  /** Folder contents: requests and sub-folders */
  items: FolderItem[]
}

// ============================================================================
// Type Guards
// ============================================================================

/** Check if an item is an EnvironmentFolder */
export function isEnvironmentFolder(item: FolderItem): item is EnvironmentFolder {
  if (!('items' in item) || !('configuration' in item) || !('folderType' in item)) {
    return false
  }
  return (item as { folderType: string }).folderType === 'environment'
}

/** Check if an item is a Folder (but not an EnvironmentFolder) */
export function isFolder(item: FolderItem): item is Folder {
  return 'items' in item && 'configuration' in item && !isEnvironmentFolder(item)
}

/** Check if an item is any kind of folder (Folder or EnvironmentFolder) */
export function isAnyFolder(item: FolderItem): item is Folder | EnvironmentFolder {
  return 'items' in item && 'configuration' in item
}

/** Check if an item is a Request */
export function isRequest(item: FolderItem): item is Request {
  return 'type' in item && !('items' in item)
}

/** Check if a request is an HTTPRequest (useful when more request types are added) */
export function isHTTPRequest(request: Request): request is HTTPRequest {
  // Currently Request is a single-variant union (only HTTPRequest),
  // so every Request is an HTTPRequest. This helper exists for
  // future extensibility when new request kinds are added.
  void request
  return true
}

/** Check if a body is text */
export function isBodyText(body: HTTPRequestBody): body is HTTPRequestBodyText {
  return body.type === 'text'
}

/** Check if a body is file */
export function isBodyFile(body: HTTPRequestBody): body is HTTPRequestBodyFile {
  return body.type === 'file'
}

/** Check if a body is form-data */
export function isBodyFormData(body: HTTPRequestBody): body is HTTPRequestBodyFormData {
  return body.type === 'form-data'
}

/** Check if a body is x-www-form-urlencoded */
export function isBodyUrlEncoded(body: HTTPRequestBody): body is HTTPRequestBodyXWwwFormUrlEncoded {
  return body.type === 'x-www-form-urlencoded'
}

// ============================================================================
// Response Types
// ============================================================================

/** Timing information for HTTP requests */
export interface HTTPTimings {
  /** When the request was initiated (ISO 8601) */
  startedAt: string
  /** Total duration in milliseconds */
  durationMs: number
  /** DNS lookup time in ms (if available) */
  dnsLookupMs?: number
  /** TCP connection time in ms (if available) */
  tcpConnectionMs?: number
  /** TLS handshake time in ms (if available) */
  tlsHandshakeMs?: number
  /** Time to first byte in ms (if available) */
  ttfbMs?: number
  /** Content download time in ms (if available) */
  downloadMs?: number
}

/** Network information for the request */
export interface HTTPNetworkInfo {
  /** Remote server IP address and port */
  remoteAddress?: string
  /** Local IP address and port */
  localAddress?: string
  /** HTTP protocol version (e.g., "HTTP/1.1", "HTTP/2") */
  protocol?: string
}

/** Base response interface for all request types */
interface BaseResponse {
  /** Unique identifier for the response */
  id: string
  /** ID of the request that generated this response */
  requestId: string
  /** Error message if the request failed */
  error?: string
}

/** Complete HTTP response with all details */
export interface HTTPResponse extends BaseResponse {
  type: 'http'

  // === Request details (what was sent) ===
  /** The final resolved URL that was called */
  requestUrl: string
  /** HTTP method used */
  requestMethod: HTTPMethod
  /** Headers sent with the request */
  requestHeaders: KeyValue[]
  /** Query parameters sent */
  requestParams: KeyValue[]
  /** Path parameters used */
  requestPathParams?: KeyValue[]
  /** Body sent (if any) */
  requestBody?: HTTPRequestBody

  // === Response details ===
  /** HTTP status code */
  statusCode: number
  /** HTTP status text (e.g., "OK", "Not Found") */
  statusText: string
  /** Response headers received */
  responseHeaders: KeyValue[]
  /** Response body as string */
  responseBody: string
  /** Content-Type of the response */
  contentType?: string
  /** Size of the response body in bytes */
  contentLength?: number

  // === Timing and network ===
  /** Timing information */
  timings: HTTPTimings
  /** Network information */
  network?: HTTPNetworkInfo

  // === Security ===
  /** Referrer policy used */
  referrerPolicy?: string
}

/** Union of all response types */
export type Response = HTTPResponse // | GraphQLResponse | WebSocketResponse
