export type ResponseHistoryRequestType = 'http' | 'odata' | 'graphql' | 'grpc' | 'soap' | 'websocket' | 'sse' | 'jsonrpc' | 'jsonrpcBatch' | 'trpc' | 'amqp' | 'redis'
export type ResponseHistoryRequestType = 'http' | 'odata' | 'graphql' | 'grpc' | 'soap' | 'websocket' | 'stomp'

/**
 * 3-way visual signal for the per-entry status dot in the history
 * list — green for `ok`, orange for `warning` (3xx redirect that the
 * client surfaces as the final response), red for `failure` (any
 * non-2xx response, network error, or protocol-specific error). gRPC
 * and WebSocket have no native warning state and only emit `ok` /
 * `failure`.
 */
export type ResponseHistoryOutcome = 'ok' | 'warning' | 'failure'

export interface ResponseHistoryEntry {
  guid: string
  timestamp: string
  pinned: boolean
  /**
   * Boolean form retained for storage backward-compat — older history
   * archives carry only this field. New entries also set `outcome`
   * which the renderer prefers when present.
   */
  success: boolean
  outcome?: ResponseHistoryOutcome
}

export interface ResponseHistoryIndex {
  version: 2
  requests: {
    requestId: string
    entries: ResponseHistoryEntry[]
  }[]
}

export interface ResponseHistoryKeyValue {
  key: string
  value: string
  enabled?: boolean
}

export interface ResponseHistoryRequestMeta {
  service?: string
  operation?: string
  soapAction?: string
  method?: string
  callType?: string
  protocol?: string
  event?: string
}

export interface ResponseHistoryHttpBody {
  type: 'text' | 'file' | 'form-data' | 'x-www-form-urlencoded'
  content?: string
  fields?: ResponseHistoryKeyValue[]
  path?: string
}

export interface ResponseHistoryHttpResponse {
  type: 'http'
  requestUrl: string
  requestMethod: string
  requestHeaders: ResponseHistoryKeyValue[]
  requestParams: ResponseHistoryKeyValue[]
  requestPathParams: ResponseHistoryKeyValue[]
  requestBody?: ResponseHistoryHttpBody
  statusCode: number
  statusText: string
  responseHeaders: ResponseHistoryKeyValue[]
  responseBody: string
  contentType?: string
  contentLength?: number
  timings: {
    startedAt: string
    durationMs: number
  }
  error?: string
}

export interface ResponseHistoryODataResponse {
  type: 'odata'
  requestUrl: string
  requestMethod: string
  requestHeaders: ResponseHistoryKeyValue[]
  requestParams: ResponseHistoryKeyValue[]
  requestBody?: ResponseHistoryHttpBody
  odataVersion: 'v2' | 'v3' | 'v4' | 'v4.01'
  operationKind: 'entity-set' | 'function' | 'action' | 'batch'
  queryOptions?: Record<string, string | boolean | string[]>
  statusCode: number
  statusText: string
  responseHeaders: ResponseHistoryKeyValue[]
  responseBody: string
  contentType?: string
  contentLength?: number
  odataCount?: number
  odataNextLink?: string
  /** `@odata.deltaLink` captured from a v4.01 delta response, preserved
   * so the entry can be replayed / the change-tracking chain walked. */
  odataDeltaLink?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  error?: string
}

export interface ResponseHistoryGraphQLResponse {
  type: 'graphql'
  requestUrl: string
  requestHeaders: ResponseHistoryKeyValue[]
  statusCode: number
  data?: unknown
  errors?: { message: string; locations?: { line: number; column: number }[]; path?: string[] }[]
  responseHeaders: ResponseHistoryKeyValue[]
  timings: {
    startedAt: string
    durationMs: number
  }
  error?: string
}

export interface ResponseHistoryGrpcResponse {
  type: 'grpc'
  requestUrl: string
  requestMethod: string
  requestMessage: string
  requestMetadata: ResponseHistoryKeyValue[]
  statusCode: number
  statusMessage: string
  responseMessage: string
  responseMetadata: ResponseHistoryKeyValue[]
  /** Every frame exchanged on a streaming call (sent + received), in order.
   * Empty for a unary call (its single response is `responseMessage`). */
  messages?: ResponseHistoryGrpcMessage[]
  timings: {
    startedAt: string
    durationMs: number
  }
  error?: string
}

export interface ResponseHistoryGrpcMessage {
  direction: 'sent' | 'received'
  data: string
  timestamp: string
}

export interface ResponseHistorySoapResponse {
  type: 'soap'
  requestUrl: string
  requestSoapAction: string
  requestBody: string
  requestHeaders: ResponseHistoryKeyValue[]
  statusCode: number
  responseBody: string
  responseHeaders: ResponseHistoryKeyValue[]
  fault?: { code: string; message: string }
  timings: {
    startedAt: string
    durationMs: number
  }
  error?: string
}

export interface ResponseHistoryWebSocketMessage {
  direction: 'sent' | 'received'
  event?: string
  data: string
  timestamp: string
}

