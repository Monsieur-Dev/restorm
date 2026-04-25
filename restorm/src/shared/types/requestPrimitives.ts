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

export type WebSocketProtocol = 'websocket' | 'socketio' | 'mqtt'

export type ODataVersion = 'v2' | 'v3' | 'v4'
