/**
 * ContextServiceTypes - Shared types for ContextService, URLResolver and CodeSnippetGenerator
 *
 * Extracted from ContextService to avoid circular imports between extracted modules.
 */

import type { ValueType } from '../../shared/types/collections'

/** KeyValue structure from environment */
export interface KeyValue {
  id?: string | undefined
  key: string
  value: ValueType
  description?: string | undefined
  /** Whether this key-value is enabled (default: true) */
  enabled?: boolean | undefined
}

/** Environment structure */
export interface Environment {
  id?: string
  name: string
  variables: KeyValue[]
  subEnvironments?: Environment[]
}

/** Stored environment metadata */
export interface EnvironmentMeta {
  /** Parent environment ID (null for root environments) */
  parentEnvironmentId: string | null
  /** Child environment IDs */
  childIds: Set<string>
  /** Raw variables from the environment */
  rawVariables: KeyValue[]
}

/** Transformed context type */
export type TransformedContext = Record<string, string>

/** Result of a variable transformation */
export interface VariableTransformResult {
  /** Copy of the context used for transformation */
  contextUsed: TransformedContext
  /** The transformed value */
  transformedValue: string
  /** Original raw value before transformation */
  rawValue: string
  /** The key name */
  key: string
}

/** HTTP request body types */
export type HTTPRequestBody =
  | { type: 'text'; content: string }
  | { type: 'file'; path: string }
  | { type: 'form-data'; fields: KeyValue[] }
  | { type: 'x-www-form-urlencoded'; fields: KeyValue[] }

/** Full request data for URL resolution and code snippet generation */
export interface FullRequestData {
  id: string
  requestType: 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket' | 'odata'

  // Common fields
  url: string
  headers: KeyValue[]

  // HTTP specific
  method?: string
  params?: KeyValue[]
  pathParams?: KeyValue[]
  body?: HTTPRequestBody

  // GraphQL specific
  operationType?: string
  query?: string
  variables?: string

  // gRPC specific
  service?: string
  grpcMethod?: string
  callType?: string
  requestMessage?: string
  metadata?: KeyValue[]

  // SOAP specific
  soapAction?: string
  soapService?: string
  operation?: string
  soapBody?: string

  // WebSocket specific
  protocol?: string
  event?: string
  message?: string

  // OData specific — carried verbatim through URLResolver, which
  // appends the system query options ($filter / $select / $top /
  // $skip / $count) to the resolved URL as a final step.
  odataVersion?: 'v2' | 'v3' | 'v4'
  odataOperationKind?: 'entity-set' | 'function' | 'action' | 'batch'
  odataQueryOptions?: {
    filter?: string
    select?: string[]
    top?: string
    skip?: string
    count?: boolean
    expand?: string
    orderby?: string
    search?: string
    format?: string
    apply?: string
  }
}

/** Request context tracking with full data */
export interface RequestContext {
  /** Selected environment ID (null if no environment) */
  environmentId: string | null
  /** Request KeyValues to transform (headers, params, pathParams, etc.) */
  keyValueGroups: Map<string, KeyValue[]>
  /** Full request data for URL and code snippet generation */
  fullData: FullRequestData | null
}

/** Resolved URL result */
export interface ResolvedUrlResult {
  /** The final resolved URL */
  resolvedUrl: string
  /** Base URL without query string */
  baseUrl: string
  /** Query string (without leading ?) */
  queryString: string
}

/** Code snippets result */
export interface CodeSnippetsResult {
  /** Generated markdown content with code snippets */
  markdown: string
}

/** Request structure (minimal for context service - legacy) */
export interface RequestData {
  id: string
  headers?: KeyValue[]
  params?: KeyValue[]
  pathParams?: KeyValue[]
}

/** Function type for Handlebars value transformation */
export type TransformValueFn = (value: string, context: TransformedContext) => string
