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
  requestType: 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket' | 'sse' | 'odata' | 'auth' | 'jsonrpc' | 'jsonrpcBatch' | 'trpc' | 'amqp' | 'redis'
  requestType: 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket' | 'stomp' | 'odata' | 'auth'
  requestType: 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket' | 'odata' | 'auth' | 'kafka'

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

  // SSE specific
  /** Seed for the `Last-Event-ID` header on the first connect. */
  lastEventId?: string
  // STOMP specific (requestType === 'stomp'). `connectHeaders` + `sendHeaders`
  // are ALSO merged into the top-level `headers` field above (so
  // `collectRequestSecrets` sees both for pre-hydration) — these two carry the
  // same rows split by which frame they belong to.
  stompVersion?: '1.1' | '1.2'
  connectHeaders?: KeyValue[]
  subscriptions?: { id?: string; destination?: string; ackMode?: string }[]
  sendDestination?: string
  sendBody?: string
  sendHeaders?: KeyValue[]

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

  // AMQP specific (requestType === 'amqp'; `username`/`password` above are
  // shared with MQTT — only one protocol branch ever populates them on a
  // given instance).
  /** Virtual host (defaults to `/` when empty). */
  vhost?: string
  /** Which of the three interactions this request performs. */
  mode?: 'publish' | 'subscribe' | 'browse'
  /** PUBLISH: destination exchange (empty string = the default exchange). */
  exchange?: string
  /** PUBLISH: routing key. */
  routingKey?: string
  /** PUBLISH: message payload. */
  payload?: string
  /** SUBSCRIBE / BROWSE: source queue name. */
  queue?: string
  /** SUBSCRIBE: ack received messages automatically (default true). */
  autoAck?: boolean
  /** SUBSCRIBE: `channel.prefetch` — max unacked messages in flight. */
  prefetch?: number
  /** BROWSE: max messages to peek without acking (default 50). */
  browsePeekCount?: number

  // Redis specific. `password` (above, shared with MQTT) doubles as the Redis
  // auth password. `redisMode` is prefixed (unlike the other bare names below)
  // because `mode` is generic enough that a future protocol could plausibly
  // want the bare name too.
  redisMode?: 'subscribe' | 'command'
  channels?: string[]
  command?: string
  args?: string[]
  freeformCommand?: string
  // Kafka specific (requestType === 'kafka'). `url` (common field above) carries
  // the comma-separated broker list. Prefixed to avoid colliding with the
  // generic `clientId` / near-generic fields other protocols already claim.
  kafkaMode?: 'produce' | 'consume' | 'browse'
  kafkaTopic?: string
  kafkaKey?: string
  kafkaValue?: string
  kafkaPartition?: number
  kafkaGroupId?: string
  kafkaFromOffset?: 'earliest' | 'latest' | 'specific'
  kafkaSpecificOffset?: string
  kafkaPartitions?: number[]
  kafkaBrowsePeekCount?: number
  kafkaClientId?: string
  kafkaSaslMechanism?: 'none' | 'plain' | 'scram-sha-256' | 'scram-sha-512'
  kafkaSaslUsername?: string
  kafkaSaslPassword?: string
  kafkaTlsEnabled?: boolean
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
}

/**
 * The DISPOSABLE contexts one execution of one request resolves against.
 *
 * A scenario run never writes into the stored `RequestContext` above. Instead
 * the engine composes this object just before it dispatches a request
 * (`ContextService.composeResolutionContexts`), hands it to the execution
 * service, and drops it when the dispatch returns. Nothing here is stored, so
 * nothing here can outlive the request that used it — which is the whole
 * property: a value a run supplies cannot still be in effect afterwards,
 * because there is nowhere for it to be.
 *
 * Compose it PER REQUEST EXECUTION, never once per run: a variable declared
 * between two requests must be visible to the second and not to the first.
 *
 * The row families are SEPARATE OBJECTS, not one context shared by reference.
 * Path params, query params, headers and body fields each resolve from their
 * own object and are blind to one another — a row one family resolves can never
 * be observed by another. The four hold equal values today, so the separation
 * buys nothing yet by itself; it is what makes that blindness structural rather
 * than a convention that holds until the first per-family rule writes into one
 * of them.
 */
export interface ResolutionContexts {
  /**
   * The run's own values, flat (name → already-resolved string). Carried so a
   * NESTED resolution can compose its own contexts against the same run — an
   * authentication request dispatched for this one resolves against ITS
   * request's rows, not this one's, but under the same run values.
   */
  runOverlay?: TransformedContext
  /**
   * env + run. What a value belonging to no row family resolves against: a
   * `text` / `file` body, a message payload, a topic, a routing key, a
   * non-HTTP url.
   */
  base: TransformedContext
  /** env + run. Seed for the URL template's cumulative path-param resolution. */
  pathParams: TransformedContext
  /** env + run. Seed for the cumulative query-string resolution. */
  queryParams: TransformedContext
  /** env + run. What a header row resolves against. */
  headers: TransformedContext
  /**
   * env + run. What a body FIELD resolves against — `form-data` and
   * `x-www-form-urlencoded` only, the two body types that carry rows.
   *
   * ABSENT means "this body has no fields at all" (`text`, `file`, or no body);
   * present-and-empty means "a field-bearing body that declares zero fields".
   * The two must not collapse: the first says the family does not apply, the
   * second says it applies and is empty, and a reader that treats one as the
   * other will resolve a body field against a context that was never built for
   * it.
   */
  bodyFields?: TransformedContext
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
