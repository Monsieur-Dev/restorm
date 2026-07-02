/**
 * ContextServiceTypes - Shared types for ContextService, URLResolver and CodeSnippetGenerator
 *
 * Extracted from ContextService to avoid circular imports between extracted modules.
 */

import type { ValueType } from '../../shared/types/collections'
import type { SoapMockOperation } from '../../shared/types/requests/SoapRequest'

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
  requestType: 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket' | 'odata' | 'auth' | 'jsonrpc' | 'jsonrpcBatch' | 'trpc'

  // Common fields
  url: string
  headers: KeyValue[]

  // HTTP specific
  method?: string
  params?: KeyValue[]
  pathParams?: KeyValue[]
  body?: HTTPRequestBody
  /** HTTP mock server (server === true): the status code the mock serves
   * (defaults to 200). */
  mockStatus?: number

  // GraphQL specific
  operationType?: string
  query?: string
  variables?: string
  /** GraphQL mock server (server === true): SDL schema served. */
  schema?: string
  /** GraphQL mock server: per-field canned response values (JSON keyed by
   * `Type.field`). */
  mockResolvers?: string
  /** GraphQL mock server: optional scripted resolver body. */
  resolverScript?: string
  /** Selected operation when the query document declares more than one. */
  operationName?: string

  // gRPC specific
  service?: string
  grpcMethod?: string
  callType?: string
  /** Wire transport ('grpc' | 'grpc-web' | 'connect'); absent means native gRPC. */
  transport?: string
  requestMessage?: string
  /** The request's own proto, used to build the dynamic client (falls back to
   * the bundled grpcbin proto when absent). */
  protoContent?: string
  protoPath?: string
  /** Base64 `FileDescriptorSet` fetched via gRPC server reflection; takes
   * precedence over `protoContent`/`protoPath` (see `grpcProtoLoader.ts`). */
  protoDescriptorSet?: string
  metadata?: KeyValue[]

  // SOAP specific
  soapAction?: string
  soapService?: string
  operation?: string
  soapBody?: string
  /** SOAP mock server (server === true): the operations the hosted mock answers
   * (each canned XML response / `<soap:Fault>`, dispatched by SOAPAction or the
   * inbound body operation). */
  soapMockOperations?: SoapMockOperation[]

  // WebSocket specific
  protocol?: string
  event?: string
  message?: string
  /** Socket.IO: when true, restorm HOSTS a server instead of connecting. */
  server?: boolean

  // MQTT specific (protocol === 'mqtt'; `event` carries the topic)
  qos?: number
  retain?: boolean
  clientId?: string
  username?: string
  password?: string
  keepalive?: number
  mqttSubscribe?: boolean
  lwtTopic?: string
  lwtPayload?: string
  lwtQos?: number
  lwtRetain?: boolean

  // OData specific — carried verbatim through URLResolver, which
  // appends the system query options ($filter / $select / $top /
  // $skip / $count) to the resolved URL as a final step.
  odataVersion?: 'v2' | 'v3' | 'v4' | 'v4.01'
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
  /** OData mock service (server === true): the CSDL the mock serves verbatim. */
  mockMetadata?: string
  /** OData mock service: served entity data keyed by entity-set name. */
  mockData?: Record<string, Record<string, unknown>[]>

  // JSON-RPC specific — read by JsonRpcExecutionService to compose the
  // `{ jsonrpc: '2.0', method, params, id }` envelope. `jsonRpcParams` is
  // raw JSON source (array or object), resolved through ContextService
  // before being parsed.
  jsonRpcMethod?: string
  jsonRpcParams?: string
  jsonRpcId?: string
  jsonRpcNotificationMode?: boolean
  /** JSON-RPC batch specific: child calls composed into the batch array. */
  jsonRpcChildren?: {
    childId: string
    method: string
    params: string
    rpcId: string
    notificationMode?: boolean
  }[]

  // tRPC specific — `url` carries the BASE server url; URLResolver appends
  // `/<trpcProcedure>` (and, for a query, `?input=<encoded>`) as a final step,
  // mirroring the OData system-query-option append above.
  trpcProcedure?: string
  trpcInput?: string
  trpcKind?: 'query' | 'mutation'
}

/** Request context tracking with full data */
export interface RequestContext {
  /** Selected environment ID (null if no environment) */
  environmentId: string | null
  /**
   * Environment IDs that are visible to this request through its
   * env-folder ancestor chain. Used by the auth-resolver so it can
   * inherit the calling request's env when that env is also valid
   * for the auth route. Empty when the request hasn't been told yet.
   */
  availableEnvironmentIds: string[]
  /** Request KeyValues to transform (headers, params, pathParams, etc.) */
  keyValueGroups: Map<string, KeyValue[]>
  /** Full request data for URL and code snippet generation */
  fullData: FullRequestData | null
  /**
   * Per-run variable OVERLAY set by a scenario `setVariable` node before this
   * request runs. Merged ON TOP of the environment context (overlay WINS) for
   * every resolution of this request — so a scenario can override an env-folder
   * variable for the request's URL / headers / params / body. Undefined outside
   * a scenario run (or when no setVariable applies). Name → already-resolved
   * string, exactly like the transformed env context.
   */
  scenarioVariables?: TransformedContext
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
