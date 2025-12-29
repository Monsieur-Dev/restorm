/**
 * Request collections types for Restorm
 * Defines the structure for organizing HTTP requests in folders with environments
 */

import type { RuntimeId } from 'electron-core-ui/types'

// Re-export RuntimeId for consumers of this module
export type { RuntimeId }

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

export interface KeyValue {
  /** Runtime-only identifier, excluded from serialization. Generated at runtime. */
  id?: RuntimeId
  key: string
  value: string
  /** Optional description, when provided by Swagger or user input */
  description?: string | undefined
  /** Whether this key-value is enabled (default: true) */
  enabled?: boolean
}

// ============================================================================
// Environment Types
// ============================================================================

/** Environment configuration with variables and optional sub-environments */
export interface Environment {
  /** Runtime identifier for the environment (generated at runtime, not persisted) */
  id: RuntimeId
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
export type FolderConfiguration = Record<string, never>

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
  /** Runtime identifier for the request (generated at runtime, not persisted) */
  id: RuntimeId
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

// ============================================================================
// GraphQL Request Types
// ============================================================================

/** GraphQL operation type */
export type GraphQLOperationType = 'query' | 'mutation' | 'subscription'

/** GraphQL request definition */
export interface GraphQLRequest extends BaseRequest {
  type: 'graphql'
  /** GraphQL endpoint URL */
  url: string
  /** GraphQL operation type */
  operationType: GraphQLOperationType
  /** GraphQL query/mutation/subscription string */
  query: string
  /** GraphQL variables as JSON string */
  variables?: string
  /** HTTP headers */
  headers: KeyValue[]
}

// ============================================================================
// gRPC Request Types
// ============================================================================

/** gRPC call type */
export type GrpcCallType = 'unary' | 'server-stream' | 'client-stream' | 'bidirectional-stream'

/** gRPC request definition */
export interface GrpcRequest extends BaseRequest {
  type: 'grpc'
  /** gRPC server URL (host:port) */
  url: string
  /** Service name (e.g., "grpcbin.HelloService") */
  service: string
  /** Method name (e.g., "SayHello") */
  method: string
  /** gRPC call type */
  callType: GrpcCallType
  /** Request message as JSON string */
  requestMessage: string
  /** Metadata (headers) */
  metadata: KeyValue[]
}

// ============================================================================
// SOAP Request Types
// ============================================================================

/** SOAP request definition */
export interface SoapRequest extends BaseRequest {
  type: 'soap'
  /** SOAP endpoint URL */
  url: string
  /** SOAP action */
  soapAction: string
  /** Service name */
  service: string
  /** Operation name */
  operation: string
  /** SOAP envelope body as XML string */
  body: string
  /** HTTP headers */
  headers: KeyValue[]
}

// ============================================================================
// WebSocket/Socket.IO Request Types
// ============================================================================

/** WebSocket protocol type */
export type WebSocketProtocol = 'websocket' | 'socketio' | 'mqtt'

/** WebSocket/Socket.IO request definition */
export interface WebSocketRequest extends BaseRequest {
  type: 'websocket'
  /** WebSocket URL (ws:// or wss://) */
  url: string
  /** Protocol type */
  protocol: WebSocketProtocol
  /** Event/channel name (for Socket.IO/MQTT) */
  event?: string | undefined
  /** Message payload as JSON string */
  message: string
  /** Connection headers/options */
  headers: KeyValue[]
}

/** Union of all request types */
export type Request = HTTPRequest | GraphQLRequest | GrpcRequest | SoapRequest | WebSocketRequest

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
  /** Runtime identifier for the folder (generated at runtime, not persisted) */
  id: RuntimeId
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

/** Check if a request is an HTTPRequest */
export function isHTTPRequest(request: Request): request is HTTPRequest {
  return request.type === 'http'
}

/** Check if a request is a GraphQLRequest */
export function isGraphQLRequest(request: Request): request is GraphQLRequest {
  return request.type === 'graphql'
}

/** Check if a request is a GrpcRequest */
export function isGrpcRequest(request: Request): request is GrpcRequest {
  return request.type === 'grpc'
}

/** Check if a request is a SoapRequest */
export function isSoapRequest(request: Request): request is SoapRequest {
  return request.type === 'soap'
}

/** Check if a request is a WebSocketRequest */
export function isWebSocketRequest(request: Request): request is WebSocketRequest {
  return request.type === 'websocket'
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
  /** Runtime identifier for the response (generated at runtime, not persisted) */
  id: RuntimeId
  /** Runtime ID of the request that generated this response */
  requestId: RuntimeId
  /** Error message if the request failed */
  error?: string | undefined
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

// ============================================================================
// GraphQL Response Types
// ============================================================================

/** GraphQL response */
export interface GraphQLResponse extends BaseResponse {
  type: 'graphql'
  /** The final resolved URL that was called */
  requestUrl: string
  /** Query sent */
  requestQuery: string
  /** Variables sent */
  requestVariables?: string | undefined
  /** Headers sent */
  requestHeaders: KeyValue[]
  /** HTTP status code */
  statusCode: number
  /** Response data (JSON) */
  data?: unknown
  /** GraphQL errors */
  errors?: { message: string; locations?: { line: number; column: number }[]; path?: string[] }[] | undefined
  /** Response headers */
  responseHeaders: KeyValue[]
  /** Timing information */
  timings: HTTPTimings
}

// ============================================================================
// gRPC Response Types
// ============================================================================

/** gRPC response */
export interface GrpcResponse extends BaseResponse {
  type: 'grpc'
  /** Server URL */
  requestUrl: string
  /** Service/method called */
  requestMethod: string
  /** Request message sent */
  requestMessage: string
  /** Metadata sent */
  requestMetadata: KeyValue[]
  /** gRPC status code */
  statusCode: number
  /** gRPC status message */
  statusMessage: string
  /** Response message (JSON) */
  responseMessage: string
  /** Response metadata */
  responseMetadata: KeyValue[]
  /** Timing information */
  timings: HTTPTimings
}

// ============================================================================
// SOAP Response Types
// ============================================================================

/** SOAP response */
export interface SoapResponse extends BaseResponse {
  type: 'soap'
  /** Endpoint URL */
  requestUrl: string
  /** SOAP action */
  requestSoapAction: string
  /** Request body sent */
  requestBody: string
  /** Headers sent */
  requestHeaders: KeyValue[]
  /** HTTP status code */
  statusCode: number
  /** Response body (XML) */
  responseBody: string
  /** Response headers */
  responseHeaders: KeyValue[]
  /** Parsed fault if present */
  fault?: { code: string; message: string } | undefined
  /** Timing information */
  timings: HTTPTimings
}

// ============================================================================
// WebSocket Response Types
// ============================================================================

/** WebSocket message */
export interface WebSocketMessage {
  /** Message direction */
  direction: 'sent' | 'received'
  /** Event name (for Socket.IO) */
  event?: string | undefined
  /** Message data */
  data: string
  /** Timestamp */
  timestamp: string
}

/** WebSocket response */
export interface WebSocketResponse extends BaseResponse {
  type: 'websocket'
  /** WebSocket URL */
  requestUrl: string
  /** Protocol used */
  protocol: WebSocketProtocol
  /** Connection status */
  connected: boolean
  /** Messages exchanged */
  messages: WebSocketMessage[]
  /** Timing information */
  timings: HTTPTimings
}

/** Union of all response types */
export type Response = HTTPResponse | GraphQLResponse | GrpcResponse | SoapResponse | WebSocketResponse
