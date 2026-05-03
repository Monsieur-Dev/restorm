export type ResponseHistoryRequestType = 'http' | 'odata' | 'graphql' | 'grpc' | 'soap' | 'websocket'

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
  odataVersion: 'v2' | 'v3' | 'v4'
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
  timings: {
    startedAt: string
    durationMs: number
  }
  error?: string
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

export type ResponseHistoryResponse =
  | ResponseHistoryHttpResponse
  | ResponseHistoryODataResponse
  | ResponseHistoryGraphQLResponse
  | ResponseHistoryGrpcResponse
  | ResponseHistorySoapResponse
  | ResponseHistoryWebSocketResponse

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
