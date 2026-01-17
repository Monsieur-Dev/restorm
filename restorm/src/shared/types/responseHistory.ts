export type ResponseHistoryRequestType = 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket'

export interface ResponseHistoryEntry {
  guid: string
  requestId: string
  requestPath: string
  type: ResponseHistoryRequestType
  success: boolean
  timestamp: string
  pinned: boolean
}

export interface ResponseHistoryIndex {
  version: 1
  maxPerRequest: number
  entries: ResponseHistoryEntry[]
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
  | ResponseHistoryGraphQLResponse
  | ResponseHistoryGrpcResponse
  | ResponseHistorySoapResponse
  | ResponseHistoryWebSocketResponse

export interface ResponseHistoryDetail {
  guid: string
  requestId: string
  requestPath: string
  type: ResponseHistoryRequestType
  success: boolean
  timestamp: string
  pinned: boolean
  requestMeta?: ResponseHistoryRequestMeta
  response: ResponseHistoryResponse
}
