import type { BaseRequest, ImportOrigin } from './BaseRequest'
import type { HTTPRequest } from './HTTPRequest'
import type { GraphQLRequest } from './GraphQLRequest'
import type { GrpcRequest, GrpcMockMethod } from './GrpcRequest'
import type { SoapRequest } from './SoapRequest'
import type { WebSocketRequest } from './WebSocketRequest'
import type { ODataRequest, ODataQueryOptions, ODataOperationKind, ODataBatchFormat, ODataBatchSubRequestSpec, ODataOperationParameterSpec } from './ODataRequest'
import type { AuthenticationRequest } from './AuthenticationRequest'

export type { BaseRequest, ImportOrigin, HTTPRequest, GraphQLRequest, GrpcRequest, GrpcMockMethod, SoapRequest, WebSocketRequest, ODataRequest, ODataQueryOptions, ODataOperationKind, ODataBatchFormat, ODataBatchSubRequestSpec, ODataOperationParameterSpec, AuthenticationRequest }

export type Request = HTTPRequest | GraphQLRequest | GrpcRequest | SoapRequest | WebSocketRequest | ODataRequest | AuthenticationRequest

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

export function isODataRequest(request: Request): request is ODataRequest {
  return request.type === 'odata'
}

export function isAuthenticationRequest(request: Request): request is AuthenticationRequest {
  return request.type === 'auth'
}
