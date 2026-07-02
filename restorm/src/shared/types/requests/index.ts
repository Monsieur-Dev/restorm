import type { BaseRequest, ImportOrigin } from './BaseRequest'
import type { HTTPRequest } from './HTTPRequest'
import type { GraphQLRequest } from './GraphQLRequest'
import type { GrpcRequest, GrpcMockMethod } from './GrpcRequest'
import type { SoapRequest } from './SoapRequest'
import type { WebSocketRequest } from './WebSocketRequest'
import type { SseRequest } from './SseRequest'
import type { ODataRequest, ODataQueryOptions, ODataOperationKind, ODataBatchFormat, ODataBatchSubRequestSpec, ODataOperationParameterSpec } from './ODataRequest'
import type { AuthenticationRequest } from './AuthenticationRequest'
import type { JsonRpcRequest, JsonRpcBatchRequest, JsonRpcBatchCallSpec } from './JsonRpcRequest'
import type { TrpcRequest } from './TrpcRequest'
import type { QuickConfig, QuickConfigStorageTarget } from './QuickConfig'

export type { BaseRequest, ImportOrigin, HTTPRequest, GraphQLRequest, GrpcRequest, GrpcMockMethod, SoapRequest, WebSocketRequest, SseRequest, ODataRequest, ODataQueryOptions, ODataOperationKind, ODataBatchFormat, ODataBatchSubRequestSpec, ODataOperationParameterSpec, AuthenticationRequest, JsonRpcRequest, JsonRpcBatchRequest, JsonRpcBatchCallSpec, TrpcRequest }
export type { QuickConfig, QuickConfigStorageTarget }

export type Request = HTTPRequest | GraphQLRequest | GrpcRequest | SoapRequest | WebSocketRequest | SseRequest | ODataRequest | AuthenticationRequest | JsonRpcRequest | JsonRpcBatchRequest | TrpcRequest

export function isHTTPRequest(request: Request): request is HTTPRequest {
  return request.type === 'http'
}

export function isGraphQLRequest(request: Request): request is GraphQLRequest {
  return request.type === 'graphql'
}

export function isGrpcRequest(request: Request): request is GrpcRequest {
  return request.type === 'grpc'
}

export function isSoapRequest(request: Request): request is SoapRequest {
  return request.type === 'soap'
}

export function isWebSocketRequest(request: Request): request is WebSocketRequest {
  return request.type === 'websocket'
}

export function isSseRequest(request: Request): request is SseRequest {
  return request.type === 'sse'
}

export function isODataRequest(request: Request): request is ODataRequest {
  return request.type === 'odata'
}

export function isAuthenticationRequest(request: Request): request is AuthenticationRequest {
  return request.type === 'auth'
}

export function isJsonRpcRequest(request: Request): request is JsonRpcRequest {
  return request.type === 'jsonrpc'
}

export function isJsonRpcBatchRequest(request: Request): request is JsonRpcBatchRequest {
  return request.type === 'jsonrpcBatch'
}

export function isTrpcRequest(request: Request): request is TrpcRequest {
  return request.type === 'trpc'
}