export interface ResponseHistoryWebSocketResponse {
  type: 'websocket'
  requestUrl: string
  protocol: string
  connected: boolean
  messages: ResponseHistoryWebSocketMessage[]
  timings: {
    startedAt: string
    durationMs: number
  }
  error?: string
}

/** One JSON-RPC 2.0 error object, per spec section 5.1. */
export interface ResponseHistoryJsonRpcError {
  code: number
  message: string
  data?: unknown
}

export interface ResponseHistoryJsonRpcResponse {
  type: 'jsonrpc'
  requestUrl: string
  requestHeaders: ResponseHistoryKeyValue[]
  method: string
  rpcId?: string
  notificationSent?: boolean
  statusCode: number
  statusText: string
  result?: unknown
  rpcError?: ResponseHistoryJsonRpcError
  timings: {
    startedAt: string
    durationMs: number
  }
  error?: string
}

export interface ResponseHistoryJsonRpcBatchChild {
  childId: string
  rpcId: string
  method: string
  result?: unknown
  error?: ResponseHistoryJsonRpcError
  unmatched?: boolean
}

export interface ResponseHistoryJsonRpcBatchResponse {
  type: 'jsonrpcBatch'
  requestUrl: string
  requestHeaders: ResponseHistoryKeyValue[]
  statusCode: number
  children: ResponseHistoryJsonRpcBatchChild[]
  timings: {
    startedAt: string
    durationMs: number
  }
  error?: string
}

export interface ResponseHistoryTrpcResponse {
  type: 'trpc'
  requestUrl: string
  requestProcedure: string
  requestKind: 'query' | 'mutation'
  requestHeaders: ResponseHistoryKeyValue[]
  statusCode: number
  statusText: string
  /** Unwrapped `result.data` from the v10 non-batch envelope. */
  data?: unknown
  /** The full `[{ result: { data } }]` (or `[{ error }]`) wire envelope — the
   * "Show raw envelope" toggle's source. */
  rawEnvelope: string
  responseHeaders: ResponseHistoryKeyValue[]
  timings: {
    startedAt: string
    durationMs: number
  }
  error?: string
}

export interface ResponseHistorySseFrame {
  event: string
  data: string
  id?: string
  timestamp: string
}

export interface ResponseHistorySseResponse {
  type: 'sse'
  requestUrl: string
  connected: boolean
  frames: ResponseHistorySseFrame[]
  timings: {
    startedAt: string
    durationMs: number
  }
  error?: string
}

export interface ResponseHistoryAmqpMessage {
  direction: 'sent' | 'received'
  data: string
  exchange?: string
  routingKey?: string
  deliveryTag?: number
  /** Set on a `browse`-mode message: peeked without acking. */
  peek?: boolean
  timestamp: string
}

export interface ResponseHistoryAmqpResponse {
  type: 'amqp'
  requestUrl: string
  mode: 'publish' | 'subscribe' | 'browse'
  connected: boolean
  messages: ResponseHistoryAmqpMessage[]
  timings: {
    startedAt: string
    durationMs: number
  }
  error?: string
}

export interface ResponseHistoryRedisMessage {
  direction: 'sent' | 'received'
  channel?: string
  data: string
  timestamp: string
}

/** A Redis history entry covers BOTH modes — `mode` discriminates which fields
 * apply. Subscribe mode carries `channels` + the streamed `messages`; command
 * mode carries the resolved `command`/`args` + the raw reply. */
export interface ResponseHistoryRedisResponse {
  type: 'redis'
  requestUrl: string
  mode: 'subscribe' | 'command'
  // Subscribe mode.
  channels?: string[]
  connected?: boolean
  messages?: ResponseHistoryRedisMessage[]
  // Command mode.
  command?: string
  args?: string[]
  reply?: string
export interface ResponseHistoryStompMessage {
  direction: 'sent' | 'received'
  command: string
  subscription?: string
  destination?: string
  headers: ResponseHistoryKeyValue[]
  body: string
  timestamp: string
}

export interface ResponseHistoryStompResponse {
  type: 'stomp'
  requestUrl: string
  connected: boolean
  messages: ResponseHistoryStompMessage[]
  timings: {
    startedAt: string
    durationMs: number
  }
  error?: string
}

export type ResponseHistoryResponse =
  | ResponseHistoryHttpResponse
  | ResponseHistoryODataResponse
  | ResponseHistoryGraphQLResponse
  | ResponseHistoryGrpcResponse
  | ResponseHistorySoapResponse
  | ResponseHistoryWebSocketResponse
  | ResponseHistoryJsonRpcResponse
  | ResponseHistoryJsonRpcBatchResponse
  | ResponseHistoryTrpcResponse
  | ResponseHistorySseResponse
  | ResponseHistoryAmqpResponse
  | ResponseHistoryRedisResponse
  | ResponseHistoryStompResponse

export interface ResponseHistoryDetail {
  guid: string
  requestId: string
  type: ResponseHistoryRequestType
  success: boolean
  outcome?: ResponseHistoryOutcome
  timestamp: string
  pinned: boolean
  requestMeta?: ResponseHistoryRequestMeta
  response: ResponseHistoryResponse
}
