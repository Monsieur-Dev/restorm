import type { KeyValue } from './baseTypes'

export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface HTTPRequestBodyText {
  type: 'text'
  content: string
}

export interface HTTPRequestBodyFile {
  type: 'file'
  path: string
}

export interface HTTPRequestBodyFormData {
  type: 'form-data'
  fields: KeyValue[]
}

export interface HTTPRequestBodyXWwwFormUrlEncoded {
  type: 'x-www-form-urlencoded'
  fields: KeyValue[]
}

export type HTTPRequestBody =
  | HTTPRequestBodyText
  | HTTPRequestBodyFile
  | HTTPRequestBodyFormData
  | HTTPRequestBodyXWwwFormUrlEncoded

export type GraphQLOperationType = 'query' | 'mutation' | 'subscription'

export type GrpcCallType = 'unary' | 'server-stream' | 'client-stream' | 'bidirectional-stream'

/**
 * The wire transport a gRPC request dispatches over. `'grpc'` (the default,
 * implied when the field is absent from a saved request) is the native
 * HTTP/2 client already implemented by `GRPCExecutionService`; `'grpc-web'`
 * and `'connect'` reuse the same proto descriptor but frame/encode the call
 * for plain HTTP/1.1 (gRPC-Web binary framing, Connect JSON-over-HTTP).
 */
export type GrpcTransport = 'grpc' | 'grpc-web' | 'connect'

export type WebSocketProtocol = 'websocket' | 'socketio' | 'mqtt'

export type ODataVersion = 'v2' | 'v3' | 'v4' | 'v4.01'
