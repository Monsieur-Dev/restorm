/**
 * Request collections types for Restorm
 * Defines the structure for organizing HTTP requests in folders with environments
 */

// ============================================================================
// Base Types
// ============================================================================

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
  /** Key-value pairs for this environment */
  variables: KeyValue[]
  /** Optional nested sub-environments */
  subEnvironments?: Environment[]
}

/** Folder configuration containing environments */
export interface FolderConfiguration {
  environments: Environment[]
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
  /** Documentation describing the request purpose and usage */
  documentation: string
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
  /** URL query parameters */
  params: KeyValue[]
  /** Optional request body */
  body?: HTTPRequestBody
}

// Future request types can be added here:
// export interface GraphQLRequest extends BaseRequest { type: 'graphql'; ... }
// export interface WebSocketRequest extends BaseRequest { type: 'websocket'; ... }

/** Union of all request types */
export type Request = HTTPRequest // | GraphQLRequest | WebSocketRequest

// ============================================================================
// Folder Type
// ============================================================================

/** Folder item can be either a nested folder or a request */
export type FolderItem = Folder | Request

/** Folder containing requests and sub-folders with configuration */
export interface Folder {
  /** Unique identifier for the folder */
  id: string
  /** Display name of the folder */
  name: string
  /** Documentation describing the folder contents */
  documentation: string
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

/** Check if an item is a Folder */
export function isFolder(item: FolderItem): item is Folder {
  return 'items' in item && 'configuration' in item
}

/** Check if an item is a Request */
export function isRequest(item: FolderItem): item is Request {
  return 'type' in item && !('items' in item)
}

/** Check if a request is an HTTPRequest (useful when more request types are added) */
export function isHTTPRequest(request: Request): request is HTTPRequest {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return request.type === 'http'
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

